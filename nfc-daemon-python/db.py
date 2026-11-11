"""
db.py
-----
SQLite helpers for the NFC attendance daemon.

Tables
------
sync_queue  — Offline buffer of attendance events waiting to be pushed to Supabase.
daily_state — Survives PC reboots; tracks each officer's clock-in status for today.

All functions accept an optional `conn` argument for testability (pass an in-memory
connection from tests rather than touching the real file).
"""

import logging
import sqlite3
from datetime import date, datetime, timezone, timedelta
from functools import wraps
import json
import threading
from uuid import uuid4, UUID
import hashlib
from zoneinfo import ZoneInfo

_LOCK = threading.RLock()
_ATTENDANCE_ZONE = ZoneInfo("Asia/Manila")

def synchronized(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        with _LOCK:
            return fn(*args, **kwargs)
    return wrapped

def configure_timezone(name):
    global _ATTENDANCE_ZONE
    _ATTENDANCE_ZONE = ZoneInfo(name)

def today_key():
    return datetime.now(_ATTENDANCE_ZONE).date().isoformat()
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


@synchronized
def init_db(conn: sqlite3.Connection) -> None:
    """Create tables if they don't already exist."""
    with conn:
        conn.execute(_CREATE_SYNC_QUEUE)
        conn.execute(_CREATE_DAILY_STATE)
        columns = {r[1] for r in conn.execute('PRAGMA table_info(sync_queue)')}
        if 'event_id' not in columns:
            conn.execute('ALTER TABLE sync_queue ADD COLUMN event_id TEXT')
        for row in conn.execute('SELECT id FROM sync_queue WHERE event_id IS NULL').fetchall():
            conn.execute('UPDATE sync_queue SET event_id=? WHERE id=?', (str(uuid4()), row[0]))
        conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS queue_event_id ON sync_queue(event_id)')
        state_columns = {r[1] for r in conn.execute('PRAGMA table_info(daily_state)')}
        for column in ('last_event_id', 'last_event_at'):
            if column not in state_columns:
                conn.execute(f'ALTER TABLE daily_state ADD COLUMN {column} TEXT')
        conn.execute('CREATE TABLE IF NOT EXISTS reader_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        conn.execute('CREATE TABLE IF NOT EXISTS officer_cache (card_uid TEXT PRIMARY KEY, data TEXT NOT NULL)')
    logger.info("Database initialised (sync_queue + daily_state tables ready).")


# ---------------------------------------------------------------------------
# sync_queue helpers
# ---------------------------------------------------------------------------

@synchronized
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
            "INSERT INTO sync_queue (card_uid, action_type, timestamp, synced, is_auto_closed, event_id) "
            "VALUES (?, ?, ?, 0, ?, ?)",
            (card_uid, action_type, ts, int(is_auto_closed), str(uuid4())),
        )
    row_id = cur.lastrowid
    logger.info("Logged %s for uid=%s (row_id=%d, auto_closed=%s)", action_type, card_uid, row_id, is_auto_closed)
    return row_id


@synchronized
def get_unsynced_events(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """Return all sync_queue rows where synced = 0, ordered by id."""
    return conn.execute(
        "SELECT * FROM sync_queue WHERE synced = 0 ORDER BY id ASC"
    ).fetchall()


@synchronized
def mark_synced(conn: sqlite3.Connection, row_id: int) -> None:
    """Mark a sync_queue row as successfully pushed to Supabase."""
    with conn:
        conn.execute("UPDATE sync_queue SET synced = 1 WHERE id = ?", (row_id,))
    logger.debug("Marked sync_queue row %d as synced.", row_id)


# ---------------------------------------------------------------------------
# daily_state helpers
# ---------------------------------------------------------------------------

@synchronized
def get_daily_status(conn: sqlite3.Connection, card_uid: str) -> Optional[str]:
    """
    Return the officer's status for today, or None if no record for today.

    Returns:
        "ON_DUTY", "OFF_DUTY", or None (no record today or stale record).
    """
    today = today_key()
    row = conn.execute(
        "SELECT status FROM daily_state WHERE card_uid = ? AND last_tap_date = ?",
        (card_uid, today),
    ).fetchone()
    return row["status"] if row else None


@synchronized
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

    today = today_key()
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


@synchronized
def get_all_on_duty(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """
    Return all daily_state rows where status = ON_DUTY for today.
    Used by the 9 PM auto-close scheduler.
    """
    today = today_key()
    return conn.execute(
        "SELECT * FROM daily_state WHERE status = 'ON_DUTY' AND last_tap_date = ?",
        (today,),
    ).fetchall()


@synchronized
def reset_daily_state(conn: sqlite3.Connection) -> int:
    """
    Set all ON_DUTY rows to OFF_DUTY (called after auto-close job).
    Returns the number of rows updated.
    """
    today = today_key()
    with conn:
        cur = conn.execute(
            "UPDATE daily_state SET status = 'OFF_DUTY' WHERE status = 'ON_DUTY' AND last_tap_date = ?",
            (today,),
        )
    count = cur.rowcount
    logger.info("reset_daily_state: marked %d officers as OFF_DUTY.", count)
    return count


@synchronized
def record_transition(conn, card_uid, action_type, is_auto_closed=False):
    """Check status and commit the event plus new daily status atomically."""
    current = get_daily_status(conn, card_uid)
    if (action_type == 'CLOCK_IN' and current == 'ON_DUTY') or (action_type == 'CLOCK_OUT' and current != 'ON_DUTY'):
        return False
    status = 'ON_DUTY' if action_type == 'CLOCK_IN' else 'OFF_DUTY'
    ts, event_id = datetime.now(timezone.utc).isoformat(), str(uuid4())
    with conn:
        conn.execute('INSERT INTO sync_queue(card_uid,action_type,timestamp,is_auto_closed,event_id) VALUES (?,?,?,?,?)',
                     (card_uid, action_type, ts, int(is_auto_closed), event_id))
        conn.execute("INSERT INTO daily_state(card_uid,status,last_tap_date,last_event_id,last_event_at) VALUES (?,?,?,?,?) "
                     "ON CONFLICT(card_uid) DO UPDATE SET status=excluded.status,last_tap_date=excluded.last_tap_date,last_event_id=excluded.last_event_id,last_event_at=excluded.last_event_at",
                     (card_uid,status,today_key(),event_id,ts))
    return True


@synchronized
def save_roster(conn, officers):
    with conn:
        conn.execute('DELETE FROM officer_cache')
        conn.executemany('INSERT INTO officer_cache(card_uid,data) VALUES (?,?)',
                         [(o['card_uid'].upper(),json.dumps(o)) for o in officers])


@synchronized
def is_enrolled(conn, uid):
    return conn.execute('SELECT 1 FROM officer_cache WHERE card_uid=?',(uid.upper(),)).fetchone() is not None

@synchronized
def accepts_unknown_cards(conn):
    row=conn.execute("SELECT value FROM reader_metadata WHERE key='accept_unknown_cards'").fetchone()
    return bool(row and row[0]=='1')


def auto_close_id(clock_in_id):
    # Matches PostgreSQL md5(id::text || ':auto-close')::uuid, including UUID bits.
    return str(UUID(hex=hashlib.md5((clock_in_id + ':auto-close').encode()).hexdigest()))


def parse_time(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


@synchronized
def context_event_ids(conn):
    ids = [r['event_id'] for r in conn.execute('SELECT event_id,timestamp FROM sync_queue').fetchall()
           if parse_time(r['timestamp']).astimezone(_ATTENDANCE_ZONE).date().isoformat() == today_key()]
    if len(ids) > 5000:
        raise RuntimeError('Too many daily events to reconcile safely; attendance remains queued.')
    return ids


@synchronized
def reconcile_context(conn, context):
    """Merge an authoritative snapshot with events not yet present on the server.

    Stable known IDs include tombstones and timestamp edits. Local rows created
    or acknowledged while the request was in flight still survive the merge.
    This never deletes the upload queue or overwrites an unsent officer tap.
    """
    snapshot = context['snapshot_at']
    previous = conn.execute("SELECT value FROM reader_metadata WHERE key='snapshot_at'").fetchone()
    if previous and parse_time(previous[0]) >= parse_time(snapshot):
        return False
    day = context['date']
    known = set(context.get('known_event_ids', []))
    events = {e['id']: e for e in context['events'] if not e.get('deleted_at')}
    for row in conn.execute('SELECT * FROM sync_queue').fetchall():
        if row['event_id'] not in known and parse_time(row['timestamp']).astimezone(_ATTENDANCE_ZONE).date().isoformat() == day:
            events[row['event_id']] = {'id':row['event_id'],'card_uid':row['card_uid'],'timestamp':row['timestamp'],'type':row['action_type'],'is_auto_closed':bool(row['is_auto_closed'])}
    latest = {}
    for event in sorted(events.values(), key=lambda e:(parse_time(e['timestamp']), bool(e.get('is_auto_closed')), e.get('created_at',''), e['id'])):
        if parse_time(event['timestamp']).astimezone(_ATTENDANCE_ZONE).date().isoformat() == day:
            latest[event['card_uid']] = event
    with conn:
        conn.execute("UPDATE daily_state SET status='OFF_DUTY' WHERE last_tap_date=?",(day,))
        for uid,event in latest.items():
            conn.execute("INSERT INTO daily_state(card_uid,status,last_tap_date,last_event_id,last_event_at) VALUES (?,?,?,?,?) "
                         "ON CONFLICT(card_uid) DO UPDATE SET status=excluded.status,last_tap_date=excluded.last_tap_date,last_event_id=excluded.last_event_id,last_event_at=excluded.last_event_at",
                         (uid,'ON_DUTY' if event['type']=='CLOCK_IN' else 'OFF_DUTY',day,event['id'],event['timestamp']))
        conn.execute("INSERT INTO reader_metadata(key,value) VALUES ('snapshot_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(snapshot,))
        conn.execute("INSERT INTO reader_metadata(key,value) VALUES ('accept_unknown_cards',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",('1' if context.get('accept_unknown_cards',False) else '0',))
    return True


@synchronized
def recover_overdue(conn, now=None, close_time='21:00'):
    """Recover missed cutoffs across reboots, retaining the original duty date."""
    now = now or datetime.now(timezone.utc)
    count = 0
    with conn:
        for row in conn.execute("SELECT * FROM daily_state WHERE status='ON_DUTY'").fetchall():
            cutoff = datetime.fromisoformat(row['last_tap_date']+'T'+close_time).replace(tzinfo=_ATTENDANCE_ZONE)
            event_id, event_at = row['last_event_id'], row['last_event_at']
            if not event_id:
                old = conn.execute("SELECT event_id,timestamp FROM sync_queue WHERE card_uid=? AND action_type='CLOCK_IN' ORDER BY timestamp DESC,id DESC LIMIT 1",(row['card_uid'],)).fetchone()
                if old: event_id,event_at = old
            if event_at: cutoff = max(cutoff,parse_time(event_at)+timedelta(microseconds=1))
            if cutoff > now: continue
            # Legacy state-only rows have no source UUID; retain a stable fallback.
            event_id = auto_close_id(event_id or row['card_uid']+':'+row['last_tap_date'])
            conn.execute('INSERT OR IGNORE INTO sync_queue(card_uid,action_type,timestamp,is_auto_closed,event_id) VALUES (?,?,?,?,?)',
                         (row['card_uid'],'CLOCK_OUT',cutoff.isoformat(),1,event_id))
            conn.execute("UPDATE daily_state SET status='OFF_DUTY',last_event_id=?,last_event_at=? WHERE card_uid=?",(event_id,cutoff.isoformat(),row['card_uid']))
            count += 1
    return count
