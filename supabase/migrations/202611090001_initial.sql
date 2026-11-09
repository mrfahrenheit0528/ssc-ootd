-- Run once in a NEW Supabase project's SQL Editor. No Firebase data is imported.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'officer'))
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_role ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.user_roles TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated;

CREATE FUNCTION public.is_member() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid());
$$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin');
$$;
REVOKE ALL ON FUNCTION public.is_member(), public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_member(), public.is_admin() TO authenticated;

CREATE TABLE public.officer_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 1048576),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.officers (
  card_uid text PRIMARY KEY CHECK (card_uid ~ '^[A-Z0-9]{4,64}$'),
  first_name text NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 100),
  last_name text NOT NULL CHECK (length(trim(last_name)) BETWEEN 1 AND 100),
  position text NOT NULL CHECK (length(trim(position)) BETWEEN 1 AND 150),
  photo_id uuid REFERENCES public.officer_photos(id),
  status text NOT NULL DEFAULT 'OFF_DUTY' CHECK (status IN ('ON_DUTY','OFF_DUTY')),
  status_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.attendance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_uid text NOT NULL REFERENCES public.officers(card_uid),
  officer_name text NOT NULL,
  type text NOT NULL CHECK (type IN ('CLOCK_IN', 'CLOCK_OUT')),
  timestamp timestamptz NOT NULL,
  is_auto_closed boolean NOT NULL DEFAULT false,
  manually_edited boolean NOT NULL DEFAULT false,
  device_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX attendance_by_time ON public.attendance_logs(timestamp, id) WHERE deleted_at IS NULL;
