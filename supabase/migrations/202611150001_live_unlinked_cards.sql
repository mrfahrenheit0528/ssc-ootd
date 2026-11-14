-- Apply after 202611140001_schedule_history.sql. Run the whole file once.
-- Expose today's live board to approved members without granting access to
-- the admin-only pending-card archive or its device/linking metadata.
BEGIN;
CREATE FUNCTION public.live_kiosk_context() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE today date:=(now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  IF NOT public.is_member() THEN RAISE EXCEPTION 'Approved account required' USING ERRCODE='42501'; END IF;
  -- One statement gives a consistent snapshot during card linking: promotion
  -- and the pending receipt update commit together, so a scan appears once.
  RETURN jsonb_build_object('date',today,'events',coalesce((
    SELECT jsonb_agg(to_jsonb(event) ORDER BY event.timestamp DESC,event.created_at DESC,event.id)
    FROM (
      SELECT a.id,a.card_uid,o.nfc_uid,a.officer_name,a.type,a.timestamp,a.is_auto_closed,a.created_at,false AS is_unlinked
      FROM public.attendance_logs a LEFT JOIN public.officers o ON o.card_uid=a.card_uid
      WHERE a.deleted_at IS NULL AND a.timestamp<=now() AND (a.timestamp AT TIME ZONE 'Asia/Manila')::date=today
      UNION ALL
      SELECT p.id,'unlinked:'||p.card_uid,p.card_uid,NULL::text,p.type,p.timestamp,p.is_auto_closed,p.created_at,true
      FROM public.pending_card_events p
      WHERE p.linked_officer_key IS NULL AND p.timestamp<=now() AND (p.timestamp AT TIME ZONE 'Asia/Manila')::date=today
    ) event
  ),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.live_kiosk_context() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.live_kiosk_context() TO authenticated;
COMMIT;
