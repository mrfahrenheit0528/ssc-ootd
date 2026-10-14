"""
test_firebase_sync.py
---------------------
Tests for the FirebaseSyncer thread and AutoCloseScheduler, using mocked
Firestore and in-memory SQLite — no real Firebase project required.

Run with:
    python test_firebase_sync.py
"""

import sqlite3
import sys
import time
import threading
import unittest
from unittest.mock import MagicMock, patch, call

import db
from config import AppConfig
from firebase_sync import FirebaseSyncer
from scheduler import AutoCloseScheduler
from state_machine import StateMachine, TapResult

OFFICER_A = "AAAA1111"
OFFICER_B = "BBBB2222"
CLOCK_OUT_TAG = "DEADBEEF"

_CFG = AppConfig(
    clock_out_tag_uid=CLOCK_OUT_TAG,
    debounce_seconds=1,
    clock_out_window_seconds=2,
    sync_interval_seconds=1,
)


def _make_conn():
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    return conn


def _mock_firestore():
    """
    Build a minimal Firestore mock that records calls to:
      batch().set()
      batch().commit()
      collection().document().get()
    """
    fs = MagicMock()

    # Officer doc returns first_name / last_name
    officer_doc = MagicMock()
    officer_doc.exists = True
    officer_doc.to_dict.return_value = {
        "first_name": "Juan",
        "last_name": "dela Cruz",
        "position": "President",
        "status": "OFF_DUTY",
    }
    fs.collection("officers").document(OFFICER_A).get.return_value = officer_doc

    # Batch support
    batch = MagicMock()
    fs.batch.return_value = batch

    return fs


class TestFirebaseSyncer(unittest.TestCase):

    def setUp(self):
        self.conn = _make_conn()

    def tearDown(self):
        self.conn.close()

    def test_01_syncs_clock_in_event(self):
        """A CLOCK_IN row in sync_queue should be pushed to Firestore and marked synced."""
        db.log_event(self.conn, OFFICER_A, "CLOCK_IN")
        fs = _mock_firestore()

        syncer = FirebaseSyncer(self.conn, fs, sync_interval=1)
        syncer._sync_cycle()  # run one cycle synchronously

        # batch.set should have been called for attendance_logs and officers
        batch = fs.batch.return_value
        batch.commit.assert_called_once()
        self.assertGreaterEqual(batch.set.call_count, 2)

        # Inspect the attendance_log payload
        log_payloads = [call[0][1] for call in batch.set.call_args_list if "card_uid" in call[0][1]]
        self.assertEqual(len(log_payloads), 1)
        doc_args = log_payloads[0]
        self.assertEqual(doc_args["card_uid"], OFFICER_A)
        self.assertEqual(doc_args["type"], "CLOCK_IN")
        self.assertFalse(doc_args["is_auto_closed"])

        # Row should be marked synced in SQLite
        rows = db.get_unsynced_events(self.conn)
        self.assertEqual(len(rows), 0)
        print("✅  test_01_syncs_clock_in_event PASSED")

    def test_02_syncs_clock_out_event(self):
        """A CLOCK_OUT row should set officer status to OFF_DUTY in Firestore."""
        db.log_event(self.conn, OFFICER_A, "CLOCK_OUT")
        fs = _mock_firestore()
        syncer = FirebaseSyncer(self.conn, fs, sync_interval=1)
        syncer._sync_cycle()

        batch = fs.batch.return_value
        status_payloads = [call[0][1] for call in batch.set.call_args_list if "status" in call[0][1]]
        self.assertTrue(any(p.get("status") == "OFF_DUTY" for p in status_payloads))
        batch.commit.assert_called_once()
        print("✅  test_02_syncs_clock_out_event PASSED")

    def test_03_auto_closed_flag_preserved(self):
        """is_auto_closed=True should be reflected in the Firestore document."""
        db.log_event(self.conn, OFFICER_A, "CLOCK_OUT", is_auto_closed=True)
        fs = _mock_firestore()
        syncer = FirebaseSyncer(self.conn, fs, sync_interval=1)
        syncer._sync_cycle()

        batch = fs.batch.return_value
        log_payloads = [call[0][1] for call in batch.set.call_args_list if "card_uid" in call[0][1]]
        self.assertEqual(len(log_payloads), 1)
        self.assertTrue(log_payloads[0]["is_auto_closed"])
        print("✅  test_03_auto_closed_flag_preserved PASSED")

    def test_04_skips_row_on_firestore_error(self):
        """If Firestore raises, the row remains unsynced for the next retry cycle."""
        db.log_event(self.conn, OFFICER_A, "CLOCK_IN")
        fs = _mock_firestore()
        fs.batch.return_value.commit.side_effect = Exception("Network error")

        syncer = FirebaseSyncer(self.conn, fs, sync_interval=1)
        syncer._sync_cycle()

        # Row must still be unsynced
        rows = db.get_unsynced_events(self.conn)
        self.assertEqual(len(rows), 1)
        print("✅  test_04_skips_row_on_firestore_error PASSED")

    def test_05_officer_name_cached(self):
        """Officer resolution should only hit Firestore once per uid."""
        db.log_event(self.conn, OFFICER_A, "CLOCK_IN")
        db.log_event(self.conn, OFFICER_A, "CLOCK_OUT")
        # Clear debounce so both events have different timestamps
        fs = _mock_firestore()
        syncer = FirebaseSyncer(self.conn, fs, sync_interval=1)
        syncer._sync_cycle()

        # get() on officers doc should only be called once (cached after first)
        get_calls = fs.collection("officers").document(OFFICER_A).get.call_count
        self.assertEqual(get_calls, 1)
        print("✅  test_05_officer_name_cached PASSED")

    def test_06_multiple_officers_synced(self):
        """Both officers' events should be independently synced."""
        db.log_event(self.conn, OFFICER_A, "CLOCK_IN")
        db.log_event(self.conn, OFFICER_B, "CLOCK_IN")
        fs = _mock_firestore()
        # Make OFFICER_B doc also return a valid name
        b_doc = MagicMock()
        b_doc.exists = True
        b_doc.to_dict.return_value = {"first_name": "Maria", "last_name": "Santos"}
        fs.collection("officers").document(OFFICER_B).get.return_value = b_doc

        syncer = FirebaseSyncer(self.conn, fs, sync_interval=1)
        syncer._sync_cycle()

        # Both events should be committed
        batch = fs.batch.return_value
        self.assertEqual(batch.commit.call_count, 2)
        self.assertEqual(len(db.get_unsynced_events(self.conn)), 0)
        print("✅  test_06_multiple_officers_synced PASSED")


