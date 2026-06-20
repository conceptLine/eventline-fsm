-- Termin-Bestaetigung an Kunde — fuer standalone Termine (job_id = null)
-- gibt's bisher keine Kunden-Felder. User soll am Termin Email + Name
-- hinterlegen und per Klick eine HTML-Mail rausschicken koennen.
--
-- Felder sind auch fuer Termine MIT job_id erlaubt — Beispiel: ein
-- Auftrag hat einen internen Vor-Ort-Termin den der Kunde nicht im
-- Hauptauftrag-Mail-Verlauf bekam (z.B. eine Begehung kurzfristig
-- vereinbart), und der Sachbearbeiter will dem Kunden separat
-- bestaetigen.
--
-- confirmation_sent_at: Zeitpunkt der letzten erfolgreichen Versand-
-- Aktion. Wird im UI angezeigt damit der User sieht 'hab ich schon
-- geschickt'. Resend erlaubt sich nochmal-Senden, das ueberschreibt
-- diesen Zeitstempel.

alter table public.job_appointments
  add column if not exists customer_email text,
  add column if not exists customer_name text,
  add column if not exists confirmation_sent_at timestamptz;
