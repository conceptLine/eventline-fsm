-- job_assignments-Tabelle komplett entfernen.
--
-- Hintergrund: job_assignments war die ALTE Zuweisungs-Tabelle. Seit
-- Einfuehrung von job_appointments wird sie nicht mehr befuellt (DB-
-- weit 0 Zeilen, ueber alle 74 Jobs). Trotzdem haengen RLS-Policies
-- und Code-Lese-Pfade noch dran und liefern Inkonsistenzen:
--   - RLS 'jobs_update_assigned' prueft NUR job_assignments, daher
--     konnten Techniker zugewiesene Jobs nicht abschliessen wenn sie
--     nur ueber Termine (job_appointments) angebunden waren. Der
--     rapport-form-modal schluckte den Fehler silent und liess die
--     Jobs in inkonsistentem Zustand (Bug: INT-26229 Lisa Braswell,
--     INT-26212 Einrichten Uebergabe — beide 2026-06-17 manuell
--     korrigiert).
--
-- Konsequenz: Tabelle + Policies komplett raus. Wo Zuweisungs-Logik
-- noch benoetigt wird, ueber job_appointments.assigned_to gehen
-- (das ist die einzige aktive Zuweisungs-Quelle).

-- 1) Policies auf jobs die job_assignments referenzieren droppen.
drop policy if exists "Techniker können zugewiesene Aufträge updaten" on public.jobs;
drop policy if exists "jobs_update_assigned" on public.jobs;

-- 2) jobs_select-Policy neu schreiben — die alte hatte einen
--    job_assignments-Zweig als OR-Bedingung. Wir lassen den Zweig weg,
--    job_appointments-Zweig bleibt drin.
drop policy if exists "jobs_select" on public.jobs;
create policy "jobs_select" on public.jobs
  for select
  using (
    public.is_admin_or_lead()
    or (project_lead_id = auth.uid())
    or exists (
      select 1 from public.job_appointments
      where job_appointments.job_id = jobs.id
        and job_appointments.assigned_to = auth.uid()
    )
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'partner'
        and profiles.partner_location_id is not null
        and profiles.partner_location_id = jobs.location_id
    )
  );

-- 3) Neue UPDATE-Policy fuer Techniker die ueber job_appointments
--    zugewiesen sind. Sie ersetzt die zwei alten Policies oben.
create policy "jobs_update_assigned" on public.jobs
  for update
  to authenticated
  using (
    exists (
      select 1 from public.job_appointments
      where job_appointments.job_id = jobs.id
        and job_appointments.assigned_to = auth.uid()
    )
  );

-- 4) Helper-Function user_can_see_job() updaten — job_assignments-Zeile
--    raus, job_appointments-Zeile bleibt drin (war als OR-Fallback
--    schon vorhanden).
create or replace function public.user_can_see_job(job_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin_or_lead()
    or exists (select 1 from public.jobs              where id = job_uuid and project_lead_id = auth.uid())
    or exists (select 1 from public.job_appointments  where job_id = job_uuid and assigned_to = auth.uid())
    or exists (
      select 1 from public.jobs j
      join public.profiles p on p.id = auth.uid()
      where j.id = job_uuid
        and p.role = 'partner'
        and p.partner_location_id is not null
        and p.partner_location_id = j.location_id
    );
$$;

-- 5) Tabelle droppen. RESTRICT statt CASCADE — falls noch ein Foreign-
--    Key hinhaengt, soll die Migration laut bruellen statt blind drauf
--    rumzuhacken.
drop table if exists public.job_assignments;
