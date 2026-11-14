-- Apply after 202611150001_live_unlinked_cards.sql. Run once.
BEGIN;
ALTER TABLE public.semesters ADD COLUMN roster_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN council_name text NOT NULL DEFAULT '',
  ADD COLUMN position_config jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(position_config)='array'),
  ADD COLUMN positions_configured boolean NOT NULL DEFAULT false,
  ADD COLUMN council_source_semester_id text REFERENCES public.semesters(id) ON DELETE SET NULL;

-- Adopt the existing council without replacing any archived snapshots.
UPDATE public.semesters SET officer_snapshot=public.roster_snapshot() WHERE status='active';
UPDATE public.semesters s SET roster_managed=true,council_name='Council — '||name,
  position_config=coalesce((SELECT jsonb_agg(jsonb_build_object('name',position,'capacity',count,'group','') ORDER BY position)
    FROM (SELECT item->>'position' AS position,count(*) AS count FROM jsonb_array_elements(s.officer_snapshot) item
      WHERE coalesce(item->>'position','')<>'' GROUP BY item->>'position') positions),'[]'::jsonb);

CREATE FUNCTION public.build_council_roster(p_roster jsonb,p_positions jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; rule jsonb; profile public.officers; result jsonb:='[]'; seen text[]:='{}'; position_names text[]:='{}'; name text; capacity integer;
BEGIN
  IF jsonb_typeof(p_roster) IS DISTINCT FROM 'array' OR jsonb_array_length(p_roster)>500
    OR jsonb_typeof(p_positions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_positions)>100 THEN RAISE EXCEPTION 'Invalid council roster or positions'; END IF;
  FOR rule IN SELECT value FROM jsonb_array_elements(p_positions) LOOP
    name:=trim(rule->>'name');
    IF coalesce(length(name),0) NOT BETWEEN 1 AND 150 OR lower(name)=ANY(position_names)
      OR length(coalesce(rule->>'group',''))>100 THEN RAISE EXCEPTION 'Position names must be unique and 1–150 characters'; END IF;
    position_names:=array_append(position_names,lower(name));
    IF rule->>'capacity' IS NOT NULL THEN
      IF rule->>'capacity' !~ '^\d{1,5}$' THEN RAISE EXCEPTION 'Position capacity must be a nonnegative whole number or blank for unlimited'; END IF;
      capacity:=(rule->>'capacity')::integer;
      IF (SELECT count(*) FROM jsonb_array_elements(p_roster) member WHERE trim(member->>'position')=name)>capacity THEN RAISE EXCEPTION 'Too many officers for position % (capacity %)',name,capacity; END IF;
    END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p_roster) LOOP
    IF item->>'card_uid' IS NULL OR item->>'card_uid'=ANY(seen) THEN RAISE EXCEPTION 'Each officer may appear only once in a council'; END IF;
    seen:=array_append(seen,item->>'card_uid');
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_positions) definition WHERE trim(definition->>'name')=trim(item->>'position')) THEN RAISE EXCEPTION 'Choose a configured council position for every selected officer'; END IF;
    SELECT * INTO profile FROM public.officers WHERE card_uid=item->>'card_uid';
    IF profile.card_uid IS NULL THEN RAISE EXCEPTION 'Officer profile not found: %',item->>'card_uid'; END IF;
    result:=result||jsonb_build_array(jsonb_build_object('card_uid',profile.card_uid,'nfc_uid',profile.nfc_uid,
      'first_name',profile.first_name,'last_name',profile.last_name,'position',trim(item->>'position'),'photo_id',profile.photo_id,'serving',true));
  END LOOP;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.build_council_roster(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.canonical_council_positions(p_positions jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('name',trim(rule->>'name'),'group',trim(coalesce(rule->>'group','')),'capacity',(rule->>'capacity')::integer)),'[]') FROM jsonb_array_elements(p_positions) rule;
$$;
REVOKE ALL ON FUNCTION public.canonical_council_positions(jsonb) FROM PUBLIC,anon,authenticated;