class TestAutoCloseScheduler(unittest.TestCase):

    def setUp(self):
        self.conn = _make_conn()

    def tearDown(self):
        self.conn.close()

    def test_07_auto_close_creates_clock_out_rows(self):
        """trigger_now() should insert CLOCK_OUT rows for all ON_DUTY officers."""
        db.set_daily_status(self.conn, OFFICER_A, "ON_DUTY")
        db.set_daily_status(self.conn, OFFICER_B, "ON_DUTY")

        sched = AutoCloseScheduler(self.conn, close_time="21:00")
        sched.trigger_now()

        rows = db.get_unsynced_events(self.conn)
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertEqual(row["action_type"], "CLOCK_OUT")
            self.assertEqual(row["is_auto_closed"], 1)

        print("✅  test_07_auto_close_creates_clock_out_rows PASSED")

    def test_08_auto_close_resets_daily_state(self):
        """After auto-close, all officers should be OFF_DUTY in daily_state."""
        db.set_daily_status(self.conn, OFFICER_A, "ON_DUTY")
        db.set_daily_status(self.conn, OFFICER_B, "ON_DUTY")

        sched = AutoCloseScheduler(self.conn, close_time="21:00")
        sched.trigger_now()

        self.assertEqual(db.get_daily_status(self.conn, OFFICER_A), "OFF_DUTY")
        self.assertEqual(db.get_daily_status(self.conn, OFFICER_B), "OFF_DUTY")
        print("✅  test_08_auto_close_resets_daily_state PASSED")

    def test_09_auto_close_no_on_duty(self):
        """If no one is ON_DUTY, auto-close should write zero rows."""
        sched = AutoCloseScheduler(self.conn, close_time="21:00")
        sched.trigger_now()
        rows = db.get_unsynced_events(self.conn)
        self.assertEqual(len(rows), 0)
        print("✅  test_09_auto_close_no_on_duty PASSED")


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("  Firebase Sync & Scheduler Tests  (no real Firebase needed)")
    print("=" * 60)
    loader = unittest.TestLoader()
    loader.sortTestMethodsUsing = None
    suite = loader.loadTestsFromTestCase(TestFirebaseSyncer)
    suite.addTests(loader.loadTestsFromTestCase(TestAutoCloseScheduler))
    runner = unittest.TextTestRunner(verbosity=0)
    result = runner.run(suite)
    if result.wasSuccessful():
        print("\n🎉  All tests passed!")
    else:
        print(f"\n❌  {len(result.failures)} failure(s), {len(result.errors)} error(s)")
        sys.exit(1)
