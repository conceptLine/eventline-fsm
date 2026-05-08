-- Sichtbarkeit von Auftraegen, Terminen und Zuweisungen einschraenken auf
-- "User ist auf dem Auftrag zugeteilt" — Admins ausgenommen, die sehen alles.
--
-- Vorher: jeder authentifizierte Mitarbeiter mit auftraege:view-Permission
-- sah alle Auftraege in der Liste. Jetzt sehen Techniker / Team-Leiter nur:
--  - Auftraege wo sie als project_lead_id eingetragen sind
--  - Auftraege wo sie in job_assignments stehen
--  - Auftraege fuer die ein Termin auf sie (assigned_to) faellt
--
-- RLS-Layer ist DIE Sicherheits-Schicht — UI-Filter kommen automatisch via
-- Supabase-Client der sowieso authenticated rolle nutzt. Auftrags-Dropdowns
-- (Stempel-Modal etc.) listen damit automatisch nur "eigene" Auftraege.

-- Helper-Function: kapselt die Logik damit's bei drei Tabellen-Policies
-- nicht dreimal duplizieren muessen wir. SECURITY DEFINER bypasst RLS
-- innerhalb der Funktion (sonst Endless-Recursion via job_assignments
-- die selber jobs-Policy triggert etc.).
CREATE OR REPLACE FUNCTION public.user_can_see_job(job_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.jobs              WHERE id = job_uuid AND project_lead_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_assignments   WHERE job_id = job_uuid AND profile_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_appointments  WHERE job_id = job_uuid AND assigned_to = auth.uid());
$func$;
GRANT EXECUTE ON FUNCTION public.user_can_see_job(uuid) TO authenticated;

-- jobs: ersetze die zwei zu-offenen Policies durch eine eingeschraenkte.
DROP POLICY IF EXISTS "Aufträge sind für authentifizierte Benutzer sichtbar" ON public.jobs;
DROP POLICY IF EXISTS "jobs_select" ON public.jobs;
CREATE POLICY "jobs_select" ON public.jobs
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR project_lead_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.job_assignments  WHERE job_id = jobs.id AND profile_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_appointments WHERE job_id = jobs.id AND assigned_to = auth.uid())
  );

-- job_appointments: nur sichtbar fuer assigned_to oder fuer User die den
-- zugehoerigen Job sehen duerfen. Standalone-Termine (job_id IS NULL,
-- z.B. Vertriebs-Telefon-Termine) sind nur fuer assigned_to + admin.
DROP POLICY IF EXISTS "Termine sehen" ON public.job_appointments;
DROP POLICY IF EXISTS "appointments_select" ON public.job_appointments;
CREATE POLICY "appointments_select" ON public.job_appointments
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR assigned_to = auth.uid()
    OR (job_id IS NOT NULL AND public.user_can_see_job(job_id))
  );

-- job_assignments: User sieht eigene Zuweisungen + die seiner Mit-Mitarbeiter
-- auf gleichen Auftraegen (sonst sieht er beim Auftrag-Detail nicht wer noch
-- mit drauf ist).
DROP POLICY IF EXISTS "Zuweisungen sind sichtbar" ON public.job_assignments;
DROP POLICY IF EXISTS "assignments_select" ON public.job_assignments;
CREATE POLICY "assignments_select" ON public.job_assignments
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR profile_id = auth.uid()
    OR public.user_can_see_job(job_id)
  );
