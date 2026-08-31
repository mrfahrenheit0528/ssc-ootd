"""
main.py
-------
Entry point for the NFC Attendance Daemon.

Wires together:
  - Config loading
  - SQLite initialisation (offline-first)
  - Firebase Admin SDK initialisation (optional — daemon works offline without it)
  - FirebaseSyncer background thread (Phase 3)
  - AutoCloseScheduler background thread (Phase 4)
  - State machine
  - NFC reader polling loop
  - Graceful shutdown on SIGINT / SIGTERM
"""

import logging
import os
import signal
import sys
import time
from logging.handlers import RotatingFileHandler

import db
from config import load_config
from firebase_sync import FirebaseSyncer
from nfc_reader import NfcReader
from scheduler import AutoCloseScheduler
from state_machine import StateMachine, TapResult

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

def _setup_logging(log_level: str, log_dir: str = "logs") -> None:
    os.makedirs(log_dir, exist_ok=True)
    level = getattr(logging, log_level.upper(), logging.INFO)

    fmt = logging.Formatter(
        "%(asctime)s  %(levelname)-8s  %(name)-20s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Rotating file handler — max 5 MB × 3 backups
    fh = RotatingFileHandler(
        os.path.join(log_dir, "daemon.log"),
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    fh.setFormatter(fmt)

    # Console handler
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)

    root = logging.getLogger()
    root.setLevel(level)
    root.addHandler(fh)
    root.addHandler(ch)


# ---------------------------------------------------------------------------
# Event callback — pretty-prints results to the console / log
# ---------------------------------------------------------------------------

_RESULT_EMOJI = {
    TapResult.CLOCKED_IN:                 "✅  CLOCK IN",
    TapResult.CLOCKED_OUT:                "🔴  CLOCK OUT",
    TapResult.IGNORED_DEBOUNCE:           "⏩  IGNORED (debounce)",
    TapResult.IGNORED_ALREADY_CLOCKED_IN: "⚠️   IGNORED (already clocked in today)",
    TapResult.IGNORED_NOT_ON_DUTY:        "⚠️   IGNORED (not ON_DUTY — cannot clock out)",
    TapResult.CLOCK_OUT_MODE_ACTIVATED:   "🔔  CLOCK-OUT MODE — waiting for officer tap…",
    TapResult.CLOCK_OUT_MODE_TIMEOUT:     "⏰  Clock-out window expired / cancelled.",
    TapResult.UNKNOWN_TAG:                "❓  Unknown tag",
}

logger = logging.getLogger("main")


def _on_event(uid: str, result: TapResult) -> None:
    label = _RESULT_EMOJI.get(result, str(result))
    if uid != "__timeout__":
        logger.info("[TAP]  uid=%-12s  →  %s", uid, label)
    else:
        logger.info("[TIMER] %s", label)


# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------

_running = True


def _handle_signal(signum, frame):  # noqa: ANN001
    global _running
    logger.info("Shutdown signal received (%s). Stopping…", signal.Signals(signum).name)
    _running = False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _init_firebase(cfg) -> object | None:
    """
    Attempt to initialise the Firebase Admin SDK.

    Returns the Firestore client on success, or None if the service account key
    is missing / invalid (daemon continues in offline-only mode).
    """
    import os
    key_path = cfg.service_account_key_path
    if not os.path.exists(key_path):
        logger.warning(
            "serviceAccountKey.json not found at '%s'. "
            "Running in OFFLINE mode — events will accumulate in SQLite "
            "and sync once the key is added and the daemon is restarted.",
            key_path,
        )
        return None

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore as fb_firestore

        cred = credentials.Certificate(key_path)
        firebase_admin.initialize_app(cred, {"projectId": cfg.firebase_project_id})
        client = fb_firestore.client()
        logger.info("Firebase Admin SDK initialised (project=%s).", cfg.firebase_project_id)
        return client
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Firebase initialisation failed: %s. Running in OFFLINE mode.", exc
        )
        return None


def _publish_live_tap(firestore_client, uid: str) -> None:
    """Publish the most recent card tap to Firestore so the web modal auto-fills instantly."""
    if firestore_client is None:
        return
    import threading
    from datetime import datetime, timezone

    def _worker():
        try:
            firestore_client.collection("system_settings").document("live_scanner").set({
                "latest_uid": uid,
                "timestamp": datetime.now(timezone.utc),
            }, merge=True)
            logger.debug("Published live tap uid=%s to Firestore", uid)
        except Exception as exc:
            logger.debug("Could not publish live tap: %s", exc)

    threading.Thread(target=_worker, daemon=True).start()


def main() -> None:
    # ── Config ──────────────────────────────────────────────────────────────
    try:
        cfg = load_config()
    except FileNotFoundError as exc:
        print(f"[FATAL] {exc}", file=sys.stderr)
        sys.exit(1)

    _setup_logging(cfg.log_level)
    logger.info("=" * 60)
    logger.info("NFC Attendance Daemon starting")
    logger.info("=" * 60)

    # ── Database ─────────────────────────────────────────────────────────────
    conn = db.get_connection(cfg.db_path)
    db.init_db(conn)

    # ── Firebase (optional — offline fallback if key missing) ────────────────
    firestore_client = _init_firebase(cfg)

    # ── Background threads ───────────────────────────────────────────────────
    syncer: FirebaseSyncer | None = None
    scheduler: AutoCloseScheduler | None = None

    if firestore_client is not None:
        syncer = FirebaseSyncer(
            db_conn=conn,
            firestore_client=firestore_client,
            sync_interval=cfg.sync_interval_seconds,
        )
        syncer.start()
        logger.info("FirebaseSyncer thread started.")
    else:
        logger.warning("FirebaseSyncer NOT started (no Firebase client).")

    scheduler = AutoCloseScheduler(
        db_conn=conn,
        close_time=cfg.auto_close_time,
    )
    scheduler.start()
    logger.info("AutoCloseScheduler thread started (fires at %s).", cfg.auto_close_time)

    # ── State machine ────────────────────────────────────────────────────────
    sm = StateMachine(cfg=cfg, conn=conn, on_event=_on_event)

    # ── Signals ──────────────────────────────────────────────────────────────
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    # ── NFC reader ───────────────────────────────────────────────────────────
    reader = NfcReader()

    logger.info("Ready. Waiting for NFC tags… (Ctrl+C to stop)")
    logger.info("Clock-out tag UID: %s", cfg.clock_out_tag_uid)

    try:
        for uid in reader.poll():
            if not _running:
                break
            _publish_live_tap(firestore_client, uid)
            sm.process_tap(uid)
    finally:
        reader.stop()
        if syncer:
            syncer.stop()
        if scheduler:
            scheduler.stop()
        conn.close()
        logger.info("Daemon stopped cleanly.")


if __name__ == "__main__":
    main()
