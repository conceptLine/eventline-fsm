-- Job-Dokumente fuer alle sichtbar machen, die den Auftrag sehen.
--
-- Problem: Die SELECT-Policy "Dokumente sind sichtbar" wurde im Security-
-- Hardening (069) von `using (true)` auf `(uploaded_by = auth.uid()) OR
-- is_admin()` verschaerft. Folge: Ein Mitarbeiter, der einem Auftrag via
-- job_appointments zugewiesen ist (sieht den Auftrag), aber das Dokument
-- nicht selbst hochgeladen hat, sah es nicht — die Zeile war RLS-unsichtbar.
-- Konkret: Dario war dem Termin am 06.06.2026 zugewiesen, das PDF hatte
-- aber Leo hochgeladen -> "Keine Dokumente".
--
-- Fix (additiv, kein Removal): Eine zusaetzliche SELECT-Policy. Die
-- EXISTS-Subquery auf jobs steht selbst unter jobs-RLS — d.h. sie ist genau
-- dann true, wenn der User den Auftrag via jobs_select sehen darf
-- (Admin/Lead, project_lead, job_assignments, job_appointments-Zuweisung
-- oder Partner-Location). So erbt die Dokument-Sichtbarkeit automatisch die
-- Auftrags-Sichtbarkeit und bleibt konsistent, auch wenn sich jobs_select
-- spaeter aendert. Auf Job-Dokumente begrenzt (job_id not null), damit
-- Location-/Customer-Dokumente von ihren eigenen Policies geregelt bleiben.

drop policy if exists "documents_select_via_job" on public.documents;

create policy "documents_select_via_job"
  on public.documents for select to authenticated
  using (
    job_id is not null
    and exists (
      select 1 from public.jobs j
      where j.id = documents.job_id
    )
  );
