-- Maximal EIN service_reports.entwurf-Row pro Job.
--
-- Vorher konnten parallel-Save-Pfade im Rapport-Form-Modal (Auto-Save +
-- ensureDraft-fuer-Photos + manueller Save + Final-Submit) mehrere
-- Entwuerfe pro Job einfuegen, wenn zwei Inserts gleichzeitig liefen
-- bevor der erste setDraftId zurueck war. Konsequenz: doppelte Stunden
-- in der Stundenkontrolle (siehe Migration 121 fuer den RPC-Fix der die
-- Folge filtert).
--
-- Mit diesem partiellen Unique-Index lehnt die DB den 2. Insert ab — App
-- kann den Fehler auffangen und stattdessen den existierenden Entwurf
-- weiterverwenden (siehe rapport-form-modal.tsx getOrCreateDraft).
--
-- Abgeschlossene Rapporte sind separat vom DB-Trigger
-- prevent_dup_abgeschlossen_report (Migration 106) geschuetzt; deshalb
-- nur 'entwurf' im WHERE.

CREATE UNIQUE INDEX IF NOT EXISTS service_reports_one_entwurf_per_job
  ON public.service_reports (job_id)
  WHERE status = 'entwurf';
