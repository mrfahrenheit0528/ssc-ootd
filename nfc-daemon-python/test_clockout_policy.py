import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import db
from clockout_policy import clockout_times, validate_policy

POLICY={'version':1,'effective_from':'2026-11-16T22:53:24.360836+08:00'}


class ClockoutPolicyTests(unittest.TestCase):
    def test_the_local_rule_matches_server_boundaries_and_keeps_prior_history(self):
        for clock_in,due,estimated in [('09:00:00','21:00:00','17:00:00'),('17:00:00','21:00:00','17:00:00.000001'),
                                       ('17:00:01','21:00:00','18:00:01'),('18:00:00','21:00:00','19:00:00'),('20:30:00','21:30:00','21:30:00')]:
            actual=clockout_times(datetime.fromisoformat('2026-11-17T'+clock_in+'+08:00'),POLICY)
            self.assertEqual([value.astimezone(db._ATTENDANCE_ZONE).isoformat() for value in actual],['2026-11-17T'+due+'+08:00','2026-11-17T'+estimated+'+08:00'])
        original=clockout_times(datetime.fromisoformat('2026-11-16T13:19:22+08:00'),POLICY)
        self.assertEqual(original[0],original[1])
        self.assertEqual(original[1].hour,21)
        legacy=clockout_times(datetime.fromisoformat('2026-11-17T09:00:00+08:00'))
        self.assertEqual(legacy[0],legacy[1])

    def test_the_policy_and_queue_survive_offline_reboot_without_reusing_source_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path=str(Path(directory)/'queue.db')
            conn=db.get_connection(path);db.init_db(conn)
            db.reconcile_context(conn,{'snapshot_at':'2026-11-17T08:00:00+08:00','date':'2026-11-17','events':[],
                                      'automatic_clockout_policy':POLICY})
            source='10000000-0000-0000-0000-000000000001'
            with conn:
                conn.execute("INSERT INTO daily_state VALUES ('AAAA1111','ON_DUTY','2026-11-17',?,?)",(source,'2026-11-17T09:00:00+08:00'))
            self.assertEqual(db.recover_overdue(conn,datetime.fromisoformat('2026-11-17T20:59:59+08:00')),0)
            conn.close()
            conn=db.get_connection(path)
            try:
                db.init_db(conn)
                self.assertEqual(db.recover_overdue(conn,datetime.fromisoformat('2026-11-17T21:00:00+08:00')),1)
                row=db.get_unsynced_events(conn)[0]
                self.assertEqual(row['timestamp'],'2026-11-17T17:00:00+08:00')
                self.assertEqual(row['event_id'],db.auto_close_id(source))
                self.assertEqual(db.recover_overdue(conn,datetime.fromisoformat('2026-11-18T21:00:00+08:00')),0)
                self.assertEqual(len(db.get_unsynced_events(conn)),1)
            finally:conn.close()

    def setup_late(self,conn,stamp):
        db.init_db(conn)
        with conn:
            conn.execute("INSERT INTO reader_metadata VALUES ('automatic_clockout_policy',?)",(json.dumps(POLICY),))
            conn.execute("INSERT INTO daily_state VALUES ('AAAA1111','ON_DUTY',?,?,?)",(stamp[:10],'10000000-0000-0000-0000-000000000001',stamp))

    def test_a_late_hour_does_not_close_at_nine_or_credit_a_future_timestamp(self):
        conn=db.get_connection(':memory:')
        try:
            self.setup_late(conn,'2026-11-17T20:30:00+08:00')
            self.assertEqual(db.recover_overdue(conn,datetime.fromisoformat('2026-11-17T21:00:00+08:00')),0)
            self.assertEqual(db.recover_overdue(conn,datetime.fromisoformat('2026-11-17T21:30:00+08:00')),1)
            self.assertEqual(db.get_unsynced_events(conn)[0]['timestamp'],'2026-11-17T21:30:00+08:00')
        finally:conn.close()

    def test_a_real_late_clockout_remains_possible_before_the_hour_is_due(self):
        conn=db.get_connection(':memory:')
        try:
            self.setup_late(conn,'2026-11-17T23:30:00+08:00')
            class Clock(datetime):
                @classmethod
                def now(cls,tz=None):return datetime.fromisoformat('2026-11-18T00:15:00+08:00').astimezone(tz or timezone.utc)
            with patch('db.datetime',Clock):
                self.assertEqual(db.get_daily_status(conn,'AAAA1111'),'ON_DUTY')
                self.assertEqual(db.recover_overdue(conn),0)
                self.assertTrue(db.record_transition(conn,'AAAA1111','CLOCK_OUT'))
            self.assertEqual(db.recover_overdue(conn,datetime.fromisoformat('2026-11-18T00:30:00+08:00')),0)
            self.assertEqual(len(db.get_unsynced_events(conn)),1)
            self.assertFalse(db.get_unsynced_events(conn)[0]['is_auto_closed'])
        finally:conn.close()

    def test_a_late_overnight_hour_closes_on_its_source_uuid_once(self):
        conn=db.get_connection(':memory:')
        try:
            self.setup_late(conn,'2026-11-17T23:30:00+08:00')
            self.assertEqual(db.recover_overdue(conn,datetime.fromisoformat('2026-11-18T00:29:59+08:00')),0)
            self.assertEqual(db.recover_overdue(conn,datetime.fromisoformat('2026-11-18T00:30:00+08:00')),1)
            self.assertEqual(db.get_unsynced_events(conn)[0]['timestamp'],'2026-11-18T00:30:00+08:00')
        finally:conn.close()

    def test_stale_or_invalid_cloud_policy_cannot_replace_a_cached_snapshot(self):
        conn=db.get_connection(':memory:')
        try:
            db.init_db(conn)
            context={'snapshot_at':'2026-11-17T10:00:00+08:00','date':'2026-11-17','events':[],'automatic_clockout_policy':POLICY}
            db.reconcile_context(conn,context)
            self.assertFalse(db.reconcile_context(conn,{**context,'snapshot_at':'2026-11-17T09:00:00+08:00','automatic_clockout_policy':None}))
            self.assertIsNotNone(db.cached_clockout_policy(conn))
            with self.assertRaises(ValueError):
                db.reconcile_context(conn,{**context,'snapshot_at':'2026-11-17T11:00:00+08:00','automatic_clockout_policy':{'version':99}})
            self.assertIsNotNone(db.cached_clockout_policy(conn))
            db.reconcile_context(conn,{**context,'snapshot_at':'2026-11-17T12:00:00+08:00','automatic_clockout_policy':None})
            self.assertIsNone(db.cached_clockout_policy(conn))
        finally:conn.close()

    def test_policy_requires_a_version_and_an_unambiguous_activation_timestamp(self):
        for value in [{'version':2,'effective_from':'2026-11-17T10:00:00Z'},{'version':1,'effective_from':'2026-11-17T10:00:00'}]:
            with self.assertRaises(ValueError):validate_policy(value)

if __name__=='__main__':unittest.main()
