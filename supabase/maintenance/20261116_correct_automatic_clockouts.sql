-- ONE-TIME DATA CORRECTION, not a schema migration.
-- Run this entire file in a NEW Supabase SQL Editor query.
-- Only November 16, 2026's untouched, source-verified automatic 9 PM
-- clock-outs are eligible. Actual clock-outs, admin edits, deleted rows,
-- other dates, and the policy activation setting are preserved.
BEGIN;
SELECT pg_advisory_xact_lock(73085103);
CREATE SCHEMA IF NOT EXISTS attendance_maintenance;
REVOKE ALL ON SCHEMA attendance_maintenance FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS attendance_maintenance.clockout_corrections (
  correction_key text NOT NULL, source_table text NOT NULL, event_id uuid NOT NULL,
  before_data jsonb NOT NULL, after_data jsonb, corrected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(correction_key,source_table,event_id)
);
REVOKE ALL ON attendance_maintenance.clockout_corrections FROM PUBLIC,anon,authenticated;

CREATE TEMP TABLE clockout_correction_candidates ON COMMIT DROP AS
WITH settings AS (SELECT date '2026-11-16' AS duty_date), candidates AS (
  SELECT 'attendance_logs'::text AS source_table,a.id,a.card_uid,a.officer_name,
    s.timestamp AS clock_in,a.timestamp AS old_clock_out,to_jsonb(a) AS before_data,
    CASE WHEN (s.timestamp AT TIME ZONE 'Asia/Manila')::time>time '17:00' THEN s.timestamp+interval '1 hour'
      ELSE greatest((settings.duty_date+time '17:00') AT TIME ZONE 'Asia/Manila',s.timestamp+interval '1 microsecond') END AS new_clock_out
  FROM public.attendance_logs a JOIN public.attendance_logs s ON s.card_uid=a.card_uid AND md5(s.id::text||':auto-close')::uuid=a.id
  CROSS JOIN settings
  WHERE a.type='CLOCK_OUT' AND a.is_auto_closed AND NOT a.manually_edited AND a.deleted_at IS NULL
    AND s.type='CLOCK_IN' AND NOT s.is_auto_closed AND s.deleted_at IS NULL
    AND (s.timestamp AT TIME ZONE 'Asia/Manila')::date=settings.duty_date
    AND a.timestamp=(settings.duty_date+time '21:00') AT TIME ZONE 'Asia/Manila'
  UNION ALL
  SELECT 'pending_card_events',a.id,a.card_uid,'Unlinked card',s.timestamp,a.timestamp,to_jsonb(a),
    CASE WHEN (s.timestamp AT TIME ZONE 'Asia/Manila')::time>time '17:00' THEN s.timestamp+interval '1 hour'
      ELSE greatest((settings.duty_date+time '17:00') AT TIME ZONE 'Asia/Manila',s.timestamp+interval '1 microsecond') END
  FROM public.pending_card_events a JOIN public.pending_card_events s ON s.card_uid=a.card_uid AND md5(s.id::text||':auto-close')::uuid=a.id
  CROSS JOIN settings
  WHERE a.type='CLOCK_OUT' AND a.is_auto_closed AND a.linked_officer_key IS NULL
    AND s.type='CLOCK_IN' AND NOT s.is_auto_closed AND s.linked_officer_key IS NULL
    AND (s.timestamp AT TIME ZONE 'Asia/Manila')::date=settings.duty_date
    AND a.timestamp=(settings.duty_date+time '21:00') AT TIME ZONE 'Asia/Manila'
)
SELECT c.* FROM candidates c
WHERE c.new_clock_out<>c.old_clock_out AND greatest(c.new_clock_out,c.old_clock_out)<=now()
  AND NOT EXISTS(SELECT 1 FROM attendance_maintenance.clockout_corrections b WHERE b.correction_key='20261116_clockout_policy' AND b.source_table=c.source_table AND b.event_id=c.id)
  -- A real later event means this session needs individual review, not a
  -- blanket estimate. In particular, never replace an actual evening exit.
  AND (c.source_table<>'attendance_logs' OR NOT EXISTS(
    SELECT 1 FROM public.attendance_logs real_event WHERE real_event.card_uid=c.card_uid
      AND NOT real_event.is_auto_closed AND real_event.deleted_at IS NULL
      AND real_event.timestamp>c.clock_in AND real_event.timestamp<(((c.clock_in AT TIME ZONE 'Asia/Manila')::date+1)::timestamp AT TIME ZONE 'Asia/Manila')))
  AND (c.source_table<>'pending_card_events' OR NOT EXISTS(
    SELECT 1 FROM public.pending_card_events real_event WHERE real_event.card_uid=c.card_uid
      AND NOT real_event.is_auto_closed AND real_event.linked_officer_key IS NULL
      AND real_event.timestamp>c.clock_in AND real_event.timestamp<(((c.clock_in AT TIME ZONE 'Asia/Manila')::date+1)::timestamp AT TIME ZONE 'Asia/Manila')));

INSERT INTO attendance_maintenance.clockout_corrections(correction_key,source_table,event_id,before_data)
SELECT '20261116_clockout_policy',source_table,id,before_data FROM clockout_correction_candidates;

-- This is an explicit historical correction, so protect it like other admin
-- edits. Keep is_auto_closed=true so the estimated nature remains visible.
UPDATE public.attendance_logs a SET timestamp=c.new_clock_out,manually_edited=true
FROM clockout_correction_candidates c WHERE c.source_table='attendance_logs' AND a.id=c.id;
UPDATE public.pending_card_events a SET timestamp=c.new_clock_out
FROM clockout_correction_candidates c WHERE c.source_table='pending_card_events' AND a.id=c.id;

INSERT INTO public.attendance_audit(attendance_log_id,actor_email,operation,reason,before_data,after_data)
SELECT a.id,'SQL maintenance','policy_backfill','Applied 5 PM / one-hour estimate to November 16 automatic closure',c.before_data,to_jsonb(a)
FROM public.attendance_logs a JOIN clockout_correction_candidates c ON c.source_table='attendance_logs' AND c.id=a.id;

UPDATE attendance_maintenance.clockout_corrections b SET after_data=changed.data
FROM (
  SELECT c.source_table,c.id,to_jsonb(a) AS data FROM clockout_correction_candidates c JOIN public.attendance_logs a ON c.source_table='attendance_logs' AND a.id=c.id
  UNION ALL
  SELECT c.source_table,c.id,to_jsonb(a) FROM clockout_correction_candidates c JOIN public.pending_card_events a ON c.source_table='pending_card_events' AND a.id=c.id
) changed WHERE b.correction_key='20261116_clockout_policy' AND b.source_table=changed.source_table AND b.event_id=changed.id;

COMMIT;

SELECT coalesce(after_data->>'officer_name','Unlinked card') AS officer_name,
  after_data->>'card_uid' AS card_uid,source_table,
  (before_data->>'timestamp')::timestamptz AT TIME ZONE 'Asia/Manila' AS previous_clock_out,
  (after_data->>'timestamp')::timestamptz AT TIME ZONE 'Asia/Manila' AS corrected_clock_out
FROM attendance_maintenance.clockout_corrections WHERE correction_key='20261116_clockout_policy'
ORDER BY officer_name,event_id;
