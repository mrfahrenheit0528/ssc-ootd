"""Integration tests against an EMPTY disposable PostgreSQL database, no Docker.

Set SSC_TEST_DATABASE_URL to a database named ssc_migration_test. The setup creates
minimal Supabase Auth/publication stubs and applies the real migration. Never use
a cloud project or an existing application database for this test harness.
Requires psycopg[binary]. Run: python scripts/test_database.py
"""
import base64
import hashlib
import json
import os
import unittest
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

DSN = os.getenv('SSC_TEST_DATABASE_URL')
ADMIN = '10000000-0000-0000-0000-000000000001'
OFFICER = '10000000-0000-0000-0000-000000000002'
OUTSIDER = '10000000-0000-0000-0000-000000000003'
DEVICE = '20000000-0000-0000-0000-000000000001'
TOKEN = 'test-token-that-is-long-enough-for-device-auth'


def initialize():
    with psycopg.connect(DSN, autocommit=True) as conn:
        if conn.execute('SELECT current_database()').fetchone()[0] != 'ssc_migration_test':
            raise RuntimeError('Tests require an empty database named ssc_migration_test.')
        if conn.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','auth')").fetchone()[0]:
            raise RuntimeError('Test database must be empty. Create a fresh disposable database.')
        conn.execute("CREATE ROLE anon; CREATE ROLE authenticated;")
        conn.execute("CREATE SCHEMA auth; CREATE SCHEMA extensions;")
        conn.execute('CREATE TABLE auth.users(id uuid PRIMARY KEY)')
        conn.execute("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$")
        conn.execute('GRANT USAGE ON SCHEMA public,auth TO anon,authenticated')
        conn.execute('CREATE PUBLICATION supabase_realtime')
        migration = Path(__file__).resolve().parents[1] / 'supabase/migrations/202611090001_initial.sql'
        conn.execute(migration.read_text(encoding='utf-8'))


