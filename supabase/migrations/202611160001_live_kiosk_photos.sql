-- Apply after 202611150002_semester_councils.sql. Keeps existing data and roles.
-- Photo bytes are fetched separately and cached, not repeated in each live poll.
BEGIN;
CREATE OR REPLACE FUNCTION public.live_kiosk_context() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE today date:=(now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  IF NOT public.is_member() THEN RAISE EXCEPTION 'Approved account required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('date',today,'events',coalesce((
    SELECT jsonb_agg(to_jsonb(event) ORDER BY event.timestamp DESC,event.created_at DESC,event.id)
    FROM (
      SELECT a.id,a.card_uid,o.nfc_uid,a.officer_name,a.type,a.timestamp,a.is_auto_closed,a.created_at,false AS is_unlinked,o.photo_id
      FROM public.attendance_logs a LEFT JOIN public.officers o ON o.card_uid=a.card_uid
      WHERE a.deleted_at IS NULL AND a.timestamp<=now() AND (a.timestamp AT TIME ZONE 'Asia/Manila')::date=today
      UNION ALL
      SELECT p.id,'unlinked:'||p.card_uid,p.card_uid,NULL::text,p.type,p.timestamp,p.is_auto_closed,p.created_at,true,NULL::uuid
      FROM public.pending_card_events p
      WHERE p.linked_officer_key IS NULL AND p.timestamp<=now() AND (p.timestamp AT TIME ZONE 'Asia/Manila')::date=today
    ) event
  ),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.live_kiosk_context() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.live_kiosk_context() TO authenticated;

CREATE OR REPLACE FUNCTION public.live_kiosk_photos(p_photo_ids uuid[])
RETURNS TABLE(id uuid, data_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.is_member() THEN RAISE EXCEPTION 'Approved account required' USING ERRCODE='42501'; END IF;
  IF coalesce(cardinality(p_photo_ids),0)>100 THEN RAISE EXCEPTION 'Request at most 100 photos'; END IF;
  RETURN QUERY
  SELECT photo.id,'data:'||photo.mime_type||';base64,'||replace(encode(photo.content,'base64'),E'\n','')
  FROM public.officer_photos photo
  WHERE photo.id=ANY(p_photo_ids) AND EXISTS (
    SELECT 1 FROM public.officers officer
    JOIN public.attendance_logs attendance ON attendance.card_uid=officer.card_uid
    WHERE officer.photo_id=photo.id AND attendance.deleted_at IS NULL
      AND attendance.timestamp<=now()
      AND (attendance.timestamp AT TIME ZONE 'Asia/Manila')::date=(now() AT TIME ZONE 'Asia/Manila')::date
  );
END $$;
REVOKE ALL ON FUNCTION public.live_kiosk_photos(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.live_kiosk_photos(uuid[]) TO authenticated;
COMMIT;
