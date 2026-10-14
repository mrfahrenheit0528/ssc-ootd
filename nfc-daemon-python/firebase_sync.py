"""
firebase_sync.py
----------------
Background daemon thread that drains the SQLite sync_queue into Firebase Firestore.

Behaviour
---------
* Wakes every `sync_interval_seconds` (default 10 s).
* Fetches all rows where synced = 0.
* For each row:
    1. Resolves the officer's name from the Firestore `officers` collection
       (caches lookups in memory to minimise Firestore reads).
    2. Writes a document to `attendance_logs`.
    3. Updates `officers/{card_uid}.status` in Firestore.
    4. Marks the local row synced = 1.
* On any network / Firestore error: logs the error, skips the batch,
  retries on the next cycle (offline-first guarantee).

Threading
---------
Runs as a daemon thread so it exits automatically when the main process dies.
Shares the SQLite connection with the main thread — WAL mode makes this safe.
"""

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# Lazy imports — only resolved when Firebase is actually initialised
_firestore = None  # google.cloud.firestore module reference


def _get_firestore():
    global _firestore
    if _firestore is None:
        from google.cloud import firestore  # noqa: PLC0415
        _firestore = firestore
    return _firestore


class FirebaseSyncer(threading.Thread):
    """
    Daemon thread: drains SQLite sync_queue → Firestore.

    Args:
        db_conn:            Active SQLite connection (shared, WAL-safe).
        firestore_client:   An initialised `google.cloud.firestore.Client`.
        sync_interval:      Seconds between sync attempts (default 10).
    """

    def __init__(self, db_conn, firestore_client, sync_interval: int = 10) -> None:
        super().__init__(name="FirebaseSyncer", daemon=True)
        self._conn = db_conn
        self._db = firestore_client
        self._sync_interval = sync_interval
        self._stop_event    = threading.Event()
        self._trigger_event = threading.Event()  # set to wake the loop immediately
        self._syncing_lock  = threading.Lock()   # prevents overlapping sync cycles

        # In-memory cache: card_uid → {"first_name": str, "last_name": str}
        self._officer_cache: dict[str, dict] = {}

    def stop(self) -> None:
        """Signal the thread to exit after the current cycle."""
        self._stop_event.set()
        self._trigger_event.set()  # unblock the wait so the thread exits quickly

    def trigger(self) -> None:
        """
        Wake the sync loop immediately instead of waiting for the next interval.
        Call this right after a successful clock-in or clock-out.
        """
        self._trigger_event.set()

    def prefetch_officers(self) -> None:
        """
        Pre-load all enrolled officers into the in-memory cache.
        Call once after the syncer starts to eliminate Firestore reads
        on the first clock-in of each officer.
        """
        try:
            docs = self._db.collection("officers").stream()
            count = 0
            for doc in docs:
                self._officer_cache[doc.id.upper()] = doc.to_dict() or {}
                count += 1
            logger.info("Officer cache pre-warmed: %d officer(s) loaded.", count)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not pre-warm officer cache: %s", exc)

    def run(self) -> None:
        logger.info("FirebaseSyncer started (interval=%ds, instant-trigger enabled).", self._sync_interval)
        while not self._stop_event.is_set():
            # Wait until either the interval elapses OR trigger() is called
            self._trigger_event.wait(timeout=self._sync_interval)
            self._trigger_event.clear()

            if self._stop_event.is_set():
                break

            with self._syncing_lock:
                try:
                    self._sync_cycle()
                except Exception as exc:  # noqa: BLE001
                    logger.error("Unexpected error in sync cycle: %s", exc, exc_info=True)

        logger.info("FirebaseSyncer stopped.")

    # ------------------------------------------------------------------
    # Core sync logic
    # ------------------------------------------------------------------

    def _sync_cycle(self) -> None:
        """Fetch and push all pending rows from sync_queue."""
        import db  # local import to avoid circular deps at module level

        rows = db.get_unsynced_events(self._conn)
        if not rows:
            return

        logger.info("Syncing %d pending event(s) to Firestore…", len(rows))

        for row in rows:
            try:
                self._push_row(row)
                db.mark_synced(self._conn, row["id"])
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Failed to sync row id=%d (uid=%s): %s — will retry.",
                    row["id"], row["card_uid"], exc,
                )

    def _push_row(self, row) -> None:
        """
        Push a single sync_queue row to Firestore using a batch write:
          1. Add to attendance_logs collection.
          2. Update officers/{card_uid}.status.
        Both writes go in one network round trip via batch.commit().
        """
        card_uid: str = row["card_uid"].upper()
        action_type: str = row["action_type"]      # "CLOCK_IN" or "CLOCK_OUT"
        timestamp_str: str = row["timestamp"]       # ISO 8601 UTC
        is_auto_closed: bool = bool(row["is_auto_closed"])

        officer_info = self._resolve_officer(card_uid)
        officer_name = (
            f"{officer_info['first_name']} {officer_info['last_name']}"
            if officer_info
            else card_uid  # fallback: show UID if officer not enrolled yet
        )

        # Parse timestamp to a Python datetime for Firestore
        ts = datetime.fromisoformat(timestamp_str)

        new_status = "ON_DUTY" if action_type == "CLOCK_IN" else "OFF_DUTY"

        # ── Batch both writes into a single network round trip ───────────────
        batch = self._db.batch()

        # attendance_logs document (auto-generated ID)
        log_ref = self._db.collection("attendance_logs").document()
        batch.set(log_ref, {
            "card_uid":      card_uid,
            "officer_name":  officer_name,
            "type":          action_type,
            "timestamp":     ts,
            "is_auto_closed": is_auto_closed,
        })

        # officers/{card_uid} status update
        officer_ref = self._db.collection("officers").document(card_uid)
        batch.set(officer_ref, {"status": new_status}, merge=True)

        batch.commit()  # single network call instead of two sequential ones
        logger.debug(
            "Batch committed: attendance_log + officers/%s status=%s (%s)",
            card_uid, new_status, officer_name,
        )

    # ------------------------------------------------------------------
    # Officer name resolution (with in-memory cache)
    # ------------------------------------------------------------------

    def _resolve_officer(self, card_uid: str) -> Optional[dict]:
        """
        Fetch officer info from Firestore (cached).

        Returns:
            {"first_name": str, "last_name": str, ...} or None if not found.
        """
        if card_uid in self._officer_cache:
            return self._officer_cache[card_uid]

        try:
            doc = self._db.collection("officers").document(card_uid).get()
            if doc.exists:
                data = doc.to_dict()
                self._officer_cache[card_uid] = data
                return data
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not resolve officer for uid=%s: %s", card_uid, exc)

        return None

    def invalidate_cache(self, card_uid: Optional[str] = None) -> None:
        """
        Clear the officer name cache (call this after roster edits).

        Args:
            card_uid: If given, evict only that entry. If None, clear all.
        """
        if card_uid:
            self._officer_cache.pop(card_uid, None)
        else:
            self._officer_cache.clear()
