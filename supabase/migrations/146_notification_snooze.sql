-- Snooze fuer Notifications.
--
-- User klickt 'Snooze' -> snoozed_until = jetzt + (1h / morgen 7h /
-- naechste Woche). Solange snoozed_until > now() wird der Eintrag
-- im UI ausgeblendet UND der unread-Counter ignoriert ihn.
-- Cron wake-snoozed (alle 5 min) setzt abgelaufene Snoozes zurueck:
-- snoozed_until = null, is_read = false -> Eintrag taucht wieder auf
-- + triggert Realtime-UPDATE -> Glocke aktualisiert sich live.

alter table public.notifications
  add column if not exists snoozed_until timestamptz;

create index if not exists notifications_snoozed_until_idx
  on public.notifications (snoozed_until)
  where snoozed_until is not null;
