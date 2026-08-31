"""
state_machine.py
----------------
Core state machine for the NFC attendance daemon.

States
------
DEFAULT              — Normal operating mode. Officer taps clock in.
WAITING_FOR_CLOCK_OUT — Clock-out tag was tapped; next officer tap within the
                       window will clock that officer out.

Concurrency
-----------
All public methods are called from the NFC polling thread. The 15-second timer
fires on a separate threading.Timer thread. A threading.Lock protects `_mode`
and `_timer` so both threads can safely read/write state.
"""

import logging
import threading
from datetime import datetime, timezone
from enum import Enum, auto
from typing import Callable, Optional

import db
from config import AppConfig

logger = logging.getLogger(__name__)


class Mode(Enum):
    DEFAULT = auto()
    WAITING_FOR_CLOCK_OUT = auto()


# ---------------------------------------------------------------------------
# Action result codes returned by process_tap() — useful for tests & logging
# ---------------------------------------------------------------------------

class TapResult(Enum):
    CLOCKED_IN = "CLOCKED_IN"
    CLOCKED_OUT = "CLOCKED_OUT"
    IGNORED_DEBOUNCE = "IGNORED_DEBOUNCE"
    IGNORED_ALREADY_CLOCKED_IN = "IGNORED_ALREADY_CLOCKED_IN"
    IGNORED_NOT_ON_DUTY = "IGNORED_NOT_ON_DUTY"
    CLOCK_OUT_MODE_ACTIVATED = "CLOCK_OUT_MODE_ACTIVATED"
    CLOCK_OUT_MODE_TIMEOUT = "CLOCK_OUT_MODE_TIMEOUT"
    UNKNOWN_TAG = "UNKNOWN_TAG"