-- A person's current role is semester-specific. Historical uploads resolve
-- eligibility using their original school date, rather than today's council.
CREATE FUNCTION public.officer_serves_on(p_uid text,p_date date) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE term public.semesters;
BEGIN
  SELECT * INTO term FROM public.semesters WHERE start_date<=p_date AND (end_date IS NULL OR end_date>=p_date)
    ORDER BY CASE WHEN p_date=(now() AT TIME ZONE 'Asia/Manila')::date THEN status='active' ELSE false END DESC,start_date DESC LIMIT 1;
  IF term.id IS NULL OR NOT term.roster_managed THEN RETURN EXISTS(SELECT 1 FROM public.officers WHERE card_uid=p_uid AND active); END IF;
  RETURN EXISTS(SELECT 1 FROM jsonb_array_elements(term.officer_snapshot) member WHERE member->>'card_uid'=p_uid AND (coalesce((member->>'serving')::boolean,true) OR p_date<=(member->>'served_until')::date));
END $$;
REVOKE ALL ON FUNCTION public.officer_serves_on(text,date) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_semester_schedule_legacy(p_semester_id text,p_schedule jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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

REVOKE ALL ON FUNCTION public.save_semester_schedule_legacy(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.save_semester_schedule(p_semester_id text,p_schedule jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE term public.semesters; item jsonb; uid text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(73085102);
  SELECT * INTO term FROM public.semesters WHERE id=p_semester_id;
  IF term.roster_managed AND jsonb_typeof(p_schedule)='object' THEN
    FOR item IN SELECT value FROM jsonb_each(p_schedule) LOOP
      IF jsonb_typeof(item->'required_uids')='array' THEN
        FOR uid IN SELECT jsonb_array_elements_text(item->'required_uids') LOOP
          IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(term.officer_snapshot) member WHERE member->>'card_uid'=uid AND coalesce((member->>'serving')::boolean,true)) THEN RAISE EXCEPTION 'Weekly assignments must use officers serving in this semester'; END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  RETURN public.save_semester_schedule_legacy(p_semester_id,p_schedule);
END $$;
REVOKE ALL ON FUNCTION public.save_semester_schedule(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_semester_schedule(text,jsonb) TO authenticated;

CREATE FUNCTION public.save_semester_council(p_semester_id text,p_roster jsonb,p_positions jsonb,p_council_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE term public.semesters; roster jsonb; week jsonb; revised jsonb; day integer; uids jsonb; revision_id uuid; removed boolean;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  IF coalesce(length(trim(p_council_name)),0) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'Council name is required (1–150 characters)'; END IF;
  PERFORM pg_advisory_xact_lock(73085102);PERFORM pg_advisory_xact_lock(73085103);
  SELECT * INTO term FROM public.semesters WHERE id=p_semester_id FOR UPDATE;
  IF term.id IS NULL OR term.status<>'active' THEN RAISE EXCEPTION 'Only the active semester council can be changed'; END IF;
  roster:=public.build_council_roster(p_roster,p_positions);
  removed:=EXISTS(SELECT 1 FROM jsonb_array_elements(term.officer_snapshot) old
    WHERE coalesce((old->>'serving')::boolean,true) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(roster) member WHERE member->>'card_uid'=old->>'card_uid'));
  IF removed THEN
    SELECT schedule INTO week FROM public.semester_schedules WHERE semester_id=p_semester_id ORDER BY revision DESC LIMIT 1;
    IF week IS NOT NULL THEN
      revised:='{}';
      FOR day IN 0..6 LOOP
        SELECT coalesce(jsonb_agg(value),'[]') INTO uids FROM jsonb_array_elements(week->day::text->'required_uids') old
          WHERE week->day::text->>'type'='scheduled' AND EXISTS(SELECT 1 FROM jsonb_array_elements(roster) member WHERE member->>'card_uid'=old.value#>>'{}');
        revised:=revised||jsonb_build_object(day::text,jsonb_build_object('type',CASE WHEN jsonb_array_length(uids)>0 THEN 'scheduled' ELSE 'unscheduled' END,'required_uids',uids));
      END LOOP;
      revision_id:=public.save_semester_schedule_legacy(p_semester_id,revised);
      UPDATE public.calendar_days SET schedule_version_id=revision_id WHERE semester_id=p_semester_id AND date>=(now() AT TIME ZONE 'Asia/Manila')::date AND schedule_version_id IS NOT NULL;
    END IF;
    UPDATE public.calendar_days d SET required_uids=(SELECT coalesce(jsonb_agg(value),'[]') FROM jsonb_array_elements(d.required_uids) old
      WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(roster) member WHERE member->>'card_uid'=old.value#>>'{}'))
      WHERE semester_id=p_semester_id AND date>=(now() AT TIME ZONE 'Asia/Manila')::date AND required_uids IS NOT NULL;
  END IF;
  -- Keep departed members' historical positions within this term.
  roster:=roster||coalesce((SELECT jsonb_agg(old||jsonb_build_object('serving',false,'served_until',coalesce(old->>'served_until',((now() AT TIME ZONE 'Asia/Manila')::date-1)::text))) FROM jsonb_array_elements(term.officer_snapshot) old
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(roster) member WHERE member->>'card_uid'=old->>'card_uid')),'[]');
  UPDATE public.semesters SET officer_snapshot=roster,position_config=public.canonical_council_positions(p_positions),council_name=trim(p_council_name),roster_managed=true,positions_configured=true WHERE id=p_semester_id;
  UPDATE public.officers SET active=true WHERE card_uid IN(SELECT member->>'card_uid' FROM jsonb_array_elements(p_roster) member);
END $$;
REVOKE ALL ON FUNCTION public.save_semester_council(text,jsonb,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_semester_council(text,jsonb,jsonb,text) TO authenticated;

CREATE FUNCTION public.start_semester_council(p_id text,p_name text,p_start_date date,p_mode text,p_source_semester_id text,p_roster jsonb,p_positions jsonb,p_council_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source public.semesters; roster jsonb; positions jsonb; council text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  IF coalesce(length(trim(p_name)),0) NOT BETWEEN 1 AND 200 OR p_start_date IS NULL OR p_mode IS NULL OR p_mode NOT IN ('continue','new') THEN RAISE EXCEPTION 'Semester name, start date and council choice are required'; END IF;
  PERFORM pg_advisory_xact_lock(73085102);PERFORM pg_advisory_xact_lock(73085103);
  IF EXISTS(SELECT 1 FROM public.semesters WHERE status='active') THEN RAISE EXCEPTION 'End the active semester before starting another'; END IF;
  IF EXISTS(SELECT 1 FROM public.semesters WHERE end_date IS NULL OR end_date>=p_start_date) THEN RAISE EXCEPTION 'The new semester must start after the previous semester ends'; END IF;
  IF p_source_semester_id IS NOT NULL THEN SELECT * INTO source FROM public.semesters WHERE id=p_source_semester_id; END IF;
  IF p_mode='continue' THEN
    IF source.id IS NULL THEN RAISE EXCEPTION 'Choose a previous semester council'; END IF;
    SELECT coalesce(jsonb_agg(member),'[]') INTO roster FROM jsonb_array_elements(source.officer_snapshot) member WHERE coalesce((member->>'serving')::boolean,true);
    positions:=source.position_config;council:=source.council_name;
  ELSE roster:=p_roster;positions:=p_positions;council:=trim(p_council_name); END IF;
  IF coalesce(length(council),0) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'Council name is required'; END IF;
  roster:=public.build_council_roster(roster,positions);
  INSERT INTO public.semesters(id,name,start_date,status,officer_snapshot,roster_managed,position_config,positions_configured,council_name,council_source_semester_id)
    VALUES(p_id,trim(p_name),p_start_date,'active',roster,true,public.canonical_council_positions(positions),CASE WHEN p_mode='continue' THEN source.positions_configured ELSE true END,council,p_source_semester_id);
  UPDATE public.officers SET active=true WHERE card_uid IN(SELECT member->>'card_uid' FROM jsonb_array_elements(roster) member);
END $$;
REVOKE ALL ON FUNCTION public.start_semester_council(text,text,date,text,text,jsonb,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_semester_council(text,text,date,text,text,jsonb,jsonb,text) TO authenticated;

CREATE FUNCTION public.save_officer_for_semester(p_semester_id text,p_id text,p_nfc_uid text,p_profile jsonb,p_create boolean,p_reactivate boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE key text; term public.semesters; roster jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(73085102);PERFORM pg_advisory_xact_lock(73085103);
  SELECT * INTO term FROM public.semesters WHERE id=p_semester_id FOR UPDATE;
  IF term.id IS NULL OR term.status<>'active' THEN RAISE EXCEPTION 'Choose an active semester for this officer'; END IF;
  key:=public.save_officer_profile(p_id,p_nfc_uid,p_profile,p_create,p_reactivate);
  SELECT coalesce(jsonb_agg(member),'[]') INTO roster FROM jsonb_array_elements(term.officer_snapshot) member
    WHERE coalesce((member->>'serving')::boolean,true) AND member->>'card_uid'<>key;
  roster:=roster||jsonb_build_array(jsonb_build_object('card_uid',key,'position',trim(p_profile->>'position')));
  PERFORM public.save_semester_council(p_semester_id,roster,term.position_config,term.council_name);
  RETURN key;
END $$;
REVOKE ALL ON FUNCTION public.save_officer_for_semester(text,text,text,jsonb,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_officer_for_semester(text,text,text,jsonb,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.deactivate_officer(p_uid text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE term public.semesters; roster jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(73085102);PERFORM pg_advisory_xact_lock(73085103);
  SELECT * INTO term FROM public.semesters WHERE status='active';
  IF term.roster_managed THEN
    SELECT coalesce(jsonb_agg(member),'[]') INTO roster FROM jsonb_array_elements(term.officer_snapshot) member
      WHERE coalesce((member->>'serving')::boolean,true) AND member->>'card_uid'<>p_uid;
    PERFORM public.save_semester_council(term.id,roster,term.position_config,term.council_name);
  END IF;
  UPDATE public.officers SET active=false,updated_at=now() WHERE card_uid=p_uid;
END $$;

CREATE OR REPLACE FUNCTION public.archive_semester(p_id text,p_end_date date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(73085102);PERFORM pg_advisory_xact_lock(73085103);
  UPDATE public.semesters SET status='ended',end_date=p_end_date,ended_at=now(),officer_snapshot=CASE WHEN roster_managed THEN officer_snapshot ELSE public.roster_snapshot() END WHERE id=p_id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active semester not found'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.activate_semester(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(73085102);PERFORM pg_advisory_xact_lock(73085103);
  IF NOT EXISTS(SELECT 1 FROM public.semesters WHERE id=p_id) THEN RAISE EXCEPTION 'Semester not found'; END IF;
  UPDATE public.semesters SET status='ended',end_date=greatest(start_date,(now() AT TIME ZONE 'Asia/Manila')::date),ended_at=now(),
    officer_snapshot=CASE WHEN roster_managed THEN officer_snapshot ELSE public.roster_snapshot() END WHERE status='active' AND id<>p_id;
  UPDATE public.semesters SET status='active',end_date=NULL WHERE id=p_id;
END $$;

-- Full profile/photograph management is now admin-only. Approved members get
-- the semester identities needed by read-only attendance reports via snapshots.
DROP POLICY member_read ON public.officers;
CREATE POLICY admin_read ON public.officers FOR SELECT TO authenticated USING(public.is_admin());
DROP POLICY member_read ON public.officer_photos;
CREATE POLICY admin_read ON public.officer_photos FOR SELECT TO authenticated USING(public.is_admin());

CREATE OR REPLACE FUNCTION public.ingest_attendance(p_device_id uuid,p_token text,p_events jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; nfc text; uid text; name text; accepted integer:=0; event uuid; stamp timestamptz; auto boolean;
BEGIN
  PERFORM public.verify_reader(p_device_id,p_token);
  IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' OR jsonb_array_length(p_events)>100 THEN RAISE EXCEPTION 'Send at most 100 events'; END IF;
  PERFORM pg_advisory_xact_lock(73085103);
  FOR item IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    nfc:=item->>'card_uid'; event:=(item->>'event_id')::uuid; stamp:=(item->>'timestamp')::timestamptz; auto:=coalesce((item->>'is_auto_closed')::boolean,false);
    IF nfc IS NULL OR nfc !~ '^[A-Z0-9]{4,64}$' OR event IS NULL OR stamp IS NULL OR coalesce(item->>'action_type','') NOT IN ('CLOCK_IN','CLOCK_OUT') THEN RAISE EXCEPTION 'Invalid attendance event'; END IF;
    IF EXISTS(SELECT 1 FROM public.pending_card_events WHERE id=event) THEN
      IF NOT EXISTS(SELECT 1 FROM public.pending_card_events p WHERE p.id=event AND p.card_uid=nfc
        AND (p.device_id=p_device_id OR (auto AND item->>'action_type'='CLOCK_OUT'
          AND EXISTS(SELECT 1 FROM public.pending_card_events source WHERE source.card_uid=nfc AND md5(source.id::text||':auto-close')::uuid=p.id)))) THEN RAISE EXCEPTION 'Event ID belongs to another source'; END IF;
      accepted:=accepted+1; CONTINUE;
    END IF;
    -- Retry receipts remain valid even if a council changed after upload.
    IF EXISTS(SELECT 1 FROM public.attendance_logs WHERE id=event) THEN
      IF NOT EXISTS(SELECT 1 FROM public.attendance_logs a JOIN public.officers o ON o.card_uid=a.card_uid
        WHERE a.id=event AND (a.device_id=p_device_id OR (o.nfc_uid=nfc AND auto AND item->>'action_type'='CLOCK_OUT'
          AND EXISTS(SELECT 1 FROM public.attendance_logs source WHERE source.card_uid=a.card_uid AND md5(source.id::text||':auto-close')::uuid=a.id)))) THEN RAISE EXCEPTION 'Event ID belongs to another source'; END IF;
      accepted:=accepted+1;CONTINUE;
    END IF;
    SELECT card_uid,first_name||' '||last_name INTO uid,name FROM public.officers WHERE nfc_uid=nfc AND public.officer_serves_on(card_uid,(stamp AT TIME ZONE 'Asia/Manila')::date);
    IF uid IS NULL THEN
      IF EXISTS(SELECT 1 FROM public.attendance_logs WHERE id=event) THEN RAISE EXCEPTION 'Event ID belongs to another source'; END IF;
      INSERT INTO public.pending_card_events(id,card_uid,type,timestamp,is_auto_closed,device_id)
        VALUES(event,nfc,item->>'action_type',stamp,auto,p_device_id);
    ELSE
      INSERT INTO public.attendance_logs(id,card_uid,officer_name,type,timestamp,is_auto_closed,device_id)
        VALUES(event,uid,name,item->>'action_type',stamp,auto,p_device_id) ON CONFLICT(id) DO NOTHING;
      IF NOT EXISTS(SELECT 1 FROM public.attendance_logs a WHERE a.id=event AND (a.device_id=p_device_id OR (auto AND item->>'action_type'='CLOCK_OUT' AND a.card_uid=uid AND EXISTS(SELECT 1 FROM public.attendance_logs source WHERE source.card_uid=uid AND md5(source.id::text||':auto-close')::uuid=a.id)))) THEN RAISE EXCEPTION 'Event ID belongs to another source'; END IF;
    END IF;
    accepted:=accepted+1;
  END LOOP;
  RETURN accepted;
END $$;

CREATE OR REPLACE FUNCTION public.reader_context(p_device_id uuid,p_token text,p_event_ids jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE enrollment jsonb; snapshot timestamptz:=clock_timestamp();
BEGIN
  PERFORM public.verify_reader(p_device_id,p_token);
  IF jsonb_typeof(p_event_ids) IS DISTINCT FROM 'array' OR jsonb_array_length(p_event_ids)>5000 THEN RAISE EXCEPTION 'Invalid local event list'; END IF;
  PERFORM public.recover_due_attendance_internal();
  SELECT data INTO enrollment FROM public.system_settings WHERE id='enrollment_mode';
  RETURN jsonb_build_object('snapshot_at',snapshot,'date',(now() AT TIME ZONE 'Asia/Manila')::date,'accept_unknown_cards',true,
    'officers',coalesce((SELECT jsonb_agg(jsonb_build_object('card_uid',nfc_uid,'first_name',first_name,'last_name',last_name)) FROM public.officers WHERE nfc_uid IS NOT NULL AND public.officer_serves_on(card_uid,(now() AT TIME ZONE 'Asia/Manila')::date)),'[]'),
    'events',coalesce((SELECT jsonb_agg(event_data) FROM (
      SELECT to_jsonb(a)||jsonb_build_object('card_uid',o.nfc_uid) AS event_data FROM public.attendance_logs a JOIN public.officers o ON o.card_uid=a.card_uid
        WHERE o.nfc_uid IS NOT NULL AND (a.timestamp AT TIME ZONE 'Asia/Manila')::date=(now() AT TIME ZONE 'Asia/Manila')::date
      UNION ALL SELECT to_jsonb(p) FROM public.pending_card_events p WHERE linked_officer_key IS NULL AND (timestamp AT TIME ZONE 'Asia/Manila')::date=(now() AT TIME ZONE 'Asia/Manila')::date
    ) events),'[]'),
    'known_event_ids',coalesce((SELECT jsonb_agg(id) FROM (SELECT id FROM public.attendance_logs UNION SELECT id FROM public.pending_card_events) events WHERE id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_event_ids))),'[]'),
    'enrollment_active',coalesce((enrollment->>'active')::boolean,false) AND coalesce((enrollment->>'expires_at')::timestamptz>now(),false));
END $$;


CREATE OR REPLACE FUNCTION public.save_calendar_day(p_semester_id text,p_date date,p_type text,p_note text,p_required_uids jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE term public.semesters; uid text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(73085102);
  SELECT * INTO term FROM public.semesters WHERE id=p_semester_id FOR UPDATE;
  IF term.id IS NULL OR term.status<>'active' THEN RAISE EXCEPTION 'Archived calendars are read-only'; END IF;
  IF p_date<term.start_date OR (term.end_date IS NOT NULL AND p_date>term.end_date) THEN RAISE EXCEPTION 'Date must be inside the semester'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('regular','no_classes','optional') OR length(p_note)>1000 THEN RAISE EXCEPTION 'Invalid calendar day'; END IF;
  IF p_required_uids IS NOT NULL THEN
    IF jsonb_typeof(p_required_uids)<>'array' THEN RAISE EXCEPTION 'Officer list must be an array'; END IF;
    FOR uid IN SELECT jsonb_array_elements_text(p_required_uids) LOOP
      IF NOT EXISTS(SELECT 1 FROM public.officers WHERE card_uid=uid) THEN RAISE EXCEPTION 'Unknown officer: %',uid; END IF;
      IF term.roster_managed AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(term.officer_snapshot) member WHERE member->>'card_uid'=uid AND (coalesce((member->>'serving')::boolean,true) OR p_date<=(member->>'served_until')::date)) THEN RAISE EXCEPTION 'Date assignments must use officers serving in this semester'; END IF;
    END LOOP;
  END IF;
  INSERT INTO public.calendar_days(semester_id,date,type,note,required_uids) VALUES(p_semester_id,p_date,p_type,trim(p_note),p_required_uids)
    ON CONFLICT(semester_id,date) DO UPDATE SET type=excluded.type,note=excluded.note,required_uids=excluded.required_uids,updated_at=now();
END $$;
CREATE OR REPLACE FUNCTION public.import_attendance_csv(p_semester_id text, p_rows jsonb, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  term public.semesters; item jsonb; uid text; officer_name text; day date;
  entered timestamptz; exited timestamptz; in_id uuid; out_id uuid;
  has_in boolean; has_out boolean; prior_type text; prior_time timestamptz;
  saved public.attendance_logs; identity jsonb; metadata jsonb; row_number integer := 0;
  imported integer := 0; skipped integer := 0; created_profiles integer:=0; matches integer; name_key text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'Enter an import reason (3-1000 characters)';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Import between 1 and 500 complete sessions at a time';
  END IF;
  -- Serialize with readers, recovery, and manual corrections; lock term metadata
  -- so dates cannot change while its attendance is being imported.
  PERFORM pg_advisory_xact_lock(73085102);PERFORM pg_advisory_xact_lock(73085103);
  SELECT * INTO term FROM public.semesters WHERE id=p_semester_id FOR SHARE;
  IF term.id IS NULL THEN RAISE EXCEPTION 'Select an existing semester'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    row_number := row_number + 1;
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      OR coalesce(item->>'time_in','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
      OR coalesce(item->>'time_out','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
      OR length(coalesce(item->>'source','')) > 200 OR length(coalesce(item->>'notes','')) > 1000
      OR length(coalesce(item->>'signature','')) > 50 THEN
      RAISE EXCEPTION 'Row %: invalid date, time, or source notes',row_number;
    END IF;
    day := (item->>'date')::date;
    IF day < term.start_date OR (term.end_date IS NOT NULL AND day > term.end_date) THEN
      RAISE EXCEPTION 'Row %: date must be within the selected semester',row_number;
    END IF;
    entered := (day + (item->>'time_in')::time) AT TIME ZONE 'Asia/Manila';
    exited := (day + (item->>'time_out')::time) AT TIME ZONE 'Asia/Manila';
    IF exited <= entered OR exited > now() THEN
      RAISE EXCEPTION 'Row %: use a complete same-day session ending after clock-in and no later than now',row_number;
    END IF;
    uid := item->>'card_uid';
    IF nullif(uid,'') IS NULL AND coalesce((item->>'create_profile')::boolean,false) THEN
      IF coalesce(length(trim(item->>'first_name')),0)=0 OR coalesce(length(trim(item->>'last_name')),0)=0 THEN RAISE EXCEPTION 'Row %: first and last names are required for a new profile',row_number; END IF;
      name_key:=public.officer_name_key(trim(item->>'first_name')||' '||trim(item->>'last_name'));
      IF name_key='' THEN RAISE EXCEPTION 'Row %: choose an existing officer profile explicitly',row_number; END IF;
      SELECT count(*),min(card_uid) INTO matches,uid FROM public.officers WHERE public.officer_name_key(first_name||' '||last_name)=name_key;
      IF matches>1 THEN RAISE EXCEPTION 'Row %: name matches multiple officers; select the intended profile',row_number; END IF;
      IF matches=0 THEN
        uid:=public.save_officer_profile(NULL,NULL,jsonb_build_object('first_name',trim(item->>'first_name'),'last_name',trim(item->>'last_name'),'position',coalesce(nullif(trim(item->>'position'),''),'Officer')),true);
        created_profiles:=created_profiles+1;
      END IF;
    END IF;
    SELECT first_name || ' ' || last_name INTO officer_name FROM public.officers WHERE card_uid=uid;
    IF officer_name IS NULL THEN RAISE EXCEPTION 'Row %: officer is not enrolled',row_number; END IF;
    -- An imported attendee may not belong to the elected council. Preserve their
    -- historical position without enrolling them or consuming a council seat.
    IF term.roster_managed AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(term.officer_snapshot) member WHERE member->>'card_uid'=uid) THEN
      SELECT jsonb_build_object('card_uid',card_uid,'nfc_uid',nfc_uid,'first_name',first_name,'last_name',last_name,'position',position,'photo_id',photo_id,'serving',false,'history_only',true)
        INTO identity FROM public.officers WHERE card_uid=uid;
      term.officer_snapshot:=term.officer_snapshot||jsonb_build_array(identity);
      UPDATE public.semesters SET officer_snapshot=term.officer_snapshot WHERE id=p_semester_id;
    END IF;

    in_id := md5('csv-import:v1:' || uid || ':CLOCK_IN:' || to_char(entered AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS'))::uuid;
    out_id := md5('csv-import:v1:' || uid || ':CLOCK_OUT:' || to_char(exited AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS'))::uuid;
    -- Deterministic IDs retain tombstones and manual changes on later retries.
    IF EXISTS(SELECT 1 FROM public.attendance_logs WHERE id IN (in_id,out_id)
      AND (deleted_at IS NOT NULL OR card_uid<>uid OR (id=in_id AND (type<>'CLOCK_IN' OR timestamp<>entered))
        OR (id=out_id AND (type<>'CLOCK_OUT' OR timestamp<>exited)))) THEN
      RAISE EXCEPTION 'Row %: a previous import was corrected or deleted; review its existing entries',row_number;
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.attendance_logs WHERE deleted_at IS NULL AND card_uid=uid AND type='CLOCK_IN' AND timestamp=entered),
      EXISTS(SELECT 1 FROM public.attendance_logs WHERE deleted_at IS NULL AND card_uid=uid AND type='CLOCK_OUT' AND timestamp=exited)
      INTO has_in,has_out;
    IF has_in AND has_out AND NOT EXISTS(SELECT 1 FROM public.attendance_logs WHERE deleted_at IS NULL AND card_uid=uid AND timestamp>entered AND timestamp<exited) THEN
      skipped := skipped + 1; CONTINUE;
    END IF;
    IF has_in OR has_out OR EXISTS(SELECT 1 FROM public.attendance_logs WHERE deleted_at IS NULL AND card_uid=uid AND timestamp BETWEEN entered AND exited) THEN
      RAISE EXCEPTION 'Row %: overlaps existing attendance; correct the existing entries instead',row_number;
    END IF;
    SELECT type,timestamp INTO prior_type,prior_time FROM public.attendance_logs
      WHERE deleted_at IS NULL AND card_uid=uid AND timestamp<entered
      ORDER BY timestamp DESC,created_at DESC,id DESC LIMIT 1;
    IF prior_type='CLOCK_IN' AND (prior_time AT TIME ZONE 'Asia/Manila')::date=day THEN
      RAISE EXCEPTION 'Row %: overlaps an open visit; review the existing entries',row_number;
    END IF;
    metadata := jsonb_build_object('semester_id',p_semester_id,'row',row_number,
      'source',coalesce(item->>'source',''),'notes',coalesce(item->>'notes',''),'signature',coalesce(item->>'signature',''));
    FOR saved IN INSERT INTO public.attendance_logs(id,card_uid,officer_name,type,timestamp,manually_edited)
      VALUES(in_id,uid,officer_name,'CLOCK_IN',entered,true),(out_id,uid,officer_name,'CLOCK_OUT',exited,true)
      RETURNING * LOOP
      INSERT INTO public.attendance_audit(attendance_log_id,actor_id,actor_email,operation,reason,after_data)
        VALUES(saved.id,auth.uid(),coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email','Administrator'),
          'import',trim(p_reason),to_jsonb(saved)||jsonb_build_object('csv_import',metadata));
    END LOOP;
    imported := imported + 1;
  END LOOP;
  RETURN jsonb_build_object('imported_sessions',imported,'skipped_sessions',skipped,'inserted_events',imported*2,'created_profiles',created_profiles);
END $$;
COMMIT;
