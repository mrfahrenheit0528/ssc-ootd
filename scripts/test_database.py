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
from uuid import UUID, uuid4

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
            if migration.name.startswith('202611140001'):
                conn.execute("INSERT INTO public.semesters(id,name,start_date,end_date,status) VALUES ('history-upgrade','Historical fixture','2020-08-01','2020-12-31','ended')")
                version=conn.execute("INSERT INTO public.semester_schedules(semester_id,revision,schedule,created_at) VALUES ('history-upgrade',1,'{}','2020-01-01T00:00:00Z') RETURNING id").fetchone()[0]
                for day,stamp in [('2020-09-01','2020-01-01T00:00:00Z'),('2020-09-02','2020-01-01T00:00:00Z'),('2020-09-03','2020-01-02T00:00:00Z')]:
                    conn.execute("INSERT INTO public.calendar_days(semester_id,date,required_uids,schedule_version_id,updated_at) VALUES ('history-upgrade',%s,'[]',%s,%s)",(day,version,stamp))
                conn.execute("INSERT INTO public.day_config(id,data) VALUES ('2020-09-02','{\"required_uids\":[]}')")
            if migration.name.startswith('202611120001'):
                conn.execute("INSERT INTO public.officers(card_uid,first_name,last_name,position) VALUES ('PRECARD1','Existing','Officer','Secretary')")
            if migration.name.startswith('202611100001'):
                conn.execute("INSERT INTO public.officers(card_uid,first_name,last_name,position) VALUES ('LEGACY01','Sample','Officer','Secretary')")
                conn.execute("INSERT INTO public.semesters(id,name,start_date,status) VALUES ('legacy','Legacy',((now() AT TIME ZONE 'Asia/Manila')::date-30),'active')")
                week={str(i):{'type':'holiday' if i==0 else 'optional' if i==6 else 'regular','required_uids':['LEGACY01']} for i in range(7)}
                conn.execute("INSERT INTO public.day_config(id,data) VALUES ('weekly',%s)",(Jsonb({'schedule':week}),))
                conn.execute("INSERT INTO public.day_config(id,data) VALUES (((now() AT TIME ZONE 'Asia/Manila')::date+1)::text,%s)",(Jsonb({'type':'holiday','note':'School closure'}),))
                conn.execute("INSERT INTO public.day_config(id,data) VALUES (((now() AT TIME ZONE 'Asia/Manila')::date+2)::text,%s)",(Jsonb({'type':'regular','note':'Note only'}),))
            conn.execute(migration.read_text(encoding='utf-8'))
            if migration.name.startswith('202611140001'):
                assert conn.execute("SELECT inherited_unassigned FROM public.calendar_days WHERE semester_id='history-upgrade' ORDER BY date").fetchall()==[(True,),(False,),(False,)]
                conn.execute("UPDATE public.calendar_days SET note='Explicit edit' WHERE semester_id='history-upgrade' AND date='2020-09-01'")
                assert conn.execute("SELECT inherited_unassigned FROM public.calendar_days WHERE semester_id='history-upgrade' AND date='2020-09-01'").fetchone()==(False,)
                conn.execute("DELETE FROM public.semesters WHERE id='history-upgrade'; DELETE FROM public.day_config WHERE id='2020-09-02'")
            if migration.name.startswith('202611120001'):
                assert conn.execute("SELECT card_uid,nfc_uid FROM public.officers WHERE card_uid='PRECARD1'").fetchone()==('PRECARD1','PRECARD1')
                conn.execute("DELETE FROM public.officers WHERE card_uid='PRECARD1'")
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

    def test_live_kiosk_shows_only_today_pending_cards_to_approved_members(self):
        stamp=self.conn.execute('SELECT now()').fetchone()[0]
        self.role(anonymous=True)
        self.ingest([self.event(card_uid='UNKNOWN1',timestamp=stamp.isoformat()),
            self.event(card_uid='UNKNOWN2',timestamp=(stamp-timedelta(days=1)).isoformat()),
            self.event(card_uid='UNKNOWN3',timestamp=(stamp+timedelta(days=1)).isoformat())])
        self.role(OFFICER)
        snapshot=self.conn.execute('SELECT public.live_kiosk_context()').fetchone()[0]
        self.assertEqual(len(snapshot['events']),1)
        live=snapshot['events'][0]
        self.assertEqual((live['card_uid'],live['nfc_uid'],live['officer_name'],live['is_unlinked']),('unlinked:UNKNOWN1','UNKNOWN1',None,True))
        self.assertEqual(set(live),{'id','card_uid','nfc_uid','officer_name','type','timestamp','is_auto_closed','created_at','is_unlinked'})
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.pending_card_events').fetchone()[0],0,'raw pending archive remains admin-only')
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.attendance_logs').fetchone()[0],0,'unknown cards stay out of officer attendance reports')
        self.role(OUTSIDER)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.conn.transaction():
            self.conn.execute('SELECT public.live_kiosk_context()')
        self.role(anonymous=True)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.conn.transaction():
            self.conn.execute('SELECT public.live_kiosk_context()')

    def test_live_card_linking_promotes_one_event_and_never_reveals_a_deleted_receipt(self):
        stamp=self.conn.execute('SELECT now()').fetchone()[0]
        event=self.event(card_uid='UNKNOWN1',timestamp=stamp.isoformat())
        self.role(anonymous=True);self.ingest([event])
        self.role(ADMIN)
        before=self.conn.execute('SELECT public.live_kiosk_context()').fetchone()[0]['events']
        self.assertEqual(len(before),1)
        key=self.conn.execute('SELECT public.save_officer_profile(null,%s,%s,true)',('UNKNOWN1',Jsonb({'first_name':'Sample','last_name':'Pending','position':'Officer'}))).fetchone()[0]
        self.role(OFFICER)
        after=self.conn.execute('SELECT public.live_kiosk_context()').fetchone()[0]['events']
        self.assertEqual(len(after),1)
        self.assertEqual(after[0]['id'],event['event_id'])
        self.assertEqual((after[0]['card_uid'],after[0]['nfc_uid'],after[0]['officer_name'],after[0]['is_unlinked']),(key,'UNKNOWN1','Sample Pending',False))
        self.role(ADMIN)
        self.conn.execute("SELECT public.delete_attendance(%s,'Wrong card scan')",(event['event_id'],))
        self.assertEqual(self.conn.execute('SELECT public.live_kiosk_context()').fetchone()[0]['events'],[])

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
                with self.conn.transaction(): self.ingest([self.event(), self.event(card_uid='BAD!')])
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

    def test_whole_semester_schedule_repairs_history_and_keeps_manual_calendar_exceptions(self):
        week=self.term()
        blank={str(day):{'type':'unscheduled','required_uids':[]} for day in range(7)}
        first=self.conn.execute("SELECT public.save_semester_schedule('term',%s)",(Jsonb(blank),)).fetchone()[0]
        self.conn.execute('RESET ROLE')
        # Reproduce an untouched legacy [] placeholder, an explicit empty list,
        # and a future day pinned to an earlier version.
        for offset,day_type,required,legacy in [(-1,'regular',[],True),(-2,'regular',[],False),(-3,'no_classes',None,False),(-4,'optional',None,False),(1,'regular',None,False)]:
            self.conn.execute("INSERT INTO public.calendar_days(semester_id,date,type,note,required_uids,schedule_version_id,inherited_unassigned) VALUES ('term',(now() AT TIME ZONE 'Asia/Manila')::date+%s,%s,'Keep note',%s,%s,%s)",(offset,day_type,Jsonb(required) if required is not None else None,first,legacy))
        self.conn.execute("INSERT INTO public.attendance_logs(card_uid,officer_name,type,timestamp) VALUES ('AAAA1111','Ana Cruz','CLOCK_IN',(((now() AT TIME ZONE 'Asia/Manila')::date-1)+time '09:00') AT TIME ZONE 'Asia/Manila'),('AAAA1111','Ana Cruz','CLOCK_OUT',(((now() AT TIME ZONE 'Asia/Manila')::date-1)+time '17:00') AT TIME ZONE 'Asia/Manila')")
        before=self.conn.execute('SELECT to_jsonb(a) FROM public.attendance_logs a ORDER BY id').fetchall()
        self.role(ADMIN)
        second=self.conn.execute("SELECT public.save_semester_schedule_scoped('term',%s,'whole_semester')",(Jsonb(week),)).fetchone()[0]
        rows=self.conn.execute("SELECT (date-(now() AT TIME ZONE 'Asia/Manila')::date)::integer,type,note,required_uids,schedule_version_id,inherited_unassigned FROM public.calendar_days WHERE semester_id='term'").fetchall()
        mapped={row[0]:row[1:] for row in rows}
        self.assertEqual(mapped[-1],('regular','Keep note',None,second,False))
        self.assertEqual(mapped[-2],('regular','Keep note',[],second,False))
        self.assertEqual(mapped[-3],('no_classes','Keep note',None,second,False))
        self.assertEqual(mapped[-4],('optional','Keep note',None,second,False))
        self.assertEqual(mapped[1][-2],second)
        self.assertTrue(all(row[4]==second for row in rows))
        self.assertEqual(self.conn.execute('SELECT schedule FROM public.semester_schedules WHERE id=%s',(first,)).fetchone()[0],blank)
        self.assertEqual(self.conn.execute('SELECT application_scope,created_by FROM public.semester_schedules WHERE id=%s',(second,)).fetchone(),('whole_semester',UUID(ADMIN)))
        self.assertEqual(self.conn.execute('SELECT to_jsonb(a) FROM public.attendance_logs a ORDER BY id').fetchall(),before)

    def test_scoped_today_save_preserves_historical_revisions(self):
        week=self.term()
        first=self.conn.execute("SELECT public.save_semester_schedule('term',%s)",(Jsonb(week),)).fetchone()[0]
        changed={str(day):{'type':'unscheduled','required_uids':[]} for day in range(7)}
        second=self.conn.execute("SELECT public.save_semester_schedule_scoped('term',%s,'today_onward')",(Jsonb(changed),)).fetchone()[0]
        self.assertNotEqual(first,second)
        self.assertEqual(self.conn.execute("SELECT DISTINCT schedule_version_id FROM public.calendar_days WHERE semester_id='term'").fetchall(),[(first,)])

    def test_whole_semester_schedule_is_admin_only_and_archived_terms_stay_read_only(self):
        week=self.term();self.role(OFFICER)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.conn.transaction():
            self.conn.execute("SELECT public.save_semester_schedule_scoped('term',%s,'whole_semester')",(Jsonb(week),))
        self.role(ADMIN)
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction():
            self.conn.execute("SELECT public.save_semester_schedule_scoped('term',%s,'invalid')",(Jsonb(week),))
        self.conn.execute("SELECT public.archive_semester('term',(now() AT TIME ZONE 'Asia/Manila')::date)")
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction():
            self.conn.execute("SELECT public.save_semester_schedule_scoped('term',%s,'whole_semester')",(Jsonb(week),))

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
        stamp=self.conn.execute('SELECT now()').fetchone()[0]
        self.role(anonymous=True);event=self.event(timestamp=stamp.isoformat());self.ingest([event]);self.role(ADMIN)
        self.conn.execute("SELECT public.delete_attendance(%s,'Wrong card scan')",(event['event_id'],))
        self.conn.execute("SELECT public.correct_attendance(null,'AAAA1111','CLOCK_OUT',%s,false,'Manual clock out')",(stamp,))
        self.role(anonymous=True)
        result=self.conn.execute('SELECT public.reader_context(%s,%s,%s)',(DEVICE,TOKEN,Jsonb([event['event_id']]))).fetchone()[0]
        self.assertIn(event['event_id'],result['known_event_ids'])
        self.assertTrue(any(e['deleted_at'] for e in result['events']))
        self.assertTrue(any(e['manually_edited'] and e['type']=='CLOCK_OUT' for e in result['events']))


    def test_unlinked_profile_and_paper_import_keep_one_identity_after_card_link(self):
        self.role(ADMIN)
        rows=[{'date':'2020-09-01','first_name':'Sample','last_name':'Unlinked','position':'Secretary','create_profile':True,'time_in':'09:00:00','time_out':'17:00:00'}]
        self.assertEqual(self.csv_import(rows)['created_profiles'],1)
        key,nfc=self.conn.execute("SELECT card_uid,nfc_uid FROM public.officers WHERE last_name='Unlinked'").fetchone()
        self.assertTrue(key.startswith('OFF'));self.assertIsNone(nfc)
        self.assertEqual(self.csv_import(rows)['skipped_sessions'],1)
        self.conn.execute('SELECT public.save_officer_profile(%s,%s,%s,false)',(key,'BBBB2222',Jsonb({'first_name':'Sample','last_name':'Unlinked','position':'Secretary'})))
        self.role(anonymous=True)
        self.ingest([self.event(card_uid='BBBB2222',timestamp='2020-09-02T09:00:00+08:00'),self.event(card_uid='BBBB2222',action_type='CLOCK_OUT',timestamp='2020-09-02T17:00:00+08:00')])
        self.role(ADMIN)
        self.assertEqual(self.conn.execute("SELECT count(*),count(DISTINCT card_uid) FROM public.attendance_logs WHERE officer_name='Sample Unlinked'").fetchone(),(4,1))
        self.assertEqual(self.conn.execute('SELECT card_uid,nfc_uid FROM public.officers WHERE card_uid=%s',(key,)).fetchone(),(key,'BBBB2222'))

    def test_unknown_scans_are_pending_admin_only_and_linked_without_rekeying(self):
        events=[self.event(card_uid='UNKNOWN1',timestamp='2020-09-02T09:00:00+08:00'),self.event(card_uid='UNKNOWN1',action_type='CLOCK_OUT',timestamp='2020-09-02T17:00:00+08:00')]
        self.role(anonymous=True);self.assertEqual(self.ingest(events),2);self.assertEqual(self.ingest(events),2)
        self.role(OFFICER)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.attendance_logs').fetchone()[0],0)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.pending_card_events').fetchone()[0],0)
        self.role(ADMIN)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.pending_card_events').fetchone()[0],2)
        key=self.conn.execute('SELECT public.save_officer_profile(null,null,%s,true)',(Jsonb({'first_name':'Pending','last_name':'Owner','position':'Secretary'}),)).fetchone()[0]
        self.conn.execute('SELECT public.save_officer_profile(%s,%s,%s,false)',(key,'UNKNOWN1',Jsonb({'first_name':'Pending','last_name':'Owner','position':'Secretary'})))
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.pending_card_events WHERE linked_officer_key IS NULL').fetchone()[0],0)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.attendance_audit WHERE operation=\'link_card\'').fetchone()[0],2)
        self.conn.execute("SELECT public.delete_attendance(%s,'Wrong scan from source')",(events[0]['event_id'],))
        self.role(anonymous=True);self.assertEqual(self.ingest(events),2)
        context=self.conn.execute('SELECT public.reader_context(%s,%s,%s)',(DEVICE,TOKEN,Jsonb([e['event_id'] for e in events]))).fetchone()[0]
        self.assertTrue(context['accept_unknown_cards'])
        self.assertTrue(all(e['event_id'] in context['known_event_ids'] for e in events))
        self.assertIn('UNKNOWN1',[o['card_uid'] for o in context['officers']])

    def test_pending_cutoff_recovery_is_idempotent_and_promotes_source_ids(self):
        event=self.event(card_uid='UNKNOWN1',timestamp='2020-09-02T09:00:00+08:00')
        self.role(anonymous=True);self.ingest([event])
        self.role(ADMIN)
        self.conn.execute('SELECT public.recover_due_attendance()');self.conn.execute('SELECT public.recover_due_attendance()')
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.pending_card_events').fetchone()[0],2)
        key=self.conn.execute('SELECT public.save_officer_profile(null,%s,%s,true)',('UNKNOWN1',Jsonb({'first_name':'Sample','last_name':'Pending','position':'Secretary'}))).fetchone()[0]
        ids=self.conn.execute('SELECT id FROM public.attendance_logs WHERE card_uid=%s',(key,)).fetchall()
        expected=hashlib.md5((event['event_id']+':auto-close').encode()).hexdigest()
        self.assertIn(expected,[i[0].hex for i in ids])

    def test_one_card_cannot_be_assigned_to_multiple_profiles(self):
        self.role(ADMIN)
        key=self.conn.execute('SELECT public.save_officer_profile(null,null,%s,true)',(Jsonb({'first_name':'Other','last_name':'Officer','position':'Secretary'}),)).fetchone()[0]
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction():
            self.conn.execute('SELECT public.save_officer_profile(%s,%s,%s,false)',(key,'AAAA1111',Jsonb({'first_name':'Other','last_name':'Officer','position':'Secretary'})))
        self.assertIsNone(self.conn.execute('SELECT nfc_uid FROM public.officers WHERE card_uid=%s',(key,)).fetchone()[0])

    def test_reader_uses_physical_card_ids_for_new_profiles_and_current_events(self):
        self.role(ADMIN)
        key=self.conn.execute('SELECT public.save_officer_profile(null,%s,%s,true)',('BBBB2222',Jsonb({'first_name':'Sample','last_name':'Current','position':'Officer'}))).fetchone()[0]
        self.role(anonymous=True)
        event=self.event(card_uid='BBBB2222',timestamp=self.conn.execute('SELECT now()').fetchone()[0].isoformat())
        self.ingest([event])
        context=self.conn.execute('SELECT public.reader_context(%s,%s,%s)',(DEVICE,TOKEN,Jsonb([event['event_id']]))).fetchone()[0]
        self.assertIn('BBBB2222',[o['card_uid'] for o in context['officers']])
        self.assertNotIn(key,[o['card_uid'] for o in context['officers']])
        self.assertEqual(next(e for e in context['events'] if e['id']==event['event_id'])['card_uid'],'BBBB2222')
        self.assertIn(event['event_id'],context['known_event_ids'])

    def test_pending_recovery_can_be_acknowledged_by_another_reader(self):
        other_device=str(uuid4())
        self.conn.execute('INSERT INTO public.reader_devices(id,name,token_hash) VALUES (%s,%s,%s)',(other_device,'second reader',hashlib.sha256(TOKEN.encode()).hexdigest()))
        event=self.event(card_uid='UNKNOWN1',timestamp='2020-09-02T09:00:00+08:00')
        self.role(anonymous=True);self.ingest([event])
        self.conn.execute('SELECT public.reader_context(%s,%s)',(DEVICE,TOKEN))
        auto=self.event(card_uid='UNKNOWN1',event_id=str(UUID(hashlib.md5((event['event_id']+':auto-close').encode()).hexdigest())),action_type='CLOCK_OUT',timestamp='2020-09-02T21:00:00+08:00',is_auto_closed=True)
        self.assertEqual(self.conn.execute('SELECT public.ingest_attendance(%s,%s,%s)',(other_device,TOKEN,Jsonb([auto]))).fetchone()[0],1)
        self.role(ADMIN)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.pending_card_events').fetchone()[0],2)

    def test_csv_name_matching_ignores_accents_initials_and_word_order(self):
        self.conn.execute("INSERT INTO public.officers(card_uid,first_name,last_name,position) VALUES ('ACCENT01','Ana María J.','Peña','Officer')")
        self.role(ADMIN)
        row={'date':'2020-09-01','first_name':'Pena','last_name':'Ana Maria','create_profile':True,'time_in':'09:00:00','time_out':'17:00:00'}
        self.assertEqual(self.csv_import([row])['created_profiles'],0)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM public.attendance_logs WHERE card_uid='ACCENT01'").fetchone()[0],2)

    def test_csv_created_profiles_are_rolled_back_with_a_failed_batch(self):
        self.role(ADMIN)
        self.conn.execute("INSERT INTO public.semesters(id,name,start_date,end_date,status) VALUES ('csv-term','Historical','2020-01-01','2020-12-31','ended')")
        row={'date':'2020-09-01','first_name':'Temporary','last_name':'Profile','create_profile':True,'time_in':'09:00:00','time_out':'17:00:00'}
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction(): self.csv_import([row,{**row,'date':'2019-01-01'}])
        self.assertEqual(self.conn.execute("SELECT count(*) FROM public.officers WHERE last_name='Profile'").fetchone()[0],0)

    def csv_import(self, rows=None, reason='Transcribed paper logbook'):
        self.conn.execute("INSERT INTO public.semesters(id,name,start_date,end_date,status) VALUES ('csv-term','Historical term','2020-01-01','2020-12-31','ended') ON CONFLICT(id) DO NOTHING")
        if rows is None:
            rows=[{'date':'2020-09-01','card_uid':'AAAA1111','time_in':'09:00:00','time_out':'17:00:00','source':'sample page row 1','signature':'see source','notes':'Reviewed'}]
        return self.conn.execute('SELECT public.import_attendance_csv(%s,%s,%s)',('csv-term',Jsonb(rows),reason)).fetchone()[0]

    def test_csv_import_requires_admin(self):
        self.role(OFFICER)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.conn.execute("SELECT public.import_attendance_csv('none','[]','Paper logbook')")

    def test_csv_import_is_audited_and_retry_does_not_duplicate(self):
        self.role(ADMIN)
        result=self.csv_import()
        self.assertEqual(result,{'imported_sessions':1,'skipped_sessions':0,'inserted_events':2,'created_profiles':0})
        self.assertEqual(self.csv_import()['skipped_sessions'],1)
        audits=self.conn.execute("SELECT operation,reason,after_data->'csv_import'->>'source' FROM public.attendance_audit ORDER BY id").fetchall()
        self.assertEqual(audits,[('import','Transcribed paper logbook','sample page row 1')]*2)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.attendance_logs WHERE manually_edited AND device_id IS NULL').fetchone()[0],2)

    def test_csv_import_rolls_back_every_row_on_error(self):
        self.role(ADMIN)
        self.conn.execute("INSERT INTO public.semesters(id,name,start_date,end_date,status) VALUES ('csv-term','Historical','2020-01-01','2020-12-31','ended')")
        valid={'date':'2020-09-01','card_uid':'AAAA1111','time_in':'09:00:00','time_out':'17:00:00'}
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction():
            self.csv_import([valid,{**valid,'date':'2020-09-02','card_uid':'UNKNOWN'}])
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.attendance_logs').fetchone()[0],0)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.attendance_audit').fetchone()[0],0)

    def test_csv_import_rejects_incomplete_reversed_future_and_outside_dates(self):
        self.role(ADMIN)
        self.conn.execute("INSERT INTO public.semesters(id,name,start_date,end_date,status) VALUES ('csv-term','Historical','2020-01-01','2020-12-31','ended')")
        valid={'date':'2020-09-01','card_uid':'AAAA1111','time_in':'09:00:00','time_out':'17:00:00'}
        for patch in [{'time_out':''},{'time_out':'08:00:00'},{'date':'2019-01-01'},{'date':'2099-01-01'},{'time_in':'09:00'}]:
            with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction(): self.csv_import([{**valid,**patch}])
        self.conn.execute("UPDATE public.semesters SET end_date=NULL WHERE id='csv-term'")
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction(): self.csv_import([{**valid,'date':'2099-01-01'}])

    def test_csv_import_preserves_corrected_and_deleted_event_ids(self):
        self.role(ADMIN)
        self.csv_import()
        event=self.conn.execute("SELECT id FROM public.attendance_logs WHERE type='CLOCK_IN'").fetchone()[0]
        self.conn.execute("SELECT public.correct_attendance(%s,'AAAA1111','CLOCK_IN','2020-09-01T09:05:00+08:00',false,'Correct paper time')",(event,))
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction(): self.csv_import()
        self.conn.execute("SELECT public.correct_attendance(%s,'AAAA1111','CLOCK_IN','2020-09-01T09:00:00+08:00',false,'Restore reviewed time')",(event,))
        self.conn.execute("SELECT public.delete_attendance(%s,'Mistaken source date')",(event,))
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction(): self.csv_import()
        self.assertEqual(self.conn.execute('SELECT count(*) FROM public.attendance_logs').fetchone()[0],2)

    def test_csv_import_rejects_overlapping_sessions(self):
        self.role(ADMIN)
        self.csv_import()
        valid={'date':'2020-09-01','card_uid':'AAAA1111','time_in':'10:00:00','time_out':'11:00:00'}
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction(): self.csv_import([valid])
        valid['time_in']='09:00:00';valid['time_out']='18:00:00'
        with self.assertRaises(psycopg.errors.RaiseException),self.conn.transaction(): self.csv_import([valid])

    def test_concurrent_csv_retries_create_one_audited_pair(self):
        actor=str(uuid4());term_id=str(uuid4());uid='CSV'+uuid4().hex.upper()
        barrier=threading.Barrier(2)
        rows=[{'date':'2020-09-01','card_uid':uid,'time_in':'09:00:00','time_out':'17:00:00'}]
        def run(_):
            with psycopg.connect(DSN) as conn:
                conn.execute("SET LOCAL statement_timeout='5s'")
                conn.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(actor,))
                conn.execute('SET LOCAL ROLE authenticated')
                barrier.wait(timeout=3)
                return conn.execute('SELECT public.import_attendance_csv(%s,%s,%s)',(term_id,Jsonb(rows),'Concurrent CSV retry')).fetchone()[0]
        try:
            with psycopg.connect(DSN) as conn:
                conn.execute('INSERT INTO auth.users(id) VALUES (%s)',(actor,))
                conn.execute("INSERT INTO public.user_roles VALUES (%s,'admin')",(actor,))
                conn.execute("INSERT INTO public.officers(card_uid,first_name,last_name,position) VALUES (%s,'Sample','Officer','Member')",(uid,))
                conn.execute("INSERT INTO public.semesters(id,name,start_date,end_date,status) VALUES (%s,'CSV concurrency','2020-01-01','2020-12-31','ended')",(term_id,))
            with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(run,[1,2]))
            self.assertCountEqual([r['imported_sessions'] for r in results],[1,0])
            self.assertEqual(sum(r['skipped_sessions'] for r in results),1)
            with psycopg.connect(DSN) as conn:
                self.assertEqual(conn.execute('SELECT count(*) FROM public.attendance_logs WHERE card_uid=%s',(uid,)).fetchone()[0],2)
                self.assertEqual(conn.execute('SELECT count(*) FROM public.attendance_audit WHERE actor_id=%s',(actor,)).fetchone()[0],2)
        finally:
            with psycopg.connect(DSN) as conn:
                conn.execute('DELETE FROM public.attendance_audit WHERE actor_id=%s',(actor,))
                conn.execute('DELETE FROM public.attendance_logs WHERE card_uid=%s',(uid,))
                conn.execute('DELETE FROM public.officers WHERE card_uid=%s',(uid,))
                conn.execute('DELETE FROM public.semesters WHERE id=%s',(term_id,))
                conn.execute('DELETE FROM public.user_roles WHERE user_id=%s',(actor,))
                conn.execute('DELETE FROM auth.users WHERE id=%s',(actor,))


if __name__ == '__main__':
    if DSN: initialize()
    unittest.main()
