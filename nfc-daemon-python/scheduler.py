"""Recover the school-time cutoff at startup and every poll, including missed days.

trigger_now remains an explicit force-close helper for reader simulations.
"""

import logging
import threading

logger = logging.getLogger(__name__)


class AutoCloseScheduler(threading.Thread):
    """
    Daemon thread that checks for due school-time cutoffs, including missed days.

    Args:
        db_conn:         Active SQLite connection (WAL-safe shared use).
        close_time:      "HH:MM" string for the daily auto-close (default "21:00").
        poll_interval:   Seconds between cutoff checks (default 30).
    """

    def __init__(self, db_conn, close_time: str = "21:00", poll_interval: int = 30) -> None:
        super().__init__(name="AutoCloseScheduler", daemon=True)
        self._conn = db_conn
        self._close_time = close_time
        self._poll_interval = poll_interval
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        logger.info(
            "AutoCloseScheduler started — auto-close job scheduled at %s daily.",
            self._close_time,
        )
        while not self._stop_event.is_set():
            import db
            try:
                db.recover_overdue(self._conn, close_time=self._close_time)
            except Exception:
                logger.exception('Cutoff recovery will retry.')
            self._stop_event.wait(self._poll_interval)
        logger.info("AutoCloseScheduler stopped.")

    # ------------------------------------------------------------------
    # The job
    # ------------------------------------------------------------------

    def _run_auto_close(self) -> None:
        """
        Force-close all ON_DUTY officers.
        Used only by trigger_now for explicit simulations.
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
                if db.record_transition(self._conn, uid, "CLOCK_OUT", is_auto_closed=True):
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
