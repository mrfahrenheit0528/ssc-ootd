"""Offline durability, scoped transport and duplicate-safe retry tests."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import UUID

import db
from cloud import CloudClient
from supabase_sync import SupabaseSyncer, ReaderContext


class TestSupabaseSync(unittest.TestCase):
    def setUp(self):
        self.conn = db.get_connection(':memory:')
        db.init_db(self.conn)
        self.cloud = Mock()
        self.cloud.ingest.side_effect = lambda rows: len(rows)
        self.syncer = SupabaseSyncer(self.conn, self.cloud)

    def tearDown(self):
        self.conn.close()

    def test_retry_after_response_lost_reuses_event_ids(self):
        db.record_transition(self.conn, 'AAAA1111', 'CLOCK_IN')
        self.cloud.ingest.side_effect = [ConnectionError('response lost'), 1]
        with self.assertRaises(ConnectionError): self.syncer._sync_cycle()
        first = self.cloud.ingest.call_args.args[0]
        self.assertEqual(len(db.get_unsynced_events(self.conn)), 1)
        self.syncer._sync_cycle()
        second = self.cloud.ingest.call_args.args[0]
        self.assertEqual(first, second)
        UUID(first[0]['event_id'])
        self.assertEqual(db.get_unsynced_events(self.conn), [])

    def test_retry_after_local_ack_failure_reuses_event_ids(self):
        db.record_transition(self.conn, 'AAAA1111', 'CLOCK_IN')
        with patch('db.mark_synced', side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError): self.syncer._sync_cycle()
        self.syncer._sync_cycle()
        self.assertEqual(self.cloud.ingest.call_args_list[0], self.cloud.ingest.call_args_list[1])

    def test_failed_batch_stops_later_batches(self):
        for i in range(101): db.log_event(self.conn, f'UID{i:04}', 'CLOCK_IN')
        self.cloud.ingest.side_effect = ConnectionError('offline')
        with self.assertRaises(ConnectionError): self.syncer._sync_cycle()
        self.cloud.ingest.assert_called_once()
        self.assertEqual(len(db.get_unsynced_events(self.conn)), 101)

    def test_incorrect_ack_keeps_batch(self):
        db.log_event(self.conn, 'AAAA1111', 'CLOCK_IN')
        self.cloud.ingest.side_effect = None
        self.cloud.ingest.return_value = 0
        with self.assertRaises(RuntimeError): self.syncer._sync_cycle()
        self.assertEqual(len(db.get_unsynced_events(self.conn)), 1)

    def test_event_and_status_rollback_together(self):
        self.conn.execute("CREATE TRIGGER fail_state BEFORE INSERT ON daily_state BEGIN SELECT RAISE(ABORT,'failure'); END")
        with self.assertRaises(sqlite3.IntegrityError): db.record_transition(self.conn, 'AAAA1111', 'CLOCK_IN')
        self.assertEqual(db.get_unsynced_events(self.conn), [])
        self.assertIsNone(db.get_daily_status(self.conn, 'AAAA1111'))

    def test_double_clock_out_is_not_recorded(self):
        db.record_transition(self.conn, 'AAAA1111', 'CLOCK_IN')
        self.assertTrue(db.record_transition(self.conn, 'AAAA1111', 'CLOCK_OUT'))
        self.assertFalse(db.record_transition(self.conn, 'AAAA1111', 'CLOCK_OUT', True))
        self.assertEqual(len(db.get_unsynced_events(self.conn)), 2)

    def test_offline_reboot_keeps_roster_and_event_id(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'test.db')
            first = db.get_connection(path)
            db.init_db(first)
            db.save_roster(first, [{'card_uid': 'AAAA1111'}])
            db.record_transition(first, 'AAAA1111', 'CLOCK_IN')
            event_id = db.get_unsynced_events(first)[0]['event_id']
            first.close()
            second = db.get_connection(path)
            try:
                db.init_db(second)
                registry = ReaderContext(second, self.cloud)
                self.assertTrue(registry.is_enrolled('AAAA1111'))
                self.assertFalse(registry.is_enrolled('UNKNOWN1'))
                self.assertEqual(db.get_unsynced_events(second)[0]['event_id'], event_id)
            finally: second.close()

    def test_old_sqlite_schema_gets_stable_ids(self):
        old = sqlite3.connect(':memory:')
        old.row_factory = sqlite3.Row
        old.execute(db._CREATE_SYNC_QUEUE)
        old.execute("INSERT INTO sync_queue(card_uid,action_type,timestamp) VALUES ('AAAA1111','CLOCK_IN','2026-11-09T09:00:00+08:00')")
        db.init_db(old)
        event_id = db.get_unsynced_events(old)[0]['event_id']
        db.init_db(old)
        self.assertEqual(db.get_unsynced_events(old)[0]['event_id'], event_id)
        old.close()

    def test_transport_sends_publishable_key_and_scoped_device_token(self):
        client = CloudClient('https://example.supabase.co', 'publishable-key', 'device-id', 'private-device-token')
        response = Mock()
        response.read.return_value = b'false'
        with patch('cloud.urlopen') as opened:
            opened.return_value.__enter__.return_value = response
            self.assertFalse(client.tap('AAAA1111'))
            request = opened.call_args.args[0]
            self.assertEqual(request.get_header('Apikey'), 'publishable-key')
            self.assertEqual(json.loads(request.data)['p_token'], 'private-device-token')
            self.assertNotIn('service_role', request.full_url)


if __name__ == '__main__': unittest.main()
