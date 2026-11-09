"""Drain the durable SQLite queue in order; stable UUIDs make retries safe."""
import logging
import threading

import db

logger = logging.getLogger(__name__)


class SupabaseSyncer(threading.Thread):
    def __init__(self, db_conn, cloud_client, sync_interval=10):
        super().__init__(name='SupabaseSyncer', daemon=True)
        self._conn = db_conn
        self._cloud = cloud_client
        self._interval = sync_interval
        self._stop_event = threading.Event()
        self._trigger = threading.Event()

    def trigger(self):
        self._trigger.set()

    def stop(self):
        self._stop_event.set()
        self._trigger.set()

    def run(self):
        while not self._stop_event.is_set():
            try:
                self._sync_cycle()
            except Exception as exc:
                logger.warning('Attendance upload pending: %s', exc)
            self._trigger.wait(self._interval)
            self._trigger.clear()

    def _sync_cycle(self):
        rows = db.get_unsynced_events(self._conn)
        for start in range(0, len(rows), 100):
            if self._stop_event.is_set():
                return
            batch = rows[start:start + 100]
            events = [{'event_id': row['event_id'], 'card_uid': row['card_uid'],
                       'action_type': row['action_type'], 'timestamp': row['timestamp'],
                       'is_auto_closed': bool(row['is_auto_closed'])} for row in batch]
            # The RPC commits the whole batch or none of it. If its response is
            # lost, retrying the persisted IDs cannot create duplicate records.
            accepted = self._cloud.ingest(events)
            if accepted != len(events):
                raise RuntimeError('Unexpected upload acknowledgement; keeping events queued.')
            for row in batch:
                db.mark_synced(self._conn, row['id'])


class ReaderContext(threading.Thread):
    """Persist the roster so known cards continue working after an offline reboot."""
    def __init__(self, db_conn, cloud_client, interval=30):
        super().__init__(name='ReaderContext', daemon=True)
        self._conn = db_conn
        self._cloud = cloud_client
        self._interval = interval
        self._stop_event = threading.Event()

    def refresh(self):
        context = self._cloud.context()
        db.save_roster(self._conn, context['officers'])
        return context

    def is_enrolled(self, uid):
        return db.is_enrolled(self._conn, uid)

    def stop(self):
        self._stop_event.set()

    def run(self):
        while not self._stop_event.is_set():
            try:
                self.refresh()
            except Exception as exc:
                logger.warning('Using locally cached officer roster: %s', exc)
            self._stop_event.wait(self._interval)