CREATE INDEX attendance_by_officer ON public.attendance_logs(card_uid, timestamp DESC, created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE public.day_config (id text PRIMARY KEY, data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'));
CREATE TABLE public.semesters (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  start_date date NOT NULL,
  end_date date,
  status text NOT NULL CHECK (status IN ('active','ended')),
  officer_snapshot jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (status <> 'active' OR end_date IS NULL)
);
CREATE UNIQUE INDEX one_active_semester ON public.semesters(status) WHERE status = 'active';
CREATE TABLE public.system_settings (id text PRIMARY KEY, data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'));
CREATE TABLE public.reader_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  token_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz
);
ALTER TABLE public.reader_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reader_devices FROM anon, authenticated;

-- Members read attendance; only admins change it. Profiles are deactivated,
-- not deleted, so late offline uploads retain a valid officer reference.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['officer_photos','officers','attendance_logs','day_config','semesters'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY member_read ON public.%I FOR SELECT TO authenticated USING (public.is_member())', t);
    EXECUTE format('CREATE POLICY admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_admin())', t);
    EXECUTE format('CREATE POLICY admin_update ON public.%I FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())', t);
    EXECUTE format('CREATE POLICY admin_delete ON public.%I FOR DELETE TO authenticated USING (public.is_admin())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_settings ON public.system_settings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO authenticated;
REVOKE ALL ON public.system_settings FROM anon;

-- Maintain cloud status from the latest surviving event, including admin edits.
CREATE FUNCTION public.refresh_officer_status(p_uid text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE latest public.attendance_logs;
BEGIN
  PERFORM 1 FROM public.officers WHERE card_uid = p_uid FOR UPDATE;
  SELECT * INTO latest FROM public.attendance_logs WHERE card_uid = p_uid AND deleted_at IS NULL
    ORDER BY timestamp DESC, created_at DESC, id DESC LIMIT 1;
  UPDATE public.officers SET status = CASE WHEN latest.type = 'CLOCK_IN' THEN 'ON_DUTY' ELSE 'OFF_DUTY' END,
    status_at = latest.timestamp WHERE card_uid = p_uid;
END $$;
CREATE FUNCTION public.attendance_status_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM public.refresh_officer_status(OLD.card_uid); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM public.refresh_officer_status(NEW.card_uid); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER attendance_status AFTER INSERT OR UPDATE OR DELETE ON public.attendance_logs
  FOR EACH ROW EXECUTE FUNCTION public.attendance_status_trigger();
REVOKE ALL ON FUNCTION public.refresh_officer_status(text), public.attendance_status_trigger() FROM PUBLIC, anon, authenticated;

-- Photos are immutable so semester snapshots keep their original image.
CREATE FUNCTION public.upload_officer_photo(p_base64 text, p_mime_type text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE bytes bytea; photo uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE = '42501'; END IF;
  IF length(p_base64) > 1400000 OR p_mime_type NOT IN ('image/jpeg','image/png') THEN RAISE EXCEPTION 'Invalid photo'; END IF;
  bytes := decode(p_base64, 'base64');
  IF (p_mime_type = 'image/jpeg' AND substring(bytes FROM 1 FOR 3) <> decode('ffd8ff','hex'))
     OR (p_mime_type = 'image/png' AND substring(bytes FROM 1 FOR 8) <> decode('89504e470d0a1a0a','hex')) THEN
    RAISE EXCEPTION 'Photo must be a JPEG or PNG';
  END IF;
  INSERT INTO public.officer_photos(content,mime_type) VALUES (bytes,p_mime_type) RETURNING id INTO photo;
  RETURN photo;
END $$;
REVOKE ALL ON FUNCTION public.upload_officer_photo(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upload_officer_photo(text,text) TO authenticated;
-- Updating/deleting referenced photos would break archived rosters.
REVOKE INSERT, UPDATE, DELETE ON public.officer_photos FROM authenticated;

CREATE FUNCTION public.roster_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('card_uid',card_uid,'first_name',first_name,
    'last_name',last_name,'position',position,'photo_id',photo_id)), '[]'::jsonb) FROM public.officers WHERE active;
$$;
CREATE FUNCTION public.archive_semester(p_id text, p_end_date date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(73085102);
  UPDATE public.semesters SET status='ended',end_date=p_end_date,ended_at=now(),officer_snapshot=public.roster_snapshot()
    WHERE id=p_id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active semester not found'; END IF;
END $$;
CREATE FUNCTION public.activate_semester(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(73085102);
  IF NOT EXISTS(SELECT 1 FROM public.semesters WHERE id=p_id) THEN RAISE EXCEPTION 'Semester not found'; END IF;
  UPDATE public.semesters SET status='ended',end_date=greatest(start_date,(now() AT TIME ZONE 'Asia/Manila')::date),
    ended_at=now(),officer_snapshot=public.roster_snapshot() WHERE status='active' AND id<>p_id;
  UPDATE public.semesters SET status='active',end_date=NULL WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.roster_snapshot(), public.archive_semester(text,date), public.activate_semester(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_semester(text,date), public.activate_semester(text) TO authenticated;

-- Reader credentials only authorize these narrowly scoped RPCs. The SSC PC
-- never receives a database password or a Supabase service-role key.
CREATE FUNCTION public.verify_reader(p_device_id uuid, p_token text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.reader_devices WHERE id=p_device_id AND enabled
    AND token_hash=encode(extensions.digest(p_token,'sha256'),'hex')) THEN
    RAISE EXCEPTION 'Invalid reader credentials' USING ERRCODE = '42501';
  END IF;
  UPDATE public.reader_devices SET last_seen_at=now() WHERE id=p_device_id;
END $$;
CREATE FUNCTION public.reader_context(p_device_id uuid, p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE enrollment jsonb;
BEGIN
  PERFORM public.verify_reader(p_device_id,p_token);
  SELECT data INTO enrollment FROM public.system_settings WHERE id='enrollment_mode';
  RETURN jsonb_build_object('officers',coalesce((SELECT jsonb_agg(jsonb_build_object('card_uid',card_uid,
    'first_name',first_name,'last_name',last_name)) FROM public.officers WHERE active),'[]'::jsonb),
    'enrollment_active', coalesce((enrollment->>'active')::boolean,false)
      AND coalesce((enrollment->>'expires_at')::timestamptz > now(),false));
END $$;
CREATE FUNCTION public.reader_tap(p_device_id uuid, p_token text, p_uid text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE enrollment jsonb;
BEGIN
  PERFORM public.verify_reader(p_device_id,p_token);
  IF p_uid !~ '^[A-Z0-9]{4,64}$' THEN RAISE EXCEPTION 'Invalid card UID'; END IF;
  SELECT data INTO enrollment FROM public.system_settings WHERE id='enrollment_mode';
  IF coalesce((enrollment->>'active')::boolean,false) AND coalesce((enrollment->>'expires_at')::timestamptz>now(),false) THEN
    INSERT INTO public.system_settings(id,data) VALUES ('live_scanner',jsonb_build_object('latest_uid',p_uid,'timestamp',now()))
      ON CONFLICT(id) DO UPDATE SET data=excluded.data;
    RETURN true;
  END IF;
  RETURN false;
END $$;
CREATE FUNCTION public.ingest_attendance(p_device_id uuid, p_token text, p_events jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item jsonb; uid text; name text; accepted integer := 0;
BEGIN
  PERFORM public.verify_reader(p_device_id,p_token);
  IF jsonb_typeof(p_events)<>'array' OR jsonb_array_length(p_events)>100 THEN RAISE EXCEPTION 'Send at most 100 events'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    uid := item->>'card_uid';
    SELECT first_name||' '||last_name INTO name FROM public.officers WHERE card_uid=uid;
    IF name IS NULL THEN RAISE EXCEPTION 'Officer not enrolled: %',uid; END IF;
    INSERT INTO public.attendance_logs(id,card_uid,officer_name,type,timestamp,is_auto_closed,device_id)
      VALUES ((item->>'event_id')::uuid,uid,name,item->>'action_type',(item->>'timestamp')::timestamptz,
        coalesce((item->>'is_auto_closed')::boolean,false),p_device_id)
      ON CONFLICT(id) DO NOTHING;
    -- A duplicate is acknowledged without overwriting a manual correction or tombstone.
    IF NOT EXISTS(SELECT 1 FROM public.attendance_logs WHERE id=(item->>'event_id')::uuid AND device_id=p_device_id) THEN
      RAISE EXCEPTION 'Event ID belongs to another source';
    END IF;
    accepted := accepted+1;
  END LOOP;
  RETURN accepted;
END $$;
REVOKE ALL ON FUNCTION public.verify_reader(uuid,text), public.reader_context(uuid,text),
  public.reader_tap(uuid,text,text), public.ingest_attendance(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reader_context(uuid,text), public.reader_tap(uuid,text,text),
  public.ingest_attendance(uuid,text,jsonb) TO anon, authenticated;

-- Cloud updates reach browsers without relying on the reader PC.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['officers','attendance_logs','semesters','system_settings','user_roles'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
    END IF;
  END LOOP;
END $$;
COMMIT;
