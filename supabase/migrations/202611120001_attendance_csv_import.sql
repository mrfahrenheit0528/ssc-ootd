-- Run after 202611100001_dashboard_refinement.sql. Imports are atomic and audited.
BEGIN;
CREATE FUNCTION public.import_attendance_csv(p_semester_id text, p_rows jsonb, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  term public.semesters; item jsonb; uid text; officer_name text; day date;
  entered timestamptz; exited timestamptz; in_id uuid; out_id uuid;
  has_in boolean; has_out boolean; prior_type text; prior_time timestamptz;
  saved public.attendance_logs; metadata jsonb; row_number integer := 0;
  imported integer := 0; skipped integer := 0;
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
  PERFORM pg_advisory_xact_lock(73085103);
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
    SELECT first_name || ' ' || last_name INTO officer_name FROM public.officers WHERE card_uid=uid;
    IF officer_name IS NULL THEN RAISE EXCEPTION 'Row %: officer is not enrolled',row_number; END IF;
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
  RETURN jsonb_build_object('imported_sessions',imported,'skipped_sessions',skipped,'inserted_events',imported*2);
END $$;
REVOKE ALL ON FUNCTION public.import_attendance_csv(text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_attendance_csv(text,jsonb,text) TO authenticated;
COMMIT;
