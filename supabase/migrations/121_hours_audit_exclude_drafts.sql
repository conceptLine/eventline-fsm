-- get_job_hours_audit: nur abgeschlossene Reports mitzaehlen.
--
-- Vorher summierte die RPC ueber ALLE service_reports eines Jobs — inkl.
-- Entwuerfe. Das fuehrte zu verdoppelten/verdreifachten Rapport-Stunden in
-- der Stundenkontrolle-Card sobald ein Rapport mehrere Draft-Iterationen
-- durchlief (z.B. INT-26228 hatte 2 entwurf + 1 abgeschlossen → Tim+Mathis
-- standen mit 6h15m + 1h30m statt 2h + 30m, Total 7h45m statt 2h30m). Der
-- generierte PDF stellt nur den abgeschlossenen Report dar, App und PDF
-- waren so out-of-sync.
--
-- Fix: WHERE r.status = 'abgeschlossen' in der rapport-CTE. Stempel-Seite
-- bleibt unveraendert (time_entries kennt kein draft-Status).

CREATE OR REPLACE FUNCTION public.get_job_hours_audit(p_job_id uuid)
RETURNS TABLE(user_id uuid, user_name text, stempel_minutes integer, rapport_minutes integer, diff_minutes integer)
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
    GROUP BY (range->>'technician_id')::uuid
  ),
  all_users AS (
    SELECT s.user_id FROM stempel s UNION SELECT r.user_id FROM rapport r
  )
  SELECT u.user_id, COALESCE(p.full_name, '—') AS user_name,
    COALESCE(s.minutes, 0) AS stempel_minutes,
    COALESCE(r.minutes, 0) AS rapport_minutes,
    COALESCE(r.minutes, 0) - COALESCE(s.minutes, 0) AS diff_minutes
  FROM all_users u
  LEFT JOIN public.profiles p ON p.id = u.user_id
  LEFT JOIN stempel s ON s.user_id = u.user_id
  LEFT JOIN rapport r ON r.user_id = u.user_id
  ORDER BY COALESCE(p.full_name, '—');
END;
$function$;
