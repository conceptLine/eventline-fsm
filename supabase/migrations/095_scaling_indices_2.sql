-- Zusaetzliche Indexes fuer haeufig-gefilterte Spalten die im
-- Performance-Audit aufgefallen sind.
--
--  - jobs(project_lead_id): /api/calendar.ics filtert jobs auf
--    project_lead_id eines Users; ohne Index Seq-Scan bei wachsender
--    jobs-Tabelle.
--  - job_appointments(assigned_to): Kalender-View filtert Termine
--    auf einen einzelnen Mitarbeiter — gleich wie oben.
--  - notifications(created_at): /api/cron/reminders loescht alte
--    Notifications mit `created_at < cutoff`. notifications_user_unread_idx
--    hat user_id vorne, fuer den cron-Range-Filter nicht ideal —
--    Standalone created_at-Index ist effizienter fuer die DELETE-Query.

CREATE INDEX IF NOT EXISTS jobs_project_lead_idx
  ON public.jobs(project_lead_id)
  WHERE project_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_appointments_assigned_to_idx
  ON public.job_appointments(assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_created_at_idx
  ON public.notifications(created_at);
