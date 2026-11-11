"""Offline durability, scoped transport and duplicate-safe retry tests."""
import json
from datetime import datetime, timedelta, timezone
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

    def test_unknown_card_capability_is_cached_only_from_a_new_server_snapshot(self):
        self.assertFalse(db.accepts_unknown_cards(self.conn))
        now=datetime.now(timezone.utc)
        context={'snapshot_at':now.isoformat(),'date':db.today_key(),'events':[],'known_event_ids':[],'accept_unknown_cards':True}
        self.assertTrue(db.reconcile_context(self.conn,context))
        self.assertTrue(db.accepts_unknown_cards(self.conn))
        older={**context,'snapshot_at':(now-timedelta(seconds=1)).isoformat(),'accept_unknown_cards':False}
        self.assertFalse(db.reconcile_context(self.conn,older))
        self.assertTrue(db.accepts_unknown_cards(self.conn))
        newer={**context,'snapshot_at':(now+timedelta(seconds=1)).isoformat()}
        del newer['accept_unknown_cards']
        db.reconcile_context(self.conn,newer)
        self.assertFalse(db.accepts_unknown_cards(self.conn))

    def test_unlinked_card_events_queue_and_acknowledge_without_an_officer_cache_entry(self):
        self.assertFalse(db.is_enrolled(self.conn,'UNKNOWN1'))
        db.record_transition(self.conn,'UNKNOWN1','CLOCK_IN')
        db.record_transition(self.conn,'UNKNOWN1','CLOCK_OUT')
        self.syncer._sync_cycle()
        self.assertEqual(len(self.cloud.ingest.call_args.args[0]),2)
        self.assertEqual(db.get_unsynced_events(self.conn),[])

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


    def snapshot(self, events=None, known=None, stamp=None):
        return {'snapshot_at':stamp or datetime.now(timezone.utc).isoformat(),'date':db.today_key(),
                'events':events or [],'known_event_ids':known or [],'officers':[{'card_uid':'AAAA1111'}]}

    def test_manual_clock_out_reconciles_before_next_clock_in(self):
        db.record_transition(self.conn,'AAAA1111','CLOCK_IN')
        local=db.get_unsynced_events(self.conn)[0]
        db.mark_synced(self.conn,local['id'])
        out={'id':'manual-out','card_uid':'AAAA1111','type':'CLOCK_OUT','timestamp':datetime.now(timezone.utc).isoformat()}
        self.cloud.context.return_value=self.snapshot([out],[local['event_id']])
        ReaderContext(self.conn,self.cloud).refresh()
        self.assertEqual(db.get_daily_status(self.conn,'AAAA1111'),'OFF_DUTY')
        self.assertTrue(db.record_transition(self.conn,'AAAA1111','CLOCK_IN'))

    def test_cloud_tombstone_does_not_replay_an_acknowledged_local_event(self):
        db.record_transition(self.conn,'AAAA1111','CLOCK_IN');row=db.get_unsynced_events(self.conn)[0]
        db.mark_synced(self.conn,row['id'])
        db.reconcile_context(self.conn,self.snapshot(known=[row['event_id']]))
        self.assertEqual(db.get_daily_status(self.conn,'AAAA1111'),'OFF_DUTY')

    def test_unsent_tap_survives_an_empty_cloud_snapshot(self):
        db.record_transition(self.conn,'AAAA1111','CLOCK_IN')
        row=db.get_unsynced_events(self.conn)[0]
        db.reconcile_context(self.conn,self.snapshot())
        self.assertEqual(db.get_daily_status(self.conn,'AAAA1111'),'ON_DUTY')
        self.assertEqual(db.get_unsynced_events(self.conn)[0]['event_id'],row['event_id'])

    def test_tap_acknowledged_during_request_still_survives_stale_snapshot(self):
        snapshot=self.snapshot()
        db.record_transition(self.conn,'AAAA1111','CLOCK_IN');row=db.get_unsynced_events(self.conn)[0]
        db.mark_synced(self.conn,row['id'])
        db.reconcile_context(self.conn,snapshot)
        self.assertEqual(db.get_daily_status(self.conn,'AAAA1111'),'ON_DUTY')

    def test_older_snapshot_cannot_replace_a_newer_reconciliation(self):
        first=self.snapshot();second=self.snapshot()
        second['events']=[{'id':'in','card_uid':'AAAA1111','type':'CLOCK_IN','timestamp':datetime.now(timezone.utc).isoformat()}]
        self.assertTrue(db.reconcile_context(self.conn,second))
        self.assertFalse(db.reconcile_context(self.conn,first))
        self.assertEqual(db.get_daily_status(self.conn,'AAAA1111'),'ON_DUTY')

    def test_missed_cutoff_after_reboot_keeps_source_date_and_stable_uuid(self):
        event_id='10000000-0000-0000-0000-000000000001'
        with self.conn:
            self.conn.execute("INSERT INTO daily_state(card_uid,status,last_tap_date,last_event_id,last_event_at) VALUES ('AAAA1111','ON_DUTY','2026-11-08',?,'2026-11-08T09:00:00+08:00')",(event_id,))
        self.assertEqual(db.recover_overdue(self.conn,datetime(2026,11,10,tzinfo=timezone.utc)),1)
        row=db.get_unsynced_events(self.conn)[0]
        self.assertEqual(row['event_id'],db.auto_close_id(event_id))
        self.assertEqual(row['timestamp'],'2026-11-08T21:00:00+08:00')
        self.assertEqual(db.recover_overdue(self.conn,datetime(2026,11,10,tzinfo=timezone.utc)),0)
        self.assertEqual(len(db.get_unsynced_events(self.conn)),1)


if __name__ == '__main__': unittest.main()
