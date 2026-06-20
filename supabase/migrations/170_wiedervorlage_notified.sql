-- Tracking-Spalte fuer "Push wurde rausgeschickt" damit der Cron-Job
-- nicht jedes Mal fuer denselben faelligen Lead spammt.
--
-- Workflow:
--   1. User setzt wiedervorlage_am = morgen 09:00
--   2. Cron laeuft alle 15min, ab morgen 09:00 wird der Lead 'faellig'
--   3. Erster Cron-Run nach 09:00: Push + Bell rausgeschickt,
--      wiedervorlage_notified_at = now()
--   4. Folge-Runs sehen notified_at gesetzt -> ueberspringen
--   5. User klickt 'Erledigt' -> wiedervorlage_am + notified_at + note
--      werden alle auf null gesetzt
--   6. Wenn User einen neuen Reminder setzt: notified_at wird vom
--      Frontend implizit ueberschrieben (= null), Zyklus startet erneut.

alter table public.vertrieb_contacts
  add column if not exists wiedervorlage_notified_at timestamptz;

-- Partial-Index fuer den Cron-Query (lte wiedervorlage_am +
-- is null wiedervorlage_notified_at).
create index if not exists vertrieb_contacts_wv_pending_idx
  on public.vertrieb_contacts (wiedervorlage_am)
  where wiedervorlage_am is not null and wiedervorlage_notified_at is null;
