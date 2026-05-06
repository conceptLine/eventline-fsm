-- auftraege_counts + vertrieb_counts als MATERIALIZED VIEW.
--
-- Vorher: regular views — count(*) FILTER (...)-Aggregate liefen bei JEDEM
-- Page-Mount frisch gegen die jobs/vertrieb_contacts-Tabellen. Bei 100+
-- Mitarbeitern × Tab-Wechsel = tausende Aggregate/Tag gegen wachsende
-- Tabellen → DB-Last.
--
-- Jetzt: materialized views, alle 60s via Cron-Endpoint refreshed
-- (refresh_dashboard_counts-Function, GRANT EXECUTE auf service_role).
-- Counts sind nicht real-time relevant — 1min Verzoegerung merkt der
-- User nicht.

DROP VIEW IF EXISTS public.auftraege_counts CASCADE;
DROP VIEW IF EXISTS public.vertrieb_counts CASCADE;

CREATE MATERIALIZED VIEW public.auftraege_counts AS
SELECT
  count(*) FILTER (WHERE status = 'anfrage' AND (cancelled_as_anfrage IS NULL OR cancelled_as_anfrage = false))::integer AS anfrage,
  count(*) FILTER (WHERE status = 'offen')::integer AS offen,
  count(*) FILTER (WHERE status = 'offen' AND was_anfrage = true)::integer AS offen_vermietung,
  count(*) FILTER (WHERE status = 'abgeschlossen')::integer AS abgeschlossen,
  count(*) FILTER (WHERE status = 'storniert' AND (cancelled_as_anfrage IS NULL OR cancelled_as_anfrage = false))::integer AS storniert,
  count(*) FILTER (WHERE status = 'entwurf')::integer AS entwurf
FROM public.jobs
WHERE is_deleted IS NOT TRUE;

CREATE MATERIALIZED VIEW public.vertrieb_counts AS
SELECT
  count(*)::integer AS total,
  count(*) FILTER (WHERE status = 'offen')::integer AS offen,
  count(*) FILTER (WHERE status = 'kontaktiert')::integer AS kontaktiert,
  count(*) FILTER (WHERE status = 'gespraech')::integer AS gespraech,
  count(*) FILTER (WHERE status = 'gewonnen')::integer AS gewonnen,
  count(*) FILTER (WHERE status = 'abgesagt')::integer AS abgesagt,
  count(*) FILTER (WHERE COALESCE(step, 1) = 1 AND status NOT IN ('gewonnen','abgesagt'))::integer AS step_1,
  count(*) FILTER (WHERE COALESCE(step, 1) = 2 AND status NOT IN ('gewonnen','abgesagt'))::integer AS step_2,
  count(*) FILTER (WHERE COALESCE(step, 1) = 3 AND status NOT IN ('gewonnen','abgesagt'))::integer AS step_3,
  count(*) FILTER (WHERE COALESCE(step, 1) = 4 AND status NOT IN ('gewonnen','abgesagt'))::integer AS step_4
FROM public.vertrieb_contacts;

-- Initial-Populate (CREATE MV macht's eigentlich automatisch, aber fuer
-- Klarheit hier explizit).
REFRESH MATERIALIZED VIEW public.auftraege_counts;
REFRESH MATERIALIZED VIEW public.vertrieb_counts;

-- Read-Permissions wie bei den vorherigen views.
GRANT SELECT ON public.auftraege_counts TO authenticated;
GRANT SELECT ON public.vertrieb_counts TO authenticated;

-- Refresh-Function — wird vom Cron via service_role aufgerufen. SECURITY
-- DEFINER damit die Funktion mit Owner-Rechten REFRESH ausfuehren kann
-- (REFRESH erfordert MV-Owner-Privileg).
CREATE OR REPLACE FUNCTION public.refresh_dashboard_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  REFRESH MATERIALIZED VIEW public.auftraege_counts;
  REFRESH MATERIALIZED VIEW public.vertrieb_counts;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.refresh_dashboard_counts TO service_role;
