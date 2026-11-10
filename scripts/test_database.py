"""Integration tests against an EMPTY disposable PostgreSQL database, no Docker.

Set SSC_TEST_DATABASE_URL to a database named ssc_migration_test. The setup creates
minimal Supabase Auth/publication stubs and applies the real migration. Never use
a cloud project or an existing application database for this test harness.
Requires psycopg[binary]. Run: python scripts/test_database.py
"""
import base64
from concurrent.futures import ThreadPoolExecutor
import threading
import hashlib
from datetime import datetime, timedelta, timezone
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
        conn.execute("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$")
        conn.execute("CREATE SCHEMA auth; CREATE SCHEMA extensions;")
        conn.execute('CREATE TABLE auth.users(id uuid PRIMARY KEY)')
        conn.execute("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$")
        conn.execute('GRANT USAGE ON SCHEMA public,auth TO anon,authenticated')
        conn.execute('CREATE PUBLICATION supabase_realtime')
        for migration in sorted((Path(__file__).resolve().parents[1] / 'supabase/migrations').glob('*.sql')):
            if migration.name.startswith('202611100001'):
                conn.execute("INSERT INTO public.officers(card_uid,first_name,last_name,position) VALUES ('LEGACY01','Sample','Officer','Secretary')")
                conn.execute("INSERT INTO public.semesters(id,name,start_date,status) VALUES ('legacy','Legacy',((now() AT TIME ZONE 'Asia/Manila')::date-30),'active')")
                week={str(i):{'type':'holiday' if i==0 else 'optional' if i==6 else 'regular','required_uids':['LEGACY01']} for i in range(7)}
                conn.execute("INSERT INTO public.day_config(id,data) VALUES ('weekly',%s)",(Jsonb({'schedule':week}),))
                conn.execute("INSERT INTO public.day_config(id,data) VALUES (((now() AT TIME ZONE 'Asia/Manila')::date+1)::text,%s)",(Jsonb({'type':'holiday','note':'School closure'}),))
                conn.execute("INSERT INTO public.day_config(id,data) VALUES (((now() AT TIME ZONE 'Asia/Manila')::date+2)::text,%s)",(Jsonb({'type':'regular','note':'Note only'}),))
            conn.execute(migration.read_text(encoding='utf-8'))
            if migration.name.startswith('202611100001'):
                imported=conn.execute("SELECT schedule FROM public.semester_schedules WHERE semester_id='legacy'").fetchone()[0]
                assert imported['1']['type']=='scheduled' and imported['0']['type']=='unscheduled'
                future=conn.execute("SELECT type,required_uids,schedule_version_id FROM public.calendar_days WHERE note='School closure'").fetchone()
                assert future==('no_classes',None,None),future
                assert conn.execute("SELECT required_uids FROM public.calendar_days WHERE note='Note only'").fetchone()[0] is None
                assert conn.execute("SELECT count(*) FROM public.calendar_days WHERE date=(now() AT TIME ZONE 'Asia/Manila')::date").fetchone()[0]==0
                assert conn.execute("SELECT count(*) FROM public.calendar_days WHERE schedule_version_id IS NOT NULL").fetchone()[0]>=30
                conn.execute("DELETE FROM public.semesters WHERE id='legacy'")
                conn.execute("DELETE FROM public.officers WHERE card_uid='LEGACY01'; DELETE FROM public.day_config")



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
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.conn.transaction():
            self.conn.execute("UPDATE public.officers SET first_name='Changed' RETURNING card_uid")
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
        self.conn.execute("SELECT public.correct_attendance(%s,'AAAA1111','CLOCK_OUT','2026-11-09T10:00:00+08:00',false,'Test correction')", (event['event_id'],))
        self.conn.execute("SELECT public.delete_attendance(%s,'Test deletion')", (event['event_id'],))
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

    def test_second_active_semester_insert_is_rejected_by_database(self):
        self.role(ADMIN)
        self.conn.execute("INSERT INTO public.semesters(id,name,start_date,status) VALUES ('a','A','2026-01-01','active')")
        with self.assertRaises(psycopg.errors.UniqueViolation) as violation, self.conn.transaction():
            self.conn.execute("INSERT INTO public.semesters(id,name,start_date,status) VALUES ('b','B','2026-02-01','active')")
        self.assertEqual(violation.exception.diag.constraint_name,'one_active_semester')
        self.assertEqual(self.conn.execute("SELECT count(*) FROM public.semesters WHERE status='active'").fetchone()[0],1)

    def test_direct_update_cannot_activate_another_semester(self):
        self.role(ADMIN)
        self.conn.execute("INSERT INTO public.semesters(id,name,start_date,status) VALUES ('a','A','2026-01-01','active'),('b','B','2025-01-01','ended')")
        with self.assertRaises(psycopg.errors.UniqueViolation), self.conn.transaction():
            self.conn.execute("UPDATE public.semesters SET status='active' WHERE id='b'")
        self.assertEqual(self.conn.execute("SELECT id FROM public.semesters WHERE status='active'").fetchone()[0],'a')

    def test_concurrent_creates_allow_only_one_active_semester(self):
        ids=[str(uuid4()),str(uuid4())]
        barrier=threading.Barrier(2)
        def create(term_id):
            try:
                with psycopg.connect(DSN) as conn:
                    conn.execute("SET LOCAL statement_timeout='5s'")
                    barrier.wait(timeout=3)
                    conn.execute("INSERT INTO public.semesters(id,name,start_date,status) VALUES (%s,'Concurrent term','2026-01-01','active')",(term_id,))
                return 'created'
            except psycopg.errors.UniqueViolation:
                return 'rejected'
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                results=list(pool.map(create,ids))
            self.assertCountEqual(results,['created','rejected'])
            with psycopg.connect(DSN) as conn:
                self.assertEqual(conn.execute("SELECT count(*) FROM public.semesters WHERE status='active'").fetchone()[0],1)
        finally:
            with psycopg.connect(DSN) as conn:
                conn.execute('DELETE FROM public.semesters WHERE id=ANY(%s)',(ids,))

    def test_concurrent_admin_activations_are_serialized(self):
        ids=[str(uuid4()),str(uuid4())]
        actor=str(uuid4())
        barrier=threading.Barrier(2)
        def activate(term_id):
            with psycopg.connect(DSN) as conn:
                conn.execute("SET LOCAL statement_timeout='5s'")
                conn.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(actor,))
                conn.execute('SET LOCAL ROLE authenticated')
                barrier.wait(timeout=3)
                conn.execute('SELECT public.activate_semester(%s)',(term_id,))
        try:
            with psycopg.connect(DSN) as conn:
                conn.execute('INSERT INTO auth.users(id) VALUES (%s)',(actor,))
                conn.execute("INSERT INTO public.user_roles VALUES (%s,'admin')",(actor,))
                conn.cursor().executemany("INSERT INTO public.semesters(id,name,start_date,status) VALUES (%s,'Concurrent activation','2026-01-01','ended')",[(i,) for i in ids])
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(activate,ids))
            with psycopg.connect(DSN) as conn:
                self.assertEqual(conn.execute("SELECT count(*) FROM public.semesters WHERE status='active'").fetchone()[0],1)
                rows=conn.execute('SELECT status FROM public.semesters WHERE id=ANY(%s)',(ids,)).fetchall()
                self.assertCountEqual([r[0] for r in rows],['active','ended'])
        finally:
            with psycopg.connect(DSN) as conn:
                conn.execute('DELETE FROM public.semesters WHERE id=ANY(%s)',(ids,))
                conn.execute('DELETE FROM public.user_roles WHERE user_id=%s',(actor,))
                conn.execute('DELETE FROM auth.users WHERE id=%s',(actor,))

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


    def term(self):
        self.conn.execute("RESET ROLE")
        self.conn.execute("INSERT INTO public.semesters(id,name,start_date,status) VALUES ('term','Test Semester',((now() AT TIME ZONE 'Asia/Manila')::date-30),'active')")
        self.role(ADMIN)
        return {str(i):{'type':'scheduled','required_uids':['AAAA1111']} for i in range(7)}

    def test_semester_revisions_freeze_past_dates_and_calendar_inherits(self):
        week=self.term()
        first=self.conn.execute("SELECT public.save_semester_schedule('term',%s)",(Jsonb(week),)).fetchone()[0]
        self.conn.execute("SELECT public.save_calendar_day('term',(now() AT TIME ZONE 'Asia/Manila')::date-1,'regular','Note only',null)")
        second=self.conn.execute("SELECT public.save_semester_schedule('term',%s)",(Jsonb(week),)).fetchone()[0]
        self.assertNotEqual(first,second)
        day=self.conn.execute("SELECT schedule_version_id,required_uids FROM public.calendar_days WHERE date=(now() AT TIME ZONE 'Asia/Manila')::date-1").fetchone()
        self.assertEqual(day,(first,None))
        self.assertEqual(self.conn.execute("SELECT count(*) FROM public.calendar_days WHERE date>=(now() AT TIME ZONE 'Asia/Manila')::date").fetchone()[0],0)
        self.conn.execute("SELECT public.save_calendar_day('term',(now() AT TIME ZONE 'Asia/Manila')::date,'regular','No required officers',%s)",(Jsonb([]),))
        self.assertEqual(self.conn.execute("SELECT required_uids FROM public.calendar_days WHERE note='No required officers'").fetchone()[0],[])

    def test_non_admin_cannot_save_schedule(self):
        week=self.term();self.role(OFFICER)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.conn.execute("SELECT public.save_semester_schedule('term',%s)",(Jsonb(week),))

    def test_archived_schedule_cannot_change(self):
        week=self.term();self.conn.execute("SELECT public.archive_semester('term',(now() AT TIME ZONE 'Asia/Manila')::date)")
        with self.assertRaises(psycopg.errors.RaiseException):
            self.conn.execute("SELECT public.save_semester_schedule('term',%s)",(Jsonb(week),))

    def test_invalid_weekday_and_removed_holiday_are_rejected(self):
        week=self.term();week['1']={}
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction():
            self.conn.execute("SELECT public.save_semester_schedule('term',%s)",(Jsonb(week),))
        with self.assertRaises(psycopg.errors.RaiseException):
            self.conn.execute("SELECT public.save_calendar_day('term',(now() AT TIME ZONE 'Asia/Manila')::date,'holiday','',null)")

    def test_duplicate_card_cannot_overwrite_and_restoration_is_explicit(self):
        self.role(ADMIN)
        profile=Jsonb({'first_name':'Changed','last_name':'Cruz','position':'Secretary'})
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction():
            self.conn.execute("SELECT public.save_officer('AAAA1111',%s,true,false)",(profile,))
        self.assertEqual(self.conn.execute('SELECT first_name FROM public.officers').fetchone()[0],'Ana')
        self.conn.execute("SELECT public.deactivate_officer('AAAA1111')")
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction():
            self.conn.execute("SELECT public.save_officer('AAAA1111',%s,false,false)",(profile,))
        self.conn.execute("SELECT public.save_officer('AAAA1111',%s,false,true)",(profile,))
        self.assertEqual(self.conn.execute('SELECT first_name,active FROM public.officers').fetchone(),('Changed',True))

    def test_enrollment_owner_cannot_be_stolen_or_released_by_other_tab(self):
        self.role(ADMIN);a,b=str(uuid4()),str(uuid4())
        def lease(owner,active):return self.conn.execute('SELECT public.set_enrollment(%s,%s)',(owner,active)).fetchone()[0]
        self.assertTrue(lease(a,True));self.assertFalse(lease(b,True));self.assertFalse(lease(b,False))
        self.role(anonymous=True)
        self.assertTrue(self.conn.execute("SELECT public.reader_tap(%s,%s,'AAAA1111')",(DEVICE,TOKEN)).fetchone()[0])
        self.role(ADMIN)
        self.assertEqual(self.conn.execute("SELECT data->>'owner' FROM public.system_settings WHERE id='live_scanner'").fetchone()[0],a)
        self.assertTrue(lease(a,False));self.assertTrue(lease(b,True))

    def test_corrections_record_actor_reason_and_precise_before_after(self):
        self.role(anonymous=True);event=self.event(timestamp='2026-11-09T09:00:42+08:00');self.ingest([event]);self.role(ADMIN)
        self.conn.execute("SELECT public.correct_attendance(%s,'AAAA1111','CLOCK_OUT','2026-11-09T10:00:42+08:00',false,'Wrong tap action')",(event['event_id'],))
        row=self.conn.execute('SELECT actor_id,reason,before_data,after_data FROM public.attendance_audit').fetchone()
        self.assertEqual(str(row[0]),ADMIN);self.assertEqual(row[1],'Wrong tap action');self.assertEqual(row[2]['type'],'CLOCK_IN');self.assertEqual(row[3]['type'],'CLOCK_OUT')
        self.assertIn(':42',row[3]['timestamp'])
        self.role(OFFICER);self.assertEqual(self.conn.execute('SELECT count(*) FROM public.attendance_audit').fetchone()[0],0)

    def test_missed_cutoff_recovery_is_deterministic_and_idempotent(self):
        self.role(anonymous=True);event=self.event();self.ingest([event]);self.role(ADMIN)
        self.assertEqual(self.conn.execute('SELECT public.recover_due_attendance()').fetchone()[0],1)
        self.assertEqual(self.conn.execute('SELECT public.recover_due_attendance()').fetchone()[0],0)
        auto=self.conn.execute("SELECT id,timestamp AT TIME ZONE 'Asia/Manila' FROM public.attendance_logs WHERE is_auto_closed").fetchone()
        self.assertEqual(auto[0].hex,hashlib.md5((event['event_id']+':auto-close').encode()).hexdigest())
        self.assertEqual(auto[1].isoformat(),'2026-11-09T21:00:00')
        self.role(anonymous=True)
        self.assertEqual(self.ingest([self.event(event_id=str(auto[0]),action_type='CLOCK_OUT',timestamp='2026-11-09T21:00:00+08:00',is_auto_closed=True)]),1)

    def test_cloud_auto_close_for_manual_clock_in_can_be_acknowledged_by_reader(self):
        self.role(ADMIN)
        clock_in=self.conn.execute("SELECT public.correct_attendance(null,'AAAA1111','CLOCK_IN','2026-11-09T10:00:00+08:00',false,'Missed card scan')").fetchone()[0]
        self.conn.execute('SELECT public.recover_due_attendance()')
        auto=self.conn.execute("SELECT id,timestamp FROM public.attendance_logs WHERE is_auto_closed").fetchone()
        self.assertEqual(auto[0].hex,hashlib.md5((str(clock_in)+':auto-close').encode()).hexdigest())
        self.conn.execute("SELECT public.delete_attendance(%s,'Incorrect auto close')",(auto[0],))
        self.role(anonymous=True)
        self.assertEqual(self.ingest([self.event(event_id=str(auto[0]),action_type='CLOCK_OUT',timestamp=auto[1].isoformat(),is_auto_closed=True)]),1)
        context=self.conn.execute('SELECT public.reader_context(%s,%s,%s)',(DEVICE,TOKEN,Jsonb([str(auto[0])]))).fetchone()[0]
        self.assertIn(str(auto[0]),context['known_event_ids'])
        self.role(ADMIN)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.attendance_logs').fetchone()[0],2)

    def test_reader_snapshot_acknowledges_tombstones_and_current_manual_events(self):
        stamp=datetime.now(timezone.utc)-timedelta(minutes=2)
        self.role(anonymous=True);event=self.event(timestamp=stamp.isoformat());self.ingest([event]);self.role(ADMIN)
        self.conn.execute("SELECT public.delete_attendance(%s,'Wrong card scan')",(event['event_id'],))
        self.conn.execute("SELECT public.correct_attendance(null,'AAAA1111','CLOCK_OUT',%s,false,'Manual clock out')",(stamp,))
        self.role(anonymous=True)
        result=self.conn.execute('SELECT public.reader_context(%s,%s,%s)',(DEVICE,TOKEN,Jsonb([event['event_id']]))).fetchone()[0]
        self.assertIn(event['event_id'],result['known_event_ids'])
        self.assertTrue(any(e['deleted_at'] for e in result['events']))
        self.assertTrue(any(e['manually_edited'] and e['type']=='CLOCK_OUT' for e in result['events']))


if __name__ == '__main__':
    if DSN: initialize()
    unittest.main()
