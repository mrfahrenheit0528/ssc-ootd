-- Apply after the three earlier migrations. Run the whole file once.
-- Installation does not reclassify historical attendance. An admin explicitly
-- chooses Whole semester when saving weekly assignments to include past dates.
BEGIN;
ALTER TABLE public.semester_schedules ADD COLUMN application_scope text NOT NULL DEFAULT 'today_onward'
  CHECK(application_scope IN ('today_onward','whole_semester'));
ALTER TABLE public.calendar_days ADD COLUMN inherited_unassigned boolean NOT NULL DEFAULT false;

-- The scheduling upgrade generated [] for days before the legacy effective
-- date. Distinguish those untouched placeholders from deliberate empty custom
-- lists. All inserts in that original transaction share the same now() value.
UPDATE public.calendar_days d SET inherited_unassigned=true
FROM public.semester_schedules v
WHERE v.semester_id=d.semester_id AND v.revision=1 AND v.created_by IS NULL
  AND d.updated_at=v.created_at AND d.required_uids='[]'::jsonb
  AND NOT EXISTS(SELECT 1 FROM public.day_config legacy WHERE legacy.id=d.date::text);

CREATE FUNCTION public.clear_inherited_calendar_assignment() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.inherited_unassigned:=false;
  RETURN NEW;
END $$;
CREATE TRIGGER calendar_assignment_is_explicit BEFORE UPDATE OF type,note,required_uids ON public.calendar_days
FOR EACH ROW EXECUTE FUNCTION public.clear_inherited_calendar_assignment();
REVOKE ALL ON FUNCTION public.clear_inherited_calendar_assignment() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_semester_schedule_scoped(p_semester_id text,p_schedule jsonb,p_scope text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE new_id uuid; term public.semesters;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin account required' USING ERRCODE='42501'; END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('today_onward','whole_semester') THEN RAISE EXCEPTION 'Choose Today onward or Whole semester'; END IF;
  -- Reuse all schedule/officer validation and the semester row lock. The legacy
  -- two-argument RPC retains its original history-preserving behavior.
  new_id:=public.save_semester_schedule(p_semester_id,p_schedule);
  SELECT * INTO term FROM public.semesters WHERE id=p_semester_id;
  UPDATE public.semester_schedules SET application_scope=p_scope WHERE id=new_id;
  IF p_scope='whole_semester' THEN
    UPDATE public.calendar_days SET schedule_version_id=new_id,
      required_uids=CASE WHEN inherited_unassigned THEN NULL ELSE required_uids END,
      inherited_unassigned=false
    WHERE semester_id=p_semester_id AND date>=term.start_date
      AND (term.end_date IS NULL OR date<=term.end_date);
  END IF;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.save_semester_schedule_scoped(text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_semester_schedule_scoped(text,jsonb,text) TO authenticated;
COMMIT;
