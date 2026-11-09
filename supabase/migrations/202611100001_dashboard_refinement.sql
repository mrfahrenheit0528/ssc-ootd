-- Upgrade an existing SSC project AFTER 202611090001_initial.sql. Run once.
BEGIN;
CREATE TABLE public.semester_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id text NOT NULL REFERENCES public.semesters(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  schedule jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(semester_id,revision)
);
CREATE TABLE public.calendar_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id text NOT NULL REFERENCES public.semesters(id) ON DELETE CASCADE,
  date date NOT NULL,
  type text NOT NULL DEFAULT 'regular' CHECK(type IN ('regular','no_classes','optional')),
  note text NOT NULL DEFAULT '',
  required_uids jsonb CHECK(required_uids IS NULL OR jsonb_typeof(required_uids)='array'),
  schedule_version_id uuid REFERENCES public.semester_schedules(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(semester_id,date)
);
CREATE TABLE public.attendance_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attendance_log_id uuid NOT NULL REFERENCES public.attendance_logs(id),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  operation text NOT NULL,
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['semester_schedules','calendar_days','attendance_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  END LOOP;
END $$;
CREATE POLICY member_read ON public.semester_schedules FOR SELECT TO authenticated USING(public.is_member());
CREATE POLICY member_read ON public.calendar_days FOR SELECT TO authenticated USING(public.is_member());
CREATE POLICY admin_read ON public.attendance_audit FOR SELECT TO authenticated USING(public.is_admin());
REVOKE INSERT,UPDATE,DELETE ON public.attendance_logs,public.officers,public.system_settings,public.day_config FROM anon,authenticated;

-- Import the old recurring assignments into each existing semester. No old
-- records are deleted. Holiday dates become No Classes in the new calendar.
INSERT INTO public.semester_schedules(semester_id,revision,schedule)
SELECT s.id,1,(SELECT jsonb_object_agg(d::text,jsonb_build_object(
  'type',CASE WHEN coalesce(w.data->'schedule'->d::text->>'type','regular')='regular'
    AND jsonb_array_length(coalesce(w.data->'schedule'->d::text->'required_uids','[]'))>0 THEN 'scheduled' ELSE 'unscheduled' END,
  'required_uids',coalesce(w.data->'schedule'->d::text->'required_uids','[]'::jsonb))) FROM generate_series(0,6) d)
FROM public.semesters s LEFT JOIN public.day_config w ON w.id='weekly';
INSERT INTO public.calendar_days(semester_id,date,type,note,required_uids,schedule_version_id)
SELECT s.id,c.id::date,CASE WHEN c.data->>'type'='holiday' THEN 'no_classes' ELSE coalesce(c.data->>'type','regular') END,
  coalesce(c.data->>'note',''),nullif(c.data->'required_uids','null'::jsonb),CASE WHEN c.id::date<(now() AT TIME ZONE 'Asia/Manila')::date OR s.status='ended' THEN v.id END
FROM public.day_config c JOIN public.semesters s ON c.id ~ '^\d{4}-\d{2}-\d{2}$'
  AND c.id>=s.start_date::text AND (s.end_date IS NULL OR c.id<=s.end_date::text)
JOIN public.semester_schedules v ON v.semester_id=s.id AND v.revision=1;
-- Preserve historical weekly day types and dates before the old effective date.
INSERT INTO public.calendar_days(semester_id,date,type,required_uids,schedule_version_id)
SELECT s.id,d::date,
  CASE WHEN d::date < coalesce((w.data->>'effective_from')::date,s.start_date) THEN CASE WHEN extract(dow FROM d) IN (0,6) THEN 'no_classes' ELSE 'regular' END
    WHEN w.data->'schedule'->extract(dow FROM d)::integer::text->>'type' IN ('no_classes','holiday') THEN 'no_classes'
    WHEN w.data->'schedule'->extract(dow FROM d)::integer::text->>'type'='optional' THEN 'optional' ELSE 'regular' END,
  CASE WHEN d::date < coalesce((w.data->>'effective_from')::date,s.start_date) THEN '[]'::jsonb ELSE NULL END,v.id
FROM public.semesters s JOIN public.semester_schedules v ON v.semester_id=s.id
LEFT JOIN public.day_config w ON w.id='weekly'
CROSS JOIN LATERAL generate_series(s.start_date::timestamp,least(coalesce(s.end_date,(now() AT TIME ZONE 'Asia/Manila')::date-1),CASE WHEN s.status='ended' THEN coalesce(s.end_date,(now() AT TIME ZONE 'Asia/Manila')::date-1) ELSE (now() AT TIME ZONE 'Asia/Manila')::date-1 END)::timestamp,interval '1 day') d
ON CONFLICT(semester_id,date) DO NOTHING;

CREATE FUNCTION public.save_semester_schedule(p_semester_id text,p_schedule jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_id uuid; new_id uuid; rev integer; item jsonb; uid text; term public.semesters; day integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  SELECT * INTO term FROM public.semesters WHERE id=p_semester_id FOR UPDATE;
  IF term.id IS NULL OR term.status<>'active' THEN RAISE EXCEPTION 'Select an active semester; archived schedules are read-only'; END IF;
  IF jsonb_typeof(p_schedule) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid weekly schedule'; END IF;
  FOR day IN 0..6 LOOP
    item:=p_schedule->day::text;
    IF item IS NULL OR coalesce(item->>'type','') NOT IN ('scheduled','unscheduled') OR jsonb_typeof(item->'required_uids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Every weekday needs Scheduled or Unscheduled and an officer list'; END IF;
    IF item->>'type'='scheduled' AND jsonb_array_length(item->'required_uids')=0 THEN RAISE EXCEPTION 'Select at least one officer for each Scheduled day'; END IF;
    FOR uid IN SELECT jsonb_array_elements_text(item->'required_uids') LOOP
      IF NOT EXISTS(SELECT 1 FROM public.officers WHERE card_uid=uid) THEN RAISE EXCEPTION 'Unknown officer: %',uid; END IF;
    END LOOP;
  END LOOP;
  SELECT id,revision INTO old_id,rev FROM public.semester_schedules WHERE semester_id=p_semester_id ORDER BY revision DESC LIMIT 1;
  IF old_id IS NOT NULL THEN
    INSERT INTO public.calendar_days(semester_id,date,schedule_version_id)
      SELECT p_semester_id,d::date,old_id FROM generate_series(term.start_date::timestamp,least(coalesce(term.end_date,(now() AT TIME ZONE 'Asia/Manila')::date),((now() AT TIME ZONE 'Asia/Manila')::date-1))::timestamp,interval '1 day') d
      ON CONFLICT(semester_id,date) DO UPDATE SET schedule_version_id=coalesce(public.calendar_days.schedule_version_id,excluded.schedule_version_id);
  END IF;
  INSERT INTO public.semester_schedules(semester_id,revision,schedule,created_by) VALUES(p_semester_id,coalesce(rev,0)+1,p_schedule,auth.uid()) RETURNING id INTO new_id;
  RETURN new_id;
END $$;
CREATE FUNCTION public.save_calendar_day(p_semester_id text,p_date date,p_type text,p_note text,p_required_uids jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE term public.semesters; uid text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  SELECT * INTO term FROM public.semesters WHERE id=p_semester_id FOR UPDATE;
  IF term.id IS NULL OR term.status<>'active' THEN RAISE EXCEPTION 'Archived calendars are read-only'; END IF;
  IF p_date<term.start_date OR (term.end_date IS NOT NULL AND p_date>term.end_date) THEN RAISE EXCEPTION 'Date must be inside the semester'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('regular','no_classes','optional') OR length(p_note)>1000 THEN RAISE EXCEPTION 'Invalid calendar day'; END IF;
  IF p_required_uids IS NOT NULL THEN
    IF jsonb_typeof(p_required_uids)<>'array' THEN RAISE EXCEPTION 'Officer list must be an array'; END IF;
    FOR uid IN SELECT jsonb_array_elements_text(p_required_uids) LOOP
      IF NOT EXISTS(SELECT 1 FROM public.officers WHERE card_uid=uid) THEN RAISE EXCEPTION 'Unknown officer: %',uid; END IF;
    END LOOP;
  END IF;
  INSERT INTO public.calendar_days(semester_id,date,type,note,required_uids) VALUES(p_semester_id,p_date,p_type,trim(p_note),p_required_uids)
    ON CONFLICT(semester_id,date) DO UPDATE SET type=excluded.type,note=excluded.note,required_uids=excluded.required_uids,updated_at=now();
END $$;
CREATE FUNCTION public.set_enrollment(p_owner uuid,p_active boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE affected integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  IF p_owner IS NULL OR p_active IS NULL THEN RAISE EXCEPTION 'Enrollment owner and active flag required'; END IF;
  IF p_active THEN
    INSERT INTO public.system_settings(id,data) VALUES('enrollment_mode',jsonb_build_object('active',true,'owner',p_owner,'expires_at',now()+interval '60 seconds'))
      ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE coalesce((public.system_settings.data->>'expires_at')::timestamptz,now())<=now()
        OR coalesce((public.system_settings.data->>'active')::boolean,false)=false OR public.system_settings.data->>'owner'=p_owner::text;
  ELSE
    UPDATE public.system_settings SET data=jsonb_build_object('active',false,'owner',p_owner,'expires_at',now())
      WHERE id='enrollment_mode' AND data->>'owner'=p_owner::text;
  END IF;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected>0;
END $$;
CREATE FUNCTION public.save_officer(p_uid text,p_profile jsonb,p_create boolean,p_reactivate boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.officers;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  IF p_uid IS NULL OR p_uid !~ '^[A-Z0-9]{4,64}$' OR coalesce(length(trim(p_profile->>'first_name')),0)=0 OR coalesce(length(trim(p_profile->>'last_name')),0)=0 OR coalesce(length(trim(p_profile->>'position')),0)=0 OR p_create IS NULL THEN RAISE EXCEPTION 'Card UID, name, position and operation are required'; END IF;
  SELECT * INTO old FROM public.officers WHERE card_uid=p_uid FOR UPDATE;
  IF p_create AND old.card_uid IS NOT NULL THEN RAISE EXCEPTION 'Card already enrolled. Edit or explicitly restore its existing officer profile.'; END IF;
  IF NOT p_create AND old.card_uid IS NULL THEN RAISE EXCEPTION 'Officer not found'; END IF;
  IF NOT p_create AND NOT old.active AND NOT p_reactivate THEN RAISE EXCEPTION 'Restore this officer before editing'; END IF;
  IF p_create THEN
    INSERT INTO public.officers(card_uid,first_name,last_name,position,photo_id) VALUES(p_uid,trim(p_profile->>'first_name'),trim(p_profile->>'last_name'),trim(p_profile->>'position'),(p_profile->>'photo_id')::uuid);
  ELSE
    UPDATE public.officers SET first_name=trim(p_profile->>'first_name'),last_name=trim(p_profile->>'last_name'),position=trim(p_profile->>'position'),
      photo_id=(p_profile->>'photo_id')::uuid,active=true,updated_at=now() WHERE card_uid=p_uid;
  END IF;
END $$;
CREATE FUNCTION public.deactivate_officer(p_uid text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  UPDATE public.officers SET active=false,updated_at=now() WHERE card_uid=p_uid;
END $$;
CREATE FUNCTION public.correct_attendance(p_id uuid,p_uid text,p_type text,p_timestamp timestamptz,p_auto boolean,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.attendance_logs; result public.attendance_logs; name text; target uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))<3 OR length(p_reason)>1000 THEN RAISE EXCEPTION 'Enter a correction reason (3–1000 characters)'; END IF;
  IF p_timestamp>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Attendance cannot be recorded in the future'; END IF;
  PERFORM pg_advisory_xact_lock(73085103);
  SELECT first_name||' '||last_name INTO name FROM public.officers WHERE card_uid=p_uid;
  IF name IS NULL THEN RAISE EXCEPTION 'Officer not found'; END IF;
  target:=coalesce(p_id,gen_random_uuid());
  IF p_id IS NULL THEN
    INSERT INTO public.attendance_logs(id,card_uid,officer_name,type,timestamp,is_auto_closed,manually_edited)
      VALUES(target,p_uid,name,p_type,p_timestamp,p_auto,true) RETURNING * INTO result;
  ELSE
    SELECT * INTO old FROM public.attendance_logs WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
    IF old.id IS NULL THEN RAISE EXCEPTION 'Attendance entry not found'; END IF;
    UPDATE public.attendance_logs SET card_uid=p_uid,officer_name=CASE WHEN p_uid=old.card_uid THEN old.officer_name ELSE name END,
      type=p_type,timestamp=p_timestamp,is_auto_closed=p_auto,manually_edited=true WHERE id=p_id RETURNING * INTO result;
  END IF;
  INSERT INTO public.attendance_audit(attendance_log_id,actor_id,actor_email,operation,reason,before_data,after_data)
    VALUES(target,auth.uid(),coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email','Administrator'),
      CASE WHEN p_id IS NULL THEN 'create' ELSE 'update' END,trim(p_reason),CASE WHEN old.id IS NOT NULL THEN to_jsonb(old) END,to_jsonb(result));
  RETURN target;
END $$;
CREATE FUNCTION public.delete_attendance(p_id uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.attendance_logs; result public.attendance_logs;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))<3 OR length(p_reason)>1000 THEN RAISE EXCEPTION 'Enter a deletion reason (3–1000 characters)'; END IF;
  PERFORM pg_advisory_xact_lock(73085103);
  SELECT * INTO old FROM public.attendance_logs WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
  IF old.id IS NULL THEN RAISE EXCEPTION 'Attendance entry not found'; END IF;
  UPDATE public.attendance_logs SET deleted_at=now(),manually_edited=true WHERE id=p_id RETURNING * INTO result;
  INSERT INTO public.attendance_audit(attendance_log_id,actor_id,actor_email,operation,reason,before_data,after_data)
    VALUES(p_id,auth.uid(),coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email','Administrator'),'delete',trim(p_reason),to_jsonb(old),to_jsonb(result));
END $$;

-- Recover missed 9 PM cutoffs when a reader or dashboard reconnects. Stable IDs
-- are shared with the native reader, so both recovery paths cannot duplicate it.
CREATE INDEX attendance_recovery_order ON public.attendance_logs(card_uid,((timestamp AT TIME ZONE 'Asia/Manila')::date),timestamp DESC,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE FUNCTION public.recover_due_attendance_internal() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row public.attendance_logs; cutoff timestamptz; count integer:=0; affected integer;
BEGIN
  PERFORM pg_advisory_xact_lock(73085103);
  FOR row IN SELECT DISTINCT ON(card_uid,(timestamp AT TIME ZONE 'Asia/Manila')::date) * FROM public.attendance_logs
    WHERE deleted_at IS NULL AND timestamp<=now() ORDER BY card_uid,(timestamp AT TIME ZONE 'Asia/Manila')::date,timestamp DESC,created_at DESC,id DESC LOOP
    cutoff:=greatest(((row.timestamp AT TIME ZONE 'Asia/Manila')::date+time '21:00') AT TIME ZONE 'Asia/Manila',row.timestamp+interval '1 microsecond');
    IF row.type='CLOCK_IN' AND cutoff<=now() THEN
      INSERT INTO public.attendance_logs(id,card_uid,officer_name,type,timestamp,is_auto_closed,device_id)
        VALUES(md5(row.id::text||':auto-close')::uuid,row.card_uid,row.officer_name,'CLOCK_OUT',cutoff,true,row.device_id) ON CONFLICT(id) DO NOTHING;
      GET DIAGNOSTICS affected=ROW_COUNT; count:=count+affected;
    END IF;
  END LOOP;
  RETURN count;
END $$;
CREATE FUNCTION public.recover_due_attendance() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.is_member() THEN RAISE EXCEPTION 'Approved account required' USING ERRCODE='42501'; END IF;
  RETURN public.recover_due_attendance_internal();
END $$;
DROP FUNCTION public.reader_context(uuid,text);
CREATE FUNCTION public.reader_context(p_device_id uuid,p_token text,p_event_ids jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE enrollment jsonb; snapshot timestamptz:=clock_timestamp();
BEGIN
  PERFORM public.verify_reader(p_device_id,p_token);
  IF jsonb_typeof(p_event_ids) IS DISTINCT FROM 'array' OR jsonb_array_length(p_event_ids)>5000 THEN RAISE EXCEPTION 'Invalid local event list'; END IF;
  PERFORM public.recover_due_attendance_internal();
  SELECT data INTO enrollment FROM public.system_settings WHERE id='enrollment_mode';
  RETURN jsonb_build_object('snapshot_at',snapshot,'date',(now() AT TIME ZONE 'Asia/Manila')::date,
    'officers',coalesce((SELECT jsonb_agg(jsonb_build_object('card_uid',card_uid,'first_name',first_name,'last_name',last_name)) FROM public.officers WHERE active),'[]'),
    'events',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.attendance_logs a WHERE (timestamp AT TIME ZONE 'Asia/Manila')::date=(now() AT TIME ZONE 'Asia/Manila')::date),'[]'),
    'known_event_ids',coalesce((SELECT jsonb_agg(id) FROM public.attendance_logs WHERE id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_event_ids))),'[]'),
    'enrollment_active',coalesce((enrollment->>'active')::boolean,false) AND coalesce((enrollment->>'expires_at')::timestamptz>now(),false));
END $$;
CREATE OR REPLACE FUNCTION public.reader_tap(p_device_id uuid, p_token text, p_uid text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE enrollment jsonb;
BEGIN
  PERFORM public.verify_reader(p_device_id,p_token);
  IF p_uid !~ '^[A-Z0-9]{4,64}$' THEN RAISE EXCEPTION 'Invalid card UID'; END IF;
  SELECT data INTO enrollment FROM public.system_settings WHERE id='enrollment_mode';
  IF coalesce((enrollment->>'active')::boolean,false) AND coalesce((enrollment->>'expires_at')::timestamptz>now(),false) THEN
    INSERT INTO public.system_settings(id,data) VALUES ('live_scanner',jsonb_build_object('latest_uid',p_uid,'timestamp',now(),'owner',enrollment->>'owner'))
      ON CONFLICT(id) DO UPDATE SET data=excluded.data;
    RETURN true;
  END IF;
  RETURN false;
END $$;
CREATE OR REPLACE FUNCTION public.ingest_attendance(p_device_id uuid, p_token text, p_events jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item jsonb; uid text; name text; accepted integer := 0;
BEGIN
  PERFORM public.verify_reader(p_device_id,p_token);
  IF jsonb_typeof(p_events)<>'array' OR jsonb_array_length(p_events)>100 THEN RAISE EXCEPTION 'Send at most 100 events'; END IF;
  PERFORM pg_advisory_xact_lock(73085103);
  FOR item IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    uid := item->>'card_uid';
    SELECT first_name||' '||last_name INTO name FROM public.officers WHERE card_uid=uid;
    IF name IS NULL THEN RAISE EXCEPTION 'Officer not enrolled: %',uid; END IF;
    INSERT INTO public.attendance_logs(id,card_uid,officer_name,type,timestamp,is_auto_closed,device_id)
      VALUES ((item->>'event_id')::uuid,uid,name,item->>'action_type',(item->>'timestamp')::timestamptz,
        coalesce((item->>'is_auto_closed')::boolean,false),p_device_id)
      ON CONFLICT(id) DO NOTHING;
    -- A duplicate is acknowledged without overwriting a manual correction or tombstone.
    IF NOT EXISTS(SELECT 1 FROM public.attendance_logs a WHERE a.id=(item->>'event_id')::uuid AND (a.device_id=p_device_id OR (coalesce((item->>'is_auto_closed')::boolean,false) AND item->>'action_type'='CLOCK_OUT' AND a.card_uid=uid AND EXISTS(SELECT 1 FROM public.attendance_logs source WHERE source.card_uid=uid AND md5(source.id::text||':auto-close')::uuid=a.id)))) THEN
      RAISE EXCEPTION 'Event ID belongs to another source';
    END IF;
    accepted := accepted+1;
  END LOOP;
  RETURN accepted;
END $$;
DO $$ DECLARE signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY['save_semester_schedule(text,jsonb)','save_calendar_day(text,date,text,text,jsonb)','set_enrollment(uuid,boolean)',
    'save_officer(text,jsonb,boolean,boolean)','deactivate_officer(text)','correct_attendance(uuid,text,text,timestamptz,boolean,text)',
    'delete_attendance(uuid,text)','recover_due_attendance()'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||signature||' FROM PUBLIC,anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||signature||' TO authenticated';
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.recover_due_attendance_internal() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reader_context(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reader_context(uuid,text,jsonb) TO anon,authenticated;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['semester_schedules','calendar_days'] LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
  END LOOP;
END $$;
COMMIT;
