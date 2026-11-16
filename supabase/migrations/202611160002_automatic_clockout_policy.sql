-- Apply once after 202611160001_live_kiosk_photos.sql. No reader reinstall.
-- New clock-ins only: <=5 PM waits until 9 PM and records 5 PM; >5 PM
-- closes one hour after clock-in. Real clock-outs and earlier history stay intact.
BEGIN;
INSERT INTO public.system_settings(id,data)
VALUES('automatic_clockout_policy',jsonb_build_object('effective_from',now()))
ON CONFLICT(id) DO NOTHING;

ALTER TABLE public.attendance_logs ADD COLUMN auto_close_source_id uuid, ADD COLUMN auto_close_source_at timestamptz, ADD COLUMN automatic_clockout_due_at timestamptz;
ALTER TABLE public.pending_card_events ADD COLUMN auto_close_source_id uuid, ADD COLUMN auto_close_source_at timestamptz, ADD COLUMN automatic_clockout_due_at timestamptz;

-- A legacy reader can submit its 9 PM closure before a late visit's hour is up.
-- Acknowledge that UUID without fabricating a future attendance event. Recovery
-- creates the canonical closure when due; the old queue cannot reintroduce it.
CREATE TABLE public.automatic_clockout_receipts (
  id uuid PRIMARY KEY, card_uid text NOT NULL, device_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.automatic_clockout_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automatic_clockout_receipts FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.automatic_clockout_times(p_clock_in timestamptz)
RETURNS TABLE(due_at timestamptz,close_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN p_clock_in >= (SELECT (data->>'effective_from')::timestamptz FROM public.system_settings WHERE id='automatic_clockout_policy')
      AND (p_clock_in AT TIME ZONE 'Asia/Manila')::time>time '17:00'
    THEN p_clock_in+interval '1 hour'
    ELSE greatest((((p_clock_in AT TIME ZONE 'Asia/Manila')::date)+time '21:00') AT TIME ZONE 'Asia/Manila',p_clock_in+interval '1 microsecond') END,
    CASE WHEN p_clock_in >= (SELECT (data->>'effective_from')::timestamptz FROM public.system_settings WHERE id='automatic_clockout_policy')
      THEN CASE WHEN (p_clock_in AT TIME ZONE 'Asia/Manila')::time>time '17:00' THEN p_clock_in+interval '1 hour'
        ELSE greatest((((p_clock_in AT TIME ZONE 'Asia/Manila')::date)+time '17:00') AT TIME ZONE 'Asia/Manila',p_clock_in+interval '1 microsecond') END
      ELSE greatest((((p_clock_in AT TIME ZONE 'Asia/Manila')::date)+time '21:00') AT TIME ZONE 'Asia/Manila',p_clock_in+interval '1 microsecond') END;
$$;
REVOKE ALL ON FUNCTION public.automatic_clockout_times(timestamptz) FROM PUBLIC,anon,authenticated;

-- Retain a source link for overnight hours and pending-card promotion.
CREATE FUNCTION public.automatic_clockout_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source_id uuid; source_at timestamptz;
BEGIN
  NEW.auto_close_source_id:=NULL; NEW.auto_close_source_at:=NULL;
  NEW.automatic_clockout_due_at:=NULL;
  IF NEW.type='CLOCK_IN' AND NEW.timestamp >= (SELECT (data->>'effective_from')::timestamptz FROM public.system_settings WHERE id='automatic_clockout_policy') THEN
    SELECT due_at INTO NEW.automatic_clockout_due_at FROM public.automatic_clockout_times(NEW.timestamp);
  END IF;
  IF NOT NEW.is_auto_closed OR NEW.type<>'CLOCK_OUT' THEN RETURN NEW; END IF;
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
CREATE TRIGGER automatic_clockout_source BEFORE INSERT OR UPDATE ON public.attendance_logs
FOR EACH ROW EXECUTE FUNCTION public.automatic_clockout_source();
CREATE TRIGGER automatic_clockout_source BEFORE INSERT OR UPDATE ON public.pending_card_events
FOR EACH ROW EXECUTE FUNCTION public.automatic_clockout_source();
REVOKE ALL ON FUNCTION public.automatic_clockout_source() FROM PUBLIC,anon,authenticated;

-- A delayed real clock-out supersedes the estimate, including offline uploads.
CREATE FUNCTION public.reconcile_automatic_clockouts() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE automatic record; next_type text; revised public.attendance_logs;
BEGIN
  FOR automatic IN SELECT * FROM public.attendance_logs WHERE auto_close_source_id IS NOT NULL AND deleted_at IS NULL AND NOT manually_edited LOOP
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
  FOR automatic IN SELECT * FROM public.pending_card_events WHERE auto_close_source_id IS NOT NULL AND linked_officer_key IS NULL LOOP
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

CREATE OR REPLACE FUNCTION public.recover_due_attendance_internal() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source record; timing record; next_type text; affected integer; accepted integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(73085103);
  PERFORM public.reconcile_automatic_clockouts();
  FOR source IN
    SELECT DISTINCT ON(card_uid,(timestamp AT TIME ZONE 'Asia/Manila')::date) * FROM public.attendance_logs
      WHERE deleted_at IS NULL AND NOT is_auto_closed AND timestamp<=now()
      ORDER BY card_uid,(timestamp AT TIME ZONE 'Asia/Manila')::date,timestamp DESC,created_at DESC,id DESC
  LOOP
    SELECT * INTO timing FROM public.automatic_clockout_times(source.timestamp);
    IF source.type<>'CLOCK_IN' OR timing.due_at>now() THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM public.attendance_logs WHERE id=md5(source.id::text||':auto-close')::uuid) THEN CONTINUE; END IF;
    SELECT e.type INTO next_type FROM public.attendance_logs e
      WHERE e.card_uid=source.card_uid AND NOT e.is_auto_closed AND e.deleted_at IS NULL AND e.timestamp>source.timestamp AND e.timestamp<=now()
        AND e.timestamp<greatest(((source.timestamp AT TIME ZONE 'Asia/Manila')::date+1)::timestamp AT TIME ZONE 'Asia/Manila',timing.due_at+interval '1 microsecond')
      ORDER BY e.timestamp,e.created_at,e.id LIMIT 1;
    IF next_type='CLOCK_OUT' THEN CONTINUE; END IF;
    INSERT INTO public.attendance_logs(id,card_uid,officer_name,type,timestamp,is_auto_closed,device_id)
      VALUES(md5(source.id::text||':auto-close')::uuid,source.card_uid,source.officer_name,'CLOCK_OUT',timing.close_at,true,source.device_id) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS affected=ROW_COUNT; accepted:=accepted+affected;
  END LOOP;
  FOR source IN SELECT DISTINCT ON(card_uid,(timestamp AT TIME ZONE 'Asia/Manila')::date) * FROM public.pending_card_events
    WHERE linked_officer_key IS NULL AND NOT is_auto_closed AND timestamp<=now()
    ORDER BY card_uid,(timestamp AT TIME ZONE 'Asia/Manila')::date,timestamp DESC,created_at DESC,id DESC
  LOOP
    SELECT * INTO timing FROM public.automatic_clockout_times(source.timestamp);
    IF source.type<>'CLOCK_IN' OR timing.due_at>now() THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM public.pending_card_events WHERE id=md5(source.id::text||':auto-close')::uuid) THEN CONTINUE; END IF;
    SELECT e.type INTO next_type FROM public.pending_card_events e
      WHERE e.card_uid=source.card_uid AND NOT e.is_auto_closed AND e.linked_officer_key IS NULL AND e.timestamp>source.timestamp AND e.timestamp<=now()
        AND e.timestamp<greatest(((source.timestamp AT TIME ZONE 'Asia/Manila')::date+1)::timestamp AT TIME ZONE 'Asia/Manila',timing.due_at+interval '1 microsecond')
      ORDER BY e.timestamp,e.created_at,e.id LIMIT 1;
    IF next_type='CLOCK_OUT' THEN CONTINUE; END IF;
    INSERT INTO public.pending_card_events(id,card_uid,type,timestamp,is_auto_closed,device_id)
      VALUES(md5(source.id::text||':auto-close')::uuid,source.card_uid,'CLOCK_OUT',timing.close_at,true,source.device_id) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS affected=ROW_COUNT; accepted:=accepted+affected;
  END LOOP;
  RETURN accepted;
