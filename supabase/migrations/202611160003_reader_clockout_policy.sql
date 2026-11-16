-- Apply once AFTER 202611160002_automatic_clockout_policy.sql.
-- Expose only the versioned clock-out setting to authenticated reader devices.
-- Existing accounts, attendance, activation time and reader identity stay intact.
BEGIN;
ALTER FUNCTION public.reader_context(uuid,text,jsonb) RENAME TO reader_context_before_policy_cache;
REVOKE ALL ON FUNCTION public.reader_context_before_policy_cache(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.reader_context(p_device_id uuid,p_token text,p_event_ids jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; policy jsonb;
BEGIN
  context:=public.reader_context_before_policy_cache(p_device_id,p_token,p_event_ids);
  SELECT jsonb_build_object('version',1,'effective_from',data->>'effective_from') INTO policy
    FROM public.system_settings WHERE id='automatic_clockout_policy';
  RETURN context||jsonb_build_object('automatic_clockout_policy',policy);
END $$;
REVOKE ALL ON FUNCTION public.reader_context(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reader_context(uuid,text,jsonb) TO anon,authenticated;

-- The updated reader can accept a real clock-out during a late hour crossing
-- midnight. Attribute that event to its source visit in existing reports.
CREATE OR REPLACE FUNCTION public.automatic_clockout_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source_id uuid; source_at timestamptz; previous record; deadline timestamptz;
BEGIN
  NEW.auto_close_source_id:=NULL; NEW.auto_close_source_at:=NULL; NEW.automatic_clockout_due_at:=NULL;
  IF NEW.type='CLOCK_IN' AND NEW.timestamp >= (SELECT (data->>'effective_from')::timestamptz FROM public.system_settings WHERE id='automatic_clockout_policy') THEN
    SELECT due_at INTO NEW.automatic_clockout_due_at FROM public.automatic_clockout_times(NEW.timestamp);
  END IF;
  IF NEW.type<>'CLOCK_OUT' THEN RETURN NEW; END IF;
  IF NOT NEW.is_auto_closed THEN
    IF TG_TABLE_NAME='attendance_logs' THEN
      SELECT e.id,e.timestamp,e.type INTO previous FROM public.attendance_logs e
      WHERE e.card_uid=NEW.card_uid AND e.id<>NEW.id AND e.deleted_at IS NULL AND NOT e.is_auto_closed AND e.timestamp<=NEW.timestamp
      ORDER BY e.timestamp DESC,e.created_at DESC,e.id DESC LIMIT 1;
    ELSE
      SELECT e.id,e.timestamp,e.type INTO previous FROM public.pending_card_events e
      WHERE e.card_uid=NEW.card_uid AND e.id<>NEW.id AND NOT e.is_auto_closed AND e.timestamp<=NEW.timestamp
      ORDER BY e.timestamp DESC,e.created_at DESC,e.id DESC LIMIT 1;
    END IF;
    IF previous.type='CLOCK_IN' AND (previous.timestamp AT TIME ZONE 'Asia/Manila')::date<(NEW.timestamp AT TIME ZONE 'Asia/Manila')::date
      AND previous.timestamp >= (SELECT (data->>'effective_from')::timestamptz FROM public.system_settings WHERE id='automatic_clockout_policy') THEN
      SELECT due_at INTO deadline FROM public.automatic_clockout_times(previous.timestamp);
      IF NEW.timestamp<=deadline THEN NEW.auto_close_source_id:=previous.id; NEW.auto_close_source_at:=previous.timestamp; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='attendance_logs' THEN
    IF NEW.manually_edited THEN RETURN NEW; END IF;
    SELECT s.id,s.timestamp INTO source_id,source_at FROM public.attendance_logs s
      WHERE s.card_uid=NEW.card_uid AND s.type='CLOCK_IN' AND md5(s.id::text||':auto-close')::uuid=NEW.id;
    IF source_id IS NULL THEN
      SELECT p.auto_close_source_id,p.auto_close_source_at INTO source_id,source_at FROM public.pending_card_events p WHERE p.id=NEW.id;
    END IF;
  ELSE
    SELECT s.id,s.timestamp INTO source_id,source_at FROM public.pending_card_events s
      WHERE s.card_uid=NEW.card_uid AND s.type='CLOCK_IN' AND md5(s.id::text||':auto-close')::uuid=NEW.id;
  END IF;
  IF source_at >= (SELECT (data->>'effective_from')::timestamptz FROM public.system_settings WHERE id='automatic_clockout_policy') THEN
    NEW.auto_close_source_id:=source_id; NEW.auto_close_source_at:=source_at;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.automatic_clockout_source() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_automatic_clockouts() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE automatic record; next_type text; revised public.attendance_logs;
BEGIN
  FOR automatic IN SELECT * FROM public.attendance_logs WHERE is_auto_closed AND auto_close_source_id IS NOT NULL AND deleted_at IS NULL AND NOT manually_edited LOOP
    SELECT e.type INTO next_type FROM public.attendance_logs e
      WHERE e.card_uid=automatic.card_uid AND NOT e.is_auto_closed AND e.deleted_at IS NULL AND e.timestamp>automatic.auto_close_source_at AND e.timestamp<=now()
        AND e.timestamp<greatest(((automatic.auto_close_source_at AT TIME ZONE 'Asia/Manila')::date+1)::timestamp AT TIME ZONE 'Asia/Manila',automatic.timestamp+interval '1 microsecond')
      ORDER BY e.timestamp,e.created_at,e.id LIMIT 1;
    IF next_type='CLOCK_OUT' THEN
      UPDATE public.attendance_logs SET deleted_at=now() WHERE id=automatic.id RETURNING * INTO revised;
      INSERT INTO public.attendance_audit(attendance_log_id,operation,reason,before_data,after_data)
      VALUES(automatic.id,'auto_close_superseded','Actual clock-out received; automatic estimate superseded',to_jsonb(automatic),to_jsonb(revised));
    END IF;
  END LOOP;
  FOR automatic IN SELECT * FROM public.pending_card_events WHERE is_auto_closed AND auto_close_source_id IS NOT NULL AND linked_officer_key IS NULL LOOP
    SELECT e.type INTO next_type FROM public.pending_card_events e
      WHERE e.card_uid=automatic.card_uid AND NOT e.is_auto_closed AND e.linked_officer_key IS NULL AND e.timestamp>automatic.auto_close_source_at AND e.timestamp<=now()
        AND e.timestamp<greatest(((automatic.auto_close_source_at AT TIME ZONE 'Asia/Manila')::date+1)::timestamp AT TIME ZONE 'Asia/Manila',automatic.timestamp+interval '1 microsecond')
      ORDER BY e.timestamp,e.created_at,e.id LIMIT 1;
    IF next_type='CLOCK_OUT' THEN
      INSERT INTO public.automatic_clockout_receipts(id,card_uid,device_id) VALUES(automatic.id,automatic.card_uid,automatic.device_id) ON CONFLICT DO NOTHING;
      DELETE FROM public.pending_card_events WHERE id=automatic.id;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_automatic_clockouts() FROM PUBLIC,anon,authenticated;
COMMIT;