@unittest.skipUnless(DSN, 'Set SSC_TEST_DATABASE_URL for PostgreSQL integration tests')
class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.conn = psycopg.connect(DSN)
        self.conn.execute('INSERT INTO auth.users(id) VALUES (%s),(%s),(%s)', (ADMIN, OFFICER, OUTSIDER))
        self.conn.execute("INSERT INTO public.user_roles VALUES (%s,'admin'),(%s,'officer')", (ADMIN, OFFICER))
        self.conn.execute("INSERT INTO public.officers(card_uid,first_name,last_name,position) VALUES ('AAAA1111','Ana','Cruz','Secretary')")
        self.conn.execute('INSERT INTO public.reader_devices(id,name,token_hash) VALUES (%s,%s,%s)',
                          (DEVICE, 'test reader', hashlib.sha256(TOKEN.encode()).hexdigest()))

    def tearDown(self):
        self.conn.rollback()
        self.conn.close()

    def role(self, user=None, anonymous=False):
        self.conn.execute('RESET ROLE')
        self.conn.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (user or '',))
        self.conn.execute('SET LOCAL ROLE anon' if anonymous else 'SET LOCAL ROLE authenticated')

    def ingest(self, events, token=TOKEN):
        return self.conn.execute('SELECT public.ingest_attendance(%s,%s,%s)', (DEVICE, token, Jsonb(events))).fetchone()[0]

    def event(self, **kwargs):
        return {'event_id': str(uuid4()), 'card_uid': 'AAAA1111', 'action_type': 'CLOCK_IN',
                'timestamp': '2026-11-09T09:00:00+08:00', **kwargs}

    def test_anonymous_cannot_read_profiles(self):
        self.role(anonymous=True)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege): self.conn.execute('SELECT * FROM public.officers')

    def test_unapproved_authenticated_user_sees_no_data(self):
        self.role(OUTSIDER)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.officers').fetchone()[0], 0)

    def test_officer_can_read_but_cannot_change_profiles(self):
        self.role(OFFICER)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.officers').fetchone()[0], 1)
        self.assertEqual(self.conn.execute("UPDATE public.officers SET first_name='Changed' RETURNING card_uid").fetchall(), [])
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.conn.execute("INSERT INTO public.officers(card_uid,first_name,last_name,position) VALUES ('BBBB2222','B','C','Member')")

    def test_user_cannot_grant_themselves_admin(self):
        self.role(OFFICER)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.conn.execute("UPDATE public.user_roles SET role='admin' WHERE user_id=%s", (OFFICER,))

    def test_reader_can_only_use_scoped_functions(self):
        self.role(anonymous=True)
        context = self.conn.execute('SELECT public.reader_context(%s,%s)', (DEVICE, TOKEN)).fetchone()[0]
        self.assertEqual(context['officers'][0]['card_uid'], 'AAAA1111')
        with self.assertRaises(psycopg.errors.InsufficientPrivilege): self.conn.execute('SELECT * FROM public.reader_devices')

    def test_invalid_reader_is_rejected(self):
        self.role(anonymous=True)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege): self.ingest([self.event()], token='wrong')

    def test_retries_do_not_duplicate_and_keep_cloud_status(self):
        self.role(anonymous=True)
        event = self.event()
        self.assertEqual(self.ingest([event]), 1)
        self.assertEqual(self.ingest([event]), 1)
        self.role(ADMIN)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.attendance_logs').fetchone()[0], 1)
        self.assertEqual(self.conn.execute('SELECT status FROM public.officers').fetchone()[0], 'ON_DUTY')

    def test_old_event_cannot_override_newer_status(self):
        self.role(anonymous=True)
        self.ingest([self.event(action_type='CLOCK_OUT', timestamp='2026-11-09T10:00:00+08:00')])
        self.ingest([self.event()])
        self.role(ADMIN)
        self.assertEqual(self.conn.execute('SELECT status FROM public.officers').fetchone()[0], 'OFF_DUTY')

    def test_retry_preserves_admin_correction_and_tombstone(self):
        self.role(anonymous=True)
        event = self.event()
        self.ingest([event])
        self.role(ADMIN)
        self.conn.execute("UPDATE public.attendance_logs SET type='CLOCK_OUT',manually_edited=true,deleted_at=now() WHERE id=%s", (event['event_id'],))
        self.role(anonymous=True)
        self.ingest([event])
        self.role(ADMIN)
        row = self.conn.execute('SELECT type,manually_edited,deleted_at FROM public.attendance_logs').fetchone()
        self.assertEqual(row[:2], ('CLOCK_OUT', True))
        self.assertIsNotNone(row[2])

    def test_failed_batch_rolls_back_all_events(self):
        self.role(anonymous=True)
        with self.conn.transaction():
            try:
                with self.conn.transaction(): self.ingest([self.event(), self.event(card_uid='UNKNOWN1')])
            except psycopg.errors.RaiseException: pass
        self.role(ADMIN)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.attendance_logs').fetchone()[0], 0)

    def test_photo_bytes_are_saved_and_members_can_read_them(self):
        self.role(ADMIN)
        data = bytes.fromhex('ffd8ffe000104a4649460001')
        photo = self.conn.execute('SELECT public.upload_officer_photo(%s,%s)', (base64.b64encode(data).decode(), 'image/jpeg')).fetchone()[0]
        self.role(OFFICER)
        self.assertEqual(bytes(self.conn.execute('SELECT content FROM public.officer_photos WHERE id=%s', (photo,)).fetchone()[0]), data)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.conn.execute('SELECT public.upload_officer_photo(%s,%s)', (base64.b64encode(data).decode(), 'image/jpeg'))

    def test_semester_snapshot_and_activation_are_atomic(self):
        self.role(ADMIN)
        self.conn.execute("INSERT INTO public.semesters(id,name,start_date,status) VALUES ('a','A','2026-01-01','active'),('b','B','2025-01-01','ended')")
        self.conn.execute("SELECT public.activate_semester('b')")
        rows = self.conn.execute('SELECT id,status,officer_snapshot FROM public.semesters ORDER BY id').fetchall()
        self.assertEqual(rows[0][1], 'ended')
        self.assertEqual(rows[0][2][0]['first_name'], 'Ana')
        self.assertEqual(rows[1][1], 'active')

    def test_expired_enrollment_does_not_swallow_taps(self):
        self.conn.execute("INSERT INTO public.system_settings(id,data) VALUES ('enrollment_mode',%s)",
                          (Jsonb({'active': True, 'expires_at': '2020-01-01T00:00:00Z'}),))
        self.role(anonymous=True)
        self.assertFalse(self.conn.execute('SELECT public.reader_tap(%s,%s,%s)', (DEVICE,TOKEN,'AAAA1111')).fetchone()[0])

    def test_active_enrollment_publishes_uid(self):
        self.conn.execute("INSERT INTO public.system_settings(id,data) VALUES ('enrollment_mode',jsonb_build_object('active',true,'expires_at',now()+interval '1 minute'))")
        self.role(anonymous=True)
        self.assertTrue(self.conn.execute('SELECT public.reader_tap(%s,%s,%s)', (DEVICE,TOKEN,'AAAA1111')).fetchone()[0])
        self.role(ADMIN)
        self.assertEqual(self.conn.execute("SELECT data->>'latest_uid' FROM public.system_settings WHERE id='live_scanner'").fetchone()[0], 'AAAA1111')


if __name__ == '__main__':
    if DSN: initialize()
    unittest.main()
