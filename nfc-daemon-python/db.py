"""
db.py
-----
SQLite helpers for the NFC attendance daemon.

Tables
------
sync_queue  — Offline buffer of attendance events waiting to be pushed to Firebase.
daily_state — Survives PC reboots; tracks each officer's clock-in status for today.

All functions accept an optional `conn` argument for testability (pass an in-memory
connection from tests rather than touching the real file).
"""

import logging
import sqlite3
from datetime import date, datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Schema DDL
# ---------------------------------------------------------------------------

_CREATE_SYNC_QUEUE = """
CREATE TABLE IF NOT EXISTS sync_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    card_uid        TEXT    NOT NULL,
    action_type     TEXT    NOT NULL CHECK(action_type IN ('CLOCK_IN', 'CLOCK_OUT')),
    timestamp       TEXT    NOT NULL,
    synced          INTEGER NOT NULL DEFAULT 0 CHECK(synced IN (0, 1)),
    is_auto_closed  INTEGER NOT NULL DEFAULT 0 CHECK(is_auto_closed IN (0, 1))
);
"""

_CREATE_DAILY_STATE = """
CREATE TABLE IF NOT EXISTS daily_state (
    card_uid        TEXT PRIMARY KEY,
    status          TEXT NOT NULL CHECK(status IN ('ON_DUTY', 'OFF_DUTY')),
    last_tap_date   TEXT NOT NULL
);
"""


# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------

def get_connection(db_path: str) -> sqlite3.Connection:
    """Open a SQLite connection with WAL mode for safe concurrent reads."""
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """Create tables if they don't already exist."""
    with conn:
        conn.execute(_CREATE_SYNC_QUEUE)
        conn.execute(_CREATE_DAILY_STATE)
    logger.info("Database initialised (sync_queue + daily_state tables ready).")


# ---------------------------------------------------------------------------
# sync_queue helpers
# ---------------------------------------------------------------------------

def log_event(
    conn: sqlite3.Connection,
    card_uid: str,
    action_type: str,
    is_auto_closed: bool = False,
    timestamp: Optional[str] = None,
) -> int:
    """
    Insert an attendance event into sync_queue.

    Args:
        conn:           Active SQLite connection.
        card_uid:       NFC tag UID (hex string).
        action_type:    "CLOCK_IN" or "CLOCK_OUT".
        is_auto_closed: True when triggered by the 9 PM auto-close job.
        timestamp:      ISO 8601 string. Defaults to current UTC time.

    Returns:
        The auto-assigned row ID.
    """
    if action_type not in ("CLOCK_IN", "CLOCK_OUT"):
        raise ValueError(f"Invalid action_type: {action_type!r}")

    ts = timestamp or datetime.now(timezone.utc).isoformat()
    with conn:
        cur = conn.execute(
            "INSERT INTO sync_queue (card_uid, action_type, timestamp, synced, is_auto_closed) "
            "VALUES (?, ?, ?, 0, ?)",
            (card_uid, action_type, ts, int(is_auto_closed)),
        )
    row_id = cur.lastrowid
    logger.info("Logged %s for uid=%s (row_id=%d, auto_closed=%s)", action_type, card_uid, row_id, is_auto_closed)
    return row_id


def get_unsynced_events(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """Return all sync_queue rows where synced = 0, ordered by id."""
    return conn.execute(
        "SELECT * FROM sync_queue WHERE synced = 0 ORDER BY id ASC"
    ).fetchall()


def mark_synced(conn: sqlite3.Connection, row_id: int) -> None:
    """Mark a sync_queue row as successfully pushed to Firebase."""
    with conn:
        conn.execute("UPDATE sync_queue SET synced = 1 WHERE id = ?", (row_id,))
    logger.debug("Marked sync_queue row %d as synced.", row_id)


# ---------------------------------------------------------------------------
# daily_state helpers
# ---------------------------------------------------------------------------

def get_daily_status(conn: sqlite3.Connection, card_uid: str) -> Optional[str]:
    """
    Return the officer's status for today, or None if no record for today.

    Returns:
        "ON_DUTY", "OFF_DUTY", or None (no record today or stale record).
    """
    today = date.today().isoformat()
    row = conn.execute(
        "SELECT status FROM daily_state WHERE card_uid = ? AND last_tap_date = ?",
        (card_uid, today),
    ).fetchone()
    return row["status"] if row else None


def set_daily_status(conn: sqlite3.Connection, card_uid: str, status: str) -> None:
    """
    Upsert the officer's status for today.

    Args:
        conn:     Active SQLite connection.
        card_uid: NFC tag UID.
        status:   "ON_DUTY" or "OFF_DUTY".
    """
    if status not in ("ON_DUTY", "OFF_DUTY"):
        raise ValueError(f"Invalid status: {status!r}")

    today = date.today().isoformat()
    with conn:
        conn.execute(
            """
            INSERT INTO daily_state (card_uid, status, last_tap_date)
            VALUES (?, ?, ?)
            ON CONFLICT(card_uid) DO UPDATE SET
                status = excluded.status,
                last_tap_date = excluded.last_tap_date
            """,
            (card_uid, status, today),
        )
    logger.debug("Set daily_state: uid=%s status=%s date=%s", card_uid, status, today)


def get_all_on_duty(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """
    Return all daily_state rows where status = ON_DUTY for today.
    Used by the 9 PM auto-close scheduler.
    """
    today = date.today().isoformat()
    return conn.execute(
        "SELECT * FROM daily_state WHERE status = 'ON_DUTY' AND last_tap_date = ?",
        (today,),
    ).fetchall()


def reset_daily_state(conn: sqlite3.Connection) -> int:
    """
    Set all ON_DUTY rows to OFF_DUTY (called after auto-close job).
    Returns the number of rows updated.
    """
    today = date.today().isoformat()
    with conn:
        cur = conn.execute(
            "UPDATE daily_state SET status = 'OFF_DUTY' WHERE status = 'ON_DUTY' AND last_tap_date = ?",
            (today,),
        )
    count = cur.rowcount
    logger.info("reset_daily_state: marked %d officers as OFF_DUTY.", count)
    return count
