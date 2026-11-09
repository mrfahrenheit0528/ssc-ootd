"""Auto-close tests: no reader or cloud account required."""
import sqlite3
import unittest
import db
from scheduler import AutoCloseScheduler
OFFICER_A = 'AAAA1111'
OFFICER_B = 'BBBB2222'
def _make_conn():
    conn = sqlite3.connect(':memory:', check_same_thread=False)
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    return conn

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


if __name__ == '__main__':
    unittest.main()
