-- Buendelung fuer Notifications.
--
-- Wenn innerhalb eines kurzen Zeitfensters mehrere Notifs vom gleichen
-- Type fuer den gleichen User reinkommen, wird statt N separater Eintraege
-- ein einziger Eintrag mit bundle_count > 1 gehalten und live geupdated.
-- Verhindert Spam-Inbox bei z.B. mehreren Auftrags-Zuweisungen morgens.
--
-- bundle_count default 1 fuer Bestand-Eintraege.

alter table public.notifications
  add column if not exists bundle_count int not null default 1;

create index if not exists notifications_user_type_recent_idx
  on public.notifications (user_id, type, created_at desc)
  where is_read = false;
