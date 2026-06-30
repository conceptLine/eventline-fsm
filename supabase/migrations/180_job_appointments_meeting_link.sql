-- job_appointments: optionaler Meeting-Link (Teams, Zoom, Google Meet ...).
-- Freitext-URL, weil wir alle Anbieter unterstuetzen — Frontend validiert
-- nur dass es eine http/https-URL ist. NULL = kein Online-Termin.

ALTER TABLE public.job_appointments
  ADD COLUMN IF NOT EXISTS meeting_link text;

COMMENT ON COLUMN public.job_appointments.meeting_link IS
  'Optionaler Meeting-Link (Teams/Zoom/Meet/...). Frontend pruft auf http(s).';
