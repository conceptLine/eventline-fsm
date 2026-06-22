-- get_job_hours_audit: diff_minutes wieder ueber ALLE rapportierten Stunden.
--
-- Vorher (Migration 173): diff = rapport_billable - stempel. Das verzerrte
-- die Differenz fuer User die einen Teil ihrer Arbeitszeit als 'nicht
-- verrechnet' markiert hatten — sie wurden faelschlich als 'zu wenig
-- rapportiert' rot markiert, obwohl die Stunden ja sehr wohl rapportiert
-- sind (nur eben nicht dem Kunden in Rechnung).
--
-- Beispiel: Dario stempelt 3h57, rapportiert 3h57 davon als 'Eigenleistung
-- (nicht verrechnen)'. Migration 173 sagte: rapport=0, diff=-3h57 (rot).
-- Korrekt ist: gearbeitet = gestempelt → diff=0 (gruen).
--
-- Neu: diff_minutes = (billable + not_billable) - stempel. Die Anzeige
-- behaelt Rapport und Nicht-verr. weiter als separate Spalten (User will
-- sehen welcher Anteil verrechnet wird), aber die Audit-Differenz misst
-- die TATSAECHLICH GELEISTETE Arbeit gegen den Stempel.

CREATE OR REPLACE FUNCTION public.get_job_hours_audit(p_job_id uuid)
RETURNS TABLE(
  user_id uuid,
  user_name text,
  stempel_minutes integer,
  rapport_minutes integer,
  not_billable_minutes integer,
  diff_minutes integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: nur fuer Administratoren';
  END IF;
  RETURN QUERY
  WITH stempel AS (
    SELECT t.user_id,
      SUM(GREATEST(0, EXTRACT(EPOCH FROM (t.clock_out - t.clock_in)) / 60))::int AS minutes
    FROM public.time_entries t
    WHERE t.job_id = p_job_id AND t.clock_out IS NOT NULL
    GROUP BY t.user_id
  ),
  rapport AS (
    SELECT (range->>'technician_id')::uuid AS user_id,
      SUM(GREATEST(0, EXTRACT(EPOCH FROM ((range->>'end')::time - (range->>'start')::time))::int / 60 - COALESCE(NULLIF(range->>'pause', '')::int, 0)))::int AS minutes
    FROM public.service_reports r
    CROSS JOIN LATERAL jsonb_array_elements(r.time_ranges) AS range
    WHERE r.job_id = p_job_id
      AND r.status = 'abgeschlossen'
      AND COALESCE(range->>'technician_id', '') <> ''
      AND COALESCE(range->>'start', '') <> ''
      AND COALESCE(range->>'end', '') <> ''
      AND COALESCE((range->>'not_billable')::boolean, false) = false
    GROUP BY (range->>'technician_id')::uuid
  ),
  not_billable AS (
    SELECT (range->>'technician_id')::uuid AS user_id,
      SUM(GREATEST(0, EXTRACT(EPOCH FROM ((range->>'end')::time - (range->>'start')::time))::int / 60 - COALESCE(NULLIF(range->>'pause', '')::int, 0)))::int AS minutes
    FROM public.service_reports r
    CROSS JOIN LATERAL jsonb_array_elements(r.time_ranges) AS range
    WHERE r.job_id = p_job_id
      AND r.status = 'abgeschlossen'
      AND COALESCE(range->>'technician_id', '') <> ''
      AND COALESCE(range->>'start', '') <> ''
      AND COALESCE(range->>'end', '') <> ''
      AND COALESCE((range->>'not_billable')::boolean, false) = true
    GROUP BY (range->>'technician_id')::uuid
  ),
  all_users AS (
    SELECT s.user_id FROM stempel s
    UNION SELECT r.user_id FROM rapport r
    UNION SELECT n.user_id FROM not_billable n
  )
  SELECT u.user_id, COALESCE(p.full_name, '—') AS user_name,
    COALESCE(s.minutes, 0) AS stempel_minutes,
    COALESCE(r.minutes, 0) AS rapport_minutes,
    COALESCE(n.minutes, 0) AS not_billable_minutes,
    -- Differenz = gesamte rapportierte Arbeitszeit (verrechenbar + nicht
    -- verrechnet) minus Stempel. Misst ob alle gestempelten Stunden im
    -- Rapport dokumentiert sind, unabhaengig von der Verrechnung.
    (COALESCE(r.minutes, 0) + COALESCE(n.minutes, 0)) - COALESCE(s.minutes, 0) AS diff_minutes
  FROM all_users u
  LEFT JOIN public.profiles p ON p.id = u.user_id
  LEFT JOIN stempel s ON s.user_id = u.user_id
  LEFT JOIN rapport r ON r.user_id = u.user_id
  LEFT JOIN not_billable n ON n.user_id = u.user_id
  ORDER BY COALESCE(p.full_name, '—');
END;
$function$;
