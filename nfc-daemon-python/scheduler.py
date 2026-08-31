"""
scheduler.py
------------
9 PM auto-close background thread.

At 21:00 daily, this job:
  1. Queries daily_state for every officer still marked ON_DUTY.
  2. Inserts a CLOCK_OUT row (is_auto_closed=True) into sync_queue for each.
  3. Flips their daily_state to OFF_DUTY.
  4. The FirebaseSyncer thread picks those rows up on its next cycle.

Implementation
--------------
Uses the `schedule` library (single-threaded, no external deps beyond pip).
A lightweight watcher loop runs in a daemon thread, calling
`schedule.run_pending()` every 30 seconds.

The `schedule` library is NOT thread-safe, so we use a dedicated thread
with its own scheduler instance (`_scheduler`) to avoid conflicts.
"""

import logging
import threading
import time

import schedule as _schedule_lib

logger = logging.getLogger(__name__)


class AutoCloseScheduler(threading.Thread):
    """
    Daemon thread that runs the 9 PM auto-close job via the `schedule` library.

    Args:
        db_conn:         Active SQLite connection (WAL-safe shared use).
        close_time:      "HH:MM" string for the daily auto-close (default "21:00").
        poll_interval:   Seconds between schedule.run_pending() checks (default 30).
    """

    def __init__(self, db_conn, close_time: str = "21:00", poll_interval: int = 30) -> None:
        super().__init__(name="AutoCloseScheduler", daemon=True)
        self._conn = db_conn
        self._close_time = close_time
        self._poll_interval = poll_interval
        self._stop_event = threading.Event()

        # Use a dedicated scheduler instance (not the global one) for isolation
        self._scheduler = _schedule_lib.Scheduler()
        self._scheduler.every().day.at(close_time).do(self._run_auto_close)

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        logger.info(
            "AutoCloseScheduler started — auto-close job scheduled at %s daily.",
            self._close_time,
        )
        while not self._stop_event.is_set():
            self._scheduler.run_pending()
            self._stop_event.wait(self._poll_interval)
        logger.info("AutoCloseScheduler stopped.")

    # ------------------------------------------------------------------
    # The job
    # ------------------------------------------------------------------

    def _run_auto_close(self) -> None:
        """
        Force-close all ON_DUTY officers.
        Called by the schedule library at 21:00.
        """
        import db  # local import avoids circular deps

        logger.info("9 PM auto-close job starting…")
        on_duty_rows = db.get_all_on_duty(self._conn)

        if not on_duty_rows:
            logger.info("Auto-close: no officers ON_DUTY. Nothing to do.")
            return

        count = 0
        for row in on_duty_rows:
            uid = row["card_uid"]
            try:
                db.log_event(self._conn, uid, "CLOCK_OUT", is_auto_closed=True)
                db.set_daily_status(self._conn, uid, "OFF_DUTY")
                count += 1
                logger.info("Auto-closed officer uid=%s", uid)
            except Exception as exc:  # noqa: BLE001
                logger.error("Failed to auto-close uid=%s: %s", uid, exc)

        logger.info("Auto-close complete: %d officer(s) force-closed.", count)

    def trigger_now(self) -> None:
        """
        Manually trigger the auto-close job immediately (useful for testing
        without waiting until 21:00).

        Example:
            scheduler.trigger_now()
        """
        logger.info("Manual trigger: running auto-close job now.")
        self._run_auto_close()