END $$;
REVOKE ALL ON FUNCTION public.recover_due_attendance_internal() FROM PUBLIC,anon,authenticated;

-- Keep the already-tested card ownership/retry/council validation as a private
-- implementation; the public endpoint normalizes old-reader automatic events.
ALTER FUNCTION public.ingest_attendance(uuid,text,jsonb) RENAME TO ingest_attendance_before_clockout_policy;
REVOKE ALL ON FUNCTION public.ingest_attendance_before_clockout_policy(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.ingest_attendance(p_device_id uuid,p_token text,p_events jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; source_id uuid; source_at timestamptz; timing record; event uuid; nfc text; accepted integer:=0;
BEGIN
  PERFORM public.verify_reader(p_device_id,p_token);
  IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' OR jsonb_array_length(p_events)>100 THEN RAISE EXCEPTION 'Send at most 100 events'; END IF;
  PERFORM pg_advisory_xact_lock(73085103);
  FOR item IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    IF coalesce((item->>'is_auto_closed')::boolean,false) AND item->>'action_type'='CLOCK_OUT' THEN
      event:=(item->>'event_id')::uuid; nfc:=item->>'card_uid';
      IF event IS NULL OR nfc IS NULL OR nfc !~ '^[A-Z0-9]{4,64}$' OR (item->>'timestamp')::timestamptz IS NULL THEN RAISE EXCEPTION 'Invalid attendance event'; END IF;
      IF EXISTS(SELECT 1 FROM public.attendance_logs WHERE id=event) OR EXISTS(SELECT 1 FROM public.pending_card_events WHERE id=event) THEN
        PERFORM public.ingest_attendance_before_clockout_policy(p_device_id,p_token,jsonb_build_array(item));
        accepted:=accepted+1; CONTINUE;
      END IF;
      SELECT s.id,s.timestamp INTO source_id,source_at FROM public.attendance_logs s JOIN public.officers o ON o.card_uid=s.card_uid
        WHERE o.nfc_uid=nfc AND s.type='CLOCK_IN' AND md5(s.id::text||':auto-close')::uuid=event
      UNION ALL SELECT s.id,s.timestamp FROM public.pending_card_events s
        WHERE s.card_uid=nfc AND s.type='CLOCK_IN' AND md5(s.id::text||':auto-close')::uuid=event LIMIT 1;
      IF source_at >= (SELECT (data->>'effective_from')::timestamptz FROM public.system_settings WHERE id='automatic_clockout_policy') THEN
        IF EXISTS(SELECT 1 FROM public.automatic_clockout_receipts r WHERE r.id=event AND r.card_uid<>nfc) THEN RAISE EXCEPTION 'Event ID belongs to another source'; END IF;
        SELECT * INTO timing FROM public.automatic_clockout_times(source_at);
        INSERT INTO public.automatic_clockout_receipts(id,card_uid,device_id) VALUES(event,nfc,p_device_id) ON CONFLICT DO NOTHING;
        IF timing.due_at>now() THEN accepted:=accepted+1; CONTINUE; END IF;
        item:=jsonb_set(item,'{timestamp}',to_jsonb(timing.close_at));
      END IF;
    END IF;
    PERFORM public.ingest_attendance_before_clockout_policy(p_device_id,p_token,jsonb_build_array(item));
    accepted:=accepted+1;
  END LOOP;
  PERFORM public.reconcile_automatic_clockouts();
  RETURN accepted;
END $$;
REVOKE ALL ON FUNCTION public.ingest_attendance(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_attendance(uuid,text,jsonb) TO anon,authenticated;

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
        WHERE o.nfc_uid IS NOT NULL AND a.timestamp<=now() AND (a.timestamp AT TIME ZONE 'Asia/Manila')::date=(now() AT TIME ZONE 'Asia/Manila')::date
      UNION ALL SELECT to_jsonb(p) FROM public.pending_card_events p WHERE p.linked_officer_key IS NULL AND p.timestamp<=now() AND (p.timestamp AT TIME ZONE 'Asia/Manila')::date=(now() AT TIME ZONE 'Asia/Manila')::date
    ) events),'[]'),
    'known_event_ids',coalesce((SELECT jsonb_agg(id) FROM (SELECT id FROM public.attendance_logs UNION SELECT id FROM public.pending_card_events UNION SELECT id FROM public.automatic_clockout_receipts) events WHERE id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_event_ids))),'[]'),
    'enrollment_active',coalesce((enrollment->>'active')::boolean,false) AND coalesce((enrollment->>'expires_at')::timestamptz>now(),false));
