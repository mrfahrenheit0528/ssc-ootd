"""
test_sim.py
-----------
Hardware-free simulation of the NFC state machine.

Feeds mock UIDs directly into StateMachine.process_tap() using an in-memory
SQLite database — no ACR122U required.

Run with:
    python test_sim.py

Expected output shows all scenarios passing.
"""

import sqlite3
import sys
import time
import unittest
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Minimal in-process config (no config.json needed)
# ---------------------------------------------------------------------------
from config import AppConfig
import db
from state_machine import StateMachine, TapResult, Mode

OFFICER_A = "AAAA1111"
OFFICER_B = "BBBB2222"
CLOCK_OUT_TAG = "DEADBEEF"

_CFG = AppConfig(
    clock_out_tag_uid=CLOCK_OUT_TAG,
    debounce_seconds=2,          # short for tests
    clock_out_window_seconds=2,  # short for tests
)


def _make_conn() -> sqlite3.Connection:
    """Create a fresh in-memory SQLite DB for each test."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    db.init_db(conn)
    return conn


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

class TestStateMachine(unittest.TestCase):

    def setUp(self):
        self.conn = _make_conn()
        self.events: list[tuple[str, TapResult]] = []
        self.sm = StateMachine(
            cfg=_CFG,
            conn=self.conn,
            on_event=lambda uid, result: self.events.append((uid, result)),
        )

    def tearDown(self):
        self.conn.close()

    # ── Phase 1 scenarios ────────────────────────────────────────────────────

    def test_01_clock_in(self):
        """First tap of the day should produce CLOCKED_IN."""
        result = self.sm.process_tap(OFFICER_A)
        self.assertEqual(result, TapResult.CLOCKED_IN)
        status = db.get_daily_status(self.conn, OFFICER_A)
        self.assertEqual(status, "ON_DUTY")
        rows = db.get_unsynced_events(self.conn)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["action_type"], "CLOCK_IN")
        print("✅  test_01_clock_in PASSED")

    def test_02_ignored_already_clocked_in(self):
        """Second tap (same day, no clock-out in between) must be IGNORED."""
        self.sm.process_tap(OFFICER_A)
        # Reset debounce by advancing time artificially (change uid slightly won't work,
        # so we clear last tap time directly)
        self.sm._last_tap_times.clear()
        result = self.sm.process_tap(OFFICER_A)
        self.assertEqual(result, TapResult.IGNORED_ALREADY_CLOCKED_IN)
        # Only 1 event in DB
        rows = db.get_unsynced_events(self.conn)
        self.assertEqual(len(rows), 1)
        print("✅  test_02_ignored_already_clocked_in PASSED")

    def test_03_debounce(self):
        """Rapid re-tap within debounce window is silently ignored."""
        self.sm.process_tap(OFFICER_A)
        result = self.sm.process_tap(OFFICER_A)  # immediate re-tap
        self.assertEqual(result, TapResult.IGNORED_DEBOUNCE)
        print("✅  test_03_debounce PASSED")

    # ── Phase 2 scenarios ────────────────────────────────────────────────────

    def test_04_full_shift(self):
        """
        Full shift simulation:
          OFFICER_A taps → CLOCK_IN
          OFFICER_A taps again → IGNORED
          Clock-out tag tapped → WAITING_FOR_CLOCK_OUT
          OFFICER_A taps → CLOCK_OUT
        """
        # Clock in
        r1 = self.sm.process_tap(OFFICER_A)
        self.assertEqual(r1, TapResult.CLOCKED_IN)

        # Ignored re-tap
        self.sm._last_tap_times.clear()
        r2 = self.sm.process_tap(OFFICER_A)
        self.assertEqual(r2, TapResult.IGNORED_ALREADY_CLOCKED_IN)

        # Activate clock-out mode
        r3 = self.sm.process_tap(CLOCK_OUT_TAG)
        self.assertEqual(r3, TapResult.CLOCK_OUT_MODE_ACTIVATED)
        self.assertEqual(self.sm.get_mode(), Mode.WAITING_FOR_CLOCK_OUT)

        # Officer taps within window
        self.sm._last_tap_times.clear()
        r4 = self.sm.process_tap(OFFICER_A)
        self.assertEqual(r4, TapResult.CLOCKED_OUT)
        self.assertEqual(self.sm.get_mode(), Mode.DEFAULT)

        status = db.get_daily_status(self.conn, OFFICER_A)
        self.assertEqual(status, "OFF_DUTY")

        rows = db.get_unsynced_events(self.conn)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["action_type"], "CLOCK_IN")
        self.assertEqual(rows[1]["action_type"], "CLOCK_OUT")
        print("✅  test_04_full_shift PASSED")

    def test_05_clock_out_timeout(self):
        """If no officer taps within the window, mode reverts to DEFAULT."""
        self.sm.process_tap(OFFICER_A)  # clock in

        self.sm._last_tap_times.clear()
        r = self.sm.process_tap(CLOCK_OUT_TAG)
        self.assertEqual(r, TapResult.CLOCK_OUT_MODE_ACTIVATED)

        # Wait for the 2-second test window to expire
        time.sleep(3)
        self.assertEqual(self.sm.get_mode(), Mode.DEFAULT)
        print("✅  test_05_clock_out_timeout PASSED")

    def test_06_clock_out_not_on_duty(self):
        """Officer who hasn't clocked in cannot clock out."""
        # Activate clock-out mode
        self.sm.process_tap(CLOCK_OUT_TAG)
        # OFFICER_B has no record today
        self.sm._last_tap_times.clear()
        r = self.sm.process_tap(OFFICER_B)
        self.assertEqual(r, TapResult.IGNORED_NOT_ON_DUTY)
        print("✅  test_06_clock_out_not_on_duty PASSED")

    def test_07_two_officers_independent(self):
        """Each officer's state is tracked independently."""
        self.sm.process_tap(OFFICER_A)
        self.sm.process_tap(OFFICER_B)

        self.assertEqual(db.get_daily_status(self.conn, OFFICER_A), "ON_DUTY")
        self.assertEqual(db.get_daily_status(self.conn, OFFICER_B), "ON_DUTY")

        # Clock out only OFFICER_A
        self.sm._last_tap_times.clear()
        self.sm.process_tap(CLOCK_OUT_TAG)
        self.sm._last_tap_times.clear()
        self.sm.process_tap(OFFICER_A)

        self.assertEqual(db.get_daily_status(self.conn, OFFICER_A), "OFF_DUTY")
        self.assertEqual(db.get_daily_status(self.conn, OFFICER_B), "ON_DUTY")
        print("✅  test_07_two_officers_independent PASSED")

    def test_08_auto_close_query(self):
        """get_all_on_duty returns correct officers for auto-close job."""
        self.sm.process_tap(OFFICER_A)
        self.sm.process_tap(OFFICER_B)

        on_duty = db.get_all_on_duty(self.conn)
        uids = {row["card_uid"] for row in on_duty}
        self.assertIn(OFFICER_A, uids)
        self.assertIn(OFFICER_B, uids)

        # Simulate auto-close
        for row in on_duty:
            db.log_event(self.conn, row["card_uid"], "CLOCK_OUT", is_auto_closed=True)
            db.set_daily_status(self.conn, row["card_uid"], "OFF_DUTY")

        rows = db.get_unsynced_events(self.conn)
        auto_closed = [r for r in rows if r["is_auto_closed"] == 1]
        self.assertEqual(len(auto_closed), 2)
        print("✅  test_08_auto_close_query PASSED")


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("  NFC State Machine Simulator  (no hardware required)")
    print("=" * 60)
    loader = unittest.TestLoader()
    loader.sortTestMethodsUsing = None  # preserve declaration order
    suite = loader.loadTestsFromTestCase(TestStateMachine)
    runner = unittest.TextTestRunner(verbosity=0)
    result = runner.run(suite)
    if result.wasSuccessful():
        print("\n🎉  All tests passed!")
    else:
        print(f"\n❌  {len(result.failures)} failure(s), {len(result.errors)} error(s)")
        sys.exit(1)
