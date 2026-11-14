"""
main.py
-------
Entry point for the NFC Attendance Daemon.

Wires together configuration, durable local attendance, Supabase device RPCs,
a persistent officer roster cache, the auto-close scheduler, and the NFC reader.
"""

import logging
import os
import signal
import sys
import time
from logging.handlers import RotatingFileHandler

import db
from config import load_config
from cloud import CloudClient
from supabase_sync import SupabaseSyncer, ReaderContext
from nfc_reader import NfcReader
from scheduler import AutoCloseScheduler
from state_machine import StateMachine, TapResult
from sound_feedback import SoundFeedback

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


def _on_event(uid: str, result: TapResult, feedback=None) -> None:
    label = _RESULT_EMOJI.get(result, str(result))
    if uid != "__timeout__":
        logger.info("[TAP]  uid=%-12s  →  %s", uid, label)
    else:
        logger.info("[TIMER] %s", label)
    if feedback is not None:
        feedback.on_result(result)


def _process_scan(uid, cfg, conn, cloud, registry, sm, syncer, feedback):
    """One scan; success means durable local recording, not cloud upload."""
    try:
        try:
            if cloud.tap(uid):
                logger.info('Card read for enrollment; attendance skipped.')
                feedback.play('success')
                return None
        except Exception:
            # Normal attendance remains available offline.
            pass
        try:
            registry.refresh()
        except Exception:
            pass
        db.recover_overdue(conn, close_time=cfg.auto_close_time)
        if uid != cfg.clock_out_tag_uid and not registry.is_enrolled(uid) and not registry.accepts_unknown_cards():
            try:
                registry.refresh()
            except Exception:
                pass
            if not registry.is_enrolled(uid) and not registry.accepts_unknown_cards():
                logger.info('Unknown cards require the updated server migration; refresh online before first use.')
                feedback.play('unsuccessful')
                return None
        if uid != cfg.clock_out_tag_uid and not registry.is_enrolled(uid):
            logger.info('Unlinked card: attendance will stay pending until an admin identifies its owner.')
        result = sm.process_tap(uid)
    except Exception:
        logger.exception('Could not process card %s; no successful scan acknowledged.', uid)
        feedback.play('unsuccessful')
        return None
    if result in (TapResult.CLOCKED_IN, TapResult.CLOCKED_OUT):
        # Cloud work is separate: a later upload failure must not change a
        # successfully recorded local scan into an unsuccessful sound.
        try:
            syncer.trigger()
        except Exception:
            logger.exception('Attendance was saved locally; upload will retry on the next sync cycle.')
    return result


# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------

def main() -> None:
    try:
        cfg = load_config()
    except (FileNotFoundError, ValueError, KeyError) as exc:
        print(f'[FATAL] {exc}', file=sys.stderr)
        sys.exit(1)
    _setup_logging(cfg.log_level)
    db.configure_timezone(cfg.attendance_timezone)
    db_path = cfg.db_path
    if not os.path.isabs(db_path):
        db_path = os.path.join(os.path.dirname(__file__), db_path)
    conn = db.get_connection(db_path)
    db.init_db(conn)
    db.recover_overdue(conn, close_time=cfg.auto_close_time)
    cloud = CloudClient(cfg.supabase_url, cfg.supabase_publishable_key, cfg.device_id, cfg.device_token)
    registry = ReaderContext(conn, cloud)
    try:
        registry.refresh()
        logger.info('Supabase connected; local officer roster refreshed.')
    except Exception as exc:
        logger.warning('Starting with the locally cached roster: %s', exc)
    syncer = SupabaseSyncer(conn, cloud, cfg.sync_interval_seconds)
    scheduler = AutoCloseScheduler(conn, cfg.auto_close_time)
    feedback = SoundFeedback(cfg.sounds_directory, enabled=cfg.sounds_enabled)
    sm = StateMachine(cfg, conn, lambda uid, result: _on_event(uid, result, feedback))
    reader = NfcReader(on_read_error=lambda: feedback.play('unsuccessful'))
    def shutdown(signum, frame):
        logger.info('Stopping NFC reader...')
        reader.stop()
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, shutdown)
    registry.start()
    syncer.start()
    scheduler.start()
    logger.info('Ready for NFC cards. Attendance is buffered locally before upload.')
    try:
        for uid in reader.poll():
            _process_scan(uid, cfg, conn, cloud, registry, sm, syncer, feedback)
    finally:
        reader.stop()
        sm.stop()
        feedback.close()
        registry.stop()
        syncer.stop()
        scheduler.stop()
        # Join before closing their shared SQLite connection.
        for worker in (registry, syncer, scheduler):
            worker.join()
        conn.close()
        logger.info('Daemon stopped; pending events remain safely in SQLite.')


if __name__ == '__main__':
    main()