class StateMachine:
    """
    Implements the NFC attendance state machine.

    Args:
        cfg:          Loaded AppConfig (provides UIDs, timeouts, etc.)
        conn:         Active SQLite connection.
        on_event:     Optional callback invoked after every processed tap.
                      Signature: on_event(uid: str, result: TapResult) -> None
                      Useful for UI notifications (Phase 5+).
    """

    def __init__(
        self,
        cfg: AppConfig,
        conn,
        on_event: Optional[Callable[[str, TapResult], None]] = None,
    ) -> None:
        self._cfg = cfg
        self._conn = conn
        self._on_event = on_event

        self._mode = Mode.DEFAULT
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None

        # Debounce tracker: {uid: last_tap_epoch_float}
        self._last_tap_times: dict[str, float] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def process_tap(self, uid: str) -> TapResult:
        """
        Main entry point called for every NFC tag detection.

        Args:
            uid: UPPERCASE hex UID string (e.g. "A1B2C3D4").

        Returns:
            TapResult describing what happened.
        """
        uid = uid.upper().strip()

        with self._lock:
            # 1. Debounce check
            if self._is_debounced(uid):
                logger.debug("Debounced tap ignored for uid=%s", uid)
                result = TapResult.IGNORED_DEBOUNCE
                self._emit(uid, result)
                return result

            self._record_tap_time(uid)

            # 2. Dispatch based on current mode
            if uid == self._cfg.clock_out_tag_uid:
                result = self._handle_clock_out_tag()
            elif self._mode == Mode.DEFAULT:
                result = self._handle_default_mode(uid)
            elif self._mode == Mode.WAITING_FOR_CLOCK_OUT:
                result = self._handle_clock_out_mode(uid)
            else:
                result = TapResult.UNKNOWN_TAG

        self._emit(uid, result)
        return result

    def get_mode(self) -> Mode:
        """Return current mode (thread-safe)."""
        with self._lock:
            return self._mode

    # ------------------------------------------------------------------
    # Internal handlers
    # ------------------------------------------------------------------

    def _handle_clock_out_tag(self) -> TapResult:
        """The designated clock-out tag was tapped."""
        if self._mode == Mode.WAITING_FOR_CLOCK_OUT:
            # Already in clock-out mode — re-tap cancels & restores default
            logger.info("Clock-out tag re-tapped. Cancelling clock-out mode.")
            self._cancel_timer()
            self._mode = Mode.DEFAULT
            return TapResult.CLOCK_OUT_MODE_TIMEOUT  # treated as a cancel

        logger.info(
            "Clock-out tag detected. Entering WAITING_FOR_CLOCK_OUT mode. "
            "Officer has %ds to tap their card.",
            self._cfg.clock_out_window_seconds,
        )
        self._mode = Mode.WAITING_FOR_CLOCK_OUT
        self._start_timer()
        return TapResult.CLOCK_OUT_MODE_ACTIVATED

    def _handle_default_mode(self, uid: str) -> TapResult:
        """Officer tapped while in DEFAULT mode → try to clock in."""
        status = db.get_daily_status(self._conn, uid)

        if status == "ON_DUTY":
            logger.info("uid=%s already ON_DUTY today — tap ignored.", uid)
            return TapResult.IGNORED_ALREADY_CLOCKED_IN

        # No record today (None) or previously clocked out (OFF_DUTY after auto-close)
        db.log_event(self._conn, uid, "CLOCK_IN")
        db.set_daily_status(self._conn, uid, "ON_DUTY")
        logger.info("CLOCK_IN logged for uid=%s.", uid)
        return TapResult.CLOCKED_IN

    def _handle_clock_out_mode(self, uid: str) -> TapResult:
        """Officer tapped while in WAITING_FOR_CLOCK_OUT mode → try to clock out."""
        status = db.get_daily_status(self._conn, uid)

        if status != "ON_DUTY":
            logger.warning(
                "uid=%s tapped during clock-out window but status=%s — ignoring.",
                uid, status,
            )
            return TapResult.IGNORED_NOT_ON_DUTY

        db.log_event(self._conn, uid, "CLOCK_OUT")
        db.set_daily_status(self._conn, uid, "OFF_DUTY")
        logger.info("CLOCK_OUT logged for uid=%s.", uid)

        self._cancel_timer()
        self._mode = Mode.DEFAULT
        return TapResult.CLOCKED_OUT

    # ------------------------------------------------------------------
    # Timer helpers
    # ------------------------------------------------------------------

    def _start_timer(self) -> None:
        """Start the 15-second clock-out window countdown."""
        self._cancel_timer()
        self._timer = threading.Timer(
            self._cfg.clock_out_window_seconds,
            self._on_clock_out_timeout,
        )
        self._timer.daemon = True
        self._timer.start()

    def _cancel_timer(self) -> None:
        """Cancel any pending clock-out timer."""
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    def _on_clock_out_timeout(self) -> None:
        """Called on a Timer thread when the clock-out window expires."""
        with self._lock:
            if self._mode == Mode.WAITING_FOR_CLOCK_OUT:
                logger.info(
                    "Clock-out window expired (%ds). Reverting to DEFAULT mode.",
                    self._cfg.clock_out_window_seconds,
                )
                self._mode = Mode.DEFAULT
                self._timer = None
        self._emit("__timeout__", TapResult.CLOCK_OUT_MODE_TIMEOUT)

    # ------------------------------------------------------------------
    # Debounce helpers
    # ------------------------------------------------------------------

    def _is_debounced(self, uid: str) -> bool:
        """Return True if this UID was tapped within the debounce window."""
        last = self._last_tap_times.get(uid)
        if last is None:
            return False
        elapsed = datetime.now(timezone.utc).timestamp() - last
        return elapsed < self._cfg.debounce_seconds

    def _record_tap_time(self, uid: str) -> None:
        """Update the last-tap timestamp for this UID."""
        self._last_tap_times[uid] = datetime.now(timezone.utc).timestamp()

    # ------------------------------------------------------------------
    # Event emission
    # ------------------------------------------------------------------

    def _emit(self, uid: str, result: TapResult) -> None:
        """Invoke the optional on_event callback (outside the lock)."""
        if self._on_event:
            try:
                self._on_event(uid, result)
            except Exception as exc:  # noqa: BLE001
                logger.error("on_event callback error: %s", exc)