END $$;
REVOKE ALL ON FUNCTION public.reader_context(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reader_context(uuid,text,jsonb) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.live_kiosk_context() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE today date:=(now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  IF NOT public.is_member() THEN RAISE EXCEPTION 'Approved account required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('date',today,'events',coalesce((
    SELECT jsonb_agg(to_jsonb(event) ORDER BY event.timestamp DESC,event.created_at DESC,event.id) FROM (
      SELECT a.id,a.card_uid,o.nfc_uid,a.officer_name,a.type,a.timestamp,a.is_auto_closed,a.created_at,false AS is_unlinked,o.photo_id,a.auto_close_source_id,a.auto_close_source_at,a.automatic_clockout_due_at
      FROM public.attendance_logs a LEFT JOIN public.officers o ON o.card_uid=a.card_uid
      WHERE a.deleted_at IS NULL AND a.timestamp<=now() AND (coalesce(a.auto_close_source_at,a.timestamp) AT TIME ZONE 'Asia/Manila')::date=today
      UNION ALL
      SELECT p.id,'unlinked:'||p.card_uid,p.card_uid,NULL::text,p.type,p.timestamp,p.is_auto_closed,p.created_at,true,NULL::uuid,p.auto_close_source_id,p.auto_close_source_at,p.automatic_clockout_due_at
      FROM public.pending_card_events p WHERE p.linked_officer_key IS NULL AND p.timestamp<=now() AND (coalesce(p.auto_close_source_at,p.timestamp) AT TIME ZONE 'Asia/Manila')::date=today
    ) event),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.live_kiosk_context() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.live_kiosk_context() TO authenticated;
COMMIT;
