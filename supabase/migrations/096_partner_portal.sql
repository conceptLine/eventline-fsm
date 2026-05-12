-- Partner-Portal: Location-Partner koennen Anfragen erstellen, eigene
-- Location-Belegung sehen. Eventline akzeptiert oder lehnt ab.
--
-- Datenmodell:
--   - Neue Rolle "partner" (is_system=true)
--   - profiles.partner_location_id (FK -> locations, nullable). Ein Partner
--     ist genau einer Location zugeordnet. Mehrere Partner-User pro Location
--     erlaubt (z.B. SCALA-Manager + SCALA-Assistant).
--   - jobs-Status erweitert um 'partner_anfrage'
--   - jobs.accepted_by / rejected_by (audit-trail wer ent-/abgeschieden hat)
--   - jobs.partner_response_message (Begruendung bei Ablehnung, optional)
--
-- RLS:
--   - jobs SELECT: Partner sieht nur Jobs mit location_id = sein partner_location_id
--   - jobs INSERT: Partner darf nur status='partner_anfrage' + location_id =
--     sein partner_location_id einfuegen, created_by muss er selbst sein
--   - jobs UPDATE: Partner darf nur eigene partner_anfrage-Jobs aendern,
--     nicht den Status (das macht Eventline-Admin via dedizierter Action)
--   - job_appointments analog
--
-- Status-Uebergaenge:
--   partner_anfrage -> offen     (Admin akzeptiert, accepted_by gesetzt)
--   partner_anfrage -> storniert (Admin lehnt ab, rejected_by + reason gesetzt)
--   Nach Annahme: Partner-Auftrag fliesst in normale Eventline-Pipeline,
--   Partner sieht ihn read-only.

-- 1) profiles.partner_location_id
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS partner_location_id uuid
  REFERENCES public.locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_partner_location_idx
  ON public.profiles(partner_location_id)
  WHERE partner_location_id IS NOT NULL;

-- 2) jobs.status erweitern um partner_anfrage
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('partner_anfrage', 'anfrage', 'entwurf', 'offen', 'abgeschlossen', 'storniert'));

-- 3) jobs.accepted_by / rejected_by / partner_response_message
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS partner_response_message text;

-- 4) Partner-Rolle anlegen (is_system damit nicht aus UI loeschbar).
-- Permissions: dashboard (immer), kalender (eigene Location), auftraege
-- (eigene Anfragen) — die granularen Visibility-Checks macht aber RLS.
INSERT INTO public.roles (slug, label, permissions, is_system) VALUES
  ('partner', 'Location-Partner',
   '["partner_anfragen","partner_belegungsplan"]'::jsonb,
   true)
ON CONFLICT (slug) DO NOTHING;

-- 5) RLS jobs: Partner darf NUR Jobs an seiner Location sehen.
-- Wir bauen das in den bestehenden jobs_select-Policy ein, indem wir
-- den OR-Pfad fuer partner_location_id ergaenzen.
DROP POLICY IF EXISTS "jobs_select" ON public.jobs;
CREATE POLICY "jobs_select" ON public.jobs
  FOR SELECT TO authenticated
  USING (
    public.is_admin_or_lead()
    OR project_lead_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.job_assignments WHERE job_id = jobs.id AND profile_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_appointments WHERE job_id = jobs.id AND assigned_to = auth.uid())
    -- Partner: sieht alle Jobs an seiner Location (eigene und Eventline-interne).
    -- Auf Application-Layer (Belegungsplan) maskieren wir Details fremder Jobs.
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'partner'
        AND profiles.partner_location_id IS NOT NULL
        AND profiles.partner_location_id = jobs.location_id
    )
  );

-- 6) jobs INSERT: Partner darf nur partner_anfrage anlegen an seiner Location
DROP POLICY IF EXISTS "jobs_insert_partner" ON public.jobs;
CREATE POLICY "jobs_insert_partner" ON public.jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Admins/Leads bleiben unbeschraenkt (anderer Policy macht das,
    -- aber sichern wir hier nicht extra ab — andere INSERT-Policies
    -- ueberstimmen via OR).
    public.is_admin_or_lead()
    -- Partner-Spezialfall: muss seine Location sein, Status muss
    -- partner_anfrage sein, created_by muss er selbst sein.
    OR (
      status = 'partner_anfrage'
      AND created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'partner'
          AND profiles.partner_location_id IS NOT NULL
          AND profiles.partner_location_id = jobs.location_id
      )
    )
  );

-- 7) jobs UPDATE Partner: darf eigene partner_anfrage-Jobs editieren
-- (Titel, Beschreibung, Dates) — aber NICHT Status aendern.
-- Status-Change geht ueber eine dedizierte API-Route (admin-only).
-- Wir machen kein Spalten-Level-Check hier weil PG das nicht direkt
-- in einer Policy kann — der Status-Schutz passiert in der API + via
-- "WITH CHECK status=partner_anfrage". Wenn Partner versucht, status
-- selbst zu setzen, scheitert der UPDATE am WITH CHECK.
DROP POLICY IF EXISTS "jobs_update_partner" ON public.jobs;
CREATE POLICY "jobs_update_partner" ON public.jobs
  FOR UPDATE TO authenticated
  USING (
    -- Bisher gab's einen jobs_update fuer alle authenticated — wir lassen
    -- das alte Verhalten via OR fuer Admins.
    public.is_admin_or_lead()
    OR (
      status = 'partner_anfrage'
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'partner'
          AND profiles.partner_location_id IS NOT NULL
          AND profiles.partner_location_id = jobs.location_id
      )
    )
  )
  WITH CHECK (
    public.is_admin_or_lead()
    OR (
      status = 'partner_anfrage'
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'partner'
          AND profiles.partner_location_id IS NOT NULL
          AND profiles.partner_location_id = jobs.location_id
      )
    )
  );

-- 8) job_appointments: Partner sieht Termine zu Jobs die er sehen darf
-- (user_can_see_job() haben wir schon, dort partner-pfad nachziehen).
CREATE OR REPLACE FUNCTION public.user_can_see_job(job_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT
    public.is_admin_or_lead()
    OR EXISTS (SELECT 1 FROM public.jobs              WHERE id = job_uuid AND project_lead_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_assignments   WHERE job_id = job_uuid AND profile_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_appointments  WHERE job_id = job_uuid AND assigned_to = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE j.id = job_uuid
        AND p.role = 'partner'
        AND p.partner_location_id IS NOT NULL
        AND p.partner_location_id = j.location_id
    );
$func$;

-- 9) job_appointments INSERT/UPDATE Partner: darf Termine fuer eigene
-- partner_anfrage-Jobs anlegen.
DROP POLICY IF EXISTS "appointments_insert_partner" ON public.job_appointments;
CREATE POLICY "appointments_insert_partner" ON public.job_appointments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin_or_lead()
    OR (
      job_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.jobs j
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE j.id = job_id
          AND j.status = 'partner_anfrage'
          AND p.role = 'partner'
          AND p.partner_location_id IS NOT NULL
          AND p.partner_location_id = j.location_id
      )
    )
  );

DROP POLICY IF EXISTS "appointments_delete_partner" ON public.job_appointments;
CREATE POLICY "appointments_delete_partner" ON public.job_appointments
  FOR DELETE TO authenticated
  USING (
    public.is_admin_or_lead()
    OR (
      job_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.jobs j
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE j.id = job_id
          AND j.status = 'partner_anfrage'
          AND p.role = 'partner'
          AND p.partner_location_id IS NOT NULL
          AND p.partner_location_id = j.location_id
      )
    )
  );
