-- Wiedervorlage + Snooze fuer Vertrieb-Leads.
--
-- Konzept:
--  - wiedervorlage_am: timestamptz, optional. Wann soll ich den Lead
--    wieder anfassen. Wenn in der Vergangenheit -> Lead-Karte wird
--    visuell als 'ueberfaellig' markiert + Push-Notification.
--  - wiedervorlage_note: kurzer Text, optional ('warum erinnern').
--  - wiedervorlage_snoozed: boolean. Wenn true und wiedervorlage_am
--    in der Zukunft -> Lead ist aus der aktiven Liste ausgeblendet
--    (taucht in eigenem 'Snoozed'-Bereich auf). Wenn Datum erreicht,
--    wird die Maske automatisch durch den Cron-Job entfernt
--    (snoozed = false gesetzt) und die Push ausgeloest.

alter table public.vertrieb_contacts
  add column if not exists wiedervorlage_am timestamptz,
  add column if not exists wiedervorlage_note text,
  add column if not exists wiedervorlage_snoozed boolean not null default false;

-- Partial-Index: nur Leads mit aktiver Wiedervorlage brauchen wir im Index
-- (Cron-Job liest "wiedervorlage_am <= now() and wiedervorlage_am is not null").
create index if not exists vertrieb_contacts_wiedervorlage_idx
  on public.vertrieb_contacts (wiedervorlage_am)
  where wiedervorlage_am is not null;
