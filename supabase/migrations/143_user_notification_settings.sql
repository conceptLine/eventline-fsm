-- User-Notification-Settings
--
-- Pro User welche Kanaele welcher Event-Typ benutzen darf.
-- channels-jsonb-Format:
--   {
--     "ticket_new":      { "in_app": true,  "email": false, "push": false },
--     "job_assigned":    { "in_app": true,  "email": true,  "push": false },
--     "appointment_new": { "in_app": true,  "email": false, "push": false },
--     "todo_assigned":   { "in_app": true,  "email": false, "push": true  },
--     ...
--   }
--
-- Fehlende Eintraege = Default: in_app=true, email=false, push=false
-- (= aktuelles Verhalten als Baseline).
--
-- Quiet Hours sind fuer Phase 5 (Web-Push) vorbereitet. In-App-
-- Notifications werden immer geschrieben damit beim naechsten Auf-
-- klappen der Glocke die History komplett ist.

create table if not exists public.user_notification_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  channels jsonb not null default '{}'::jsonb,
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time not null default '22:00'::time,
  quiet_hours_end time not null default '07:00'::time,
  digest_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Updated_at-Trigger
create or replace function public.user_notification_settings_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists user_notification_settings_touch_trg on public.user_notification_settings;
create trigger user_notification_settings_touch_trg
  before update on public.user_notification_settings
  for each row execute function public.user_notification_settings_touch();

-- RLS: jeder User darf nur seine eigenen Settings lesen/schreiben.
-- Admins koennen alle lesen (fuer Debug), aber schreiben nur eigene.
alter table public.user_notification_settings enable row level security;

drop policy if exists "uns_select_own_or_admin" on public.user_notification_settings;
create policy "uns_select_own_or_admin" on public.user_notification_settings
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "uns_insert_own" on public.user_notification_settings;
create policy "uns_insert_own" on public.user_notification_settings
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "uns_update_own" on public.user_notification_settings;
create policy "uns_update_own" on public.user_notification_settings
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "uns_delete_own" on public.user_notification_settings;
create policy "uns_delete_own" on public.user_notification_settings
  for delete to authenticated
  using (user_id = auth.uid());
