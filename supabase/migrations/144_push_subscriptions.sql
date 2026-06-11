-- Push-Subscriptions fuer Web-Push (PWA).
--
-- Pro User koennen MEHRERE aktive Subscriptions existieren (z.B. iPhone +
-- Desktop-Browser + iPad). Daher (user_id, endpoint) als unique-Schluessel,
-- nicht user_id allein.
--
-- endpoint: vom Browser-Push-Service vergebene URL.
-- p256dh + auth: Client-public-keys fuer die Payload-Verschluesselung.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- RLS: jeder User darf seine eigenen Subscriptions lesen + verwalten.
-- Service-Role (Admin) kann alle lesen um Notifications zu schicken.
alter table public.push_subscriptions enable row level security;

drop policy if exists "push_select_own" on public.push_subscriptions;
create policy "push_select_own" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "push_insert_own" on public.push_subscriptions;
create policy "push_insert_own" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "push_delete_own" on public.push_subscriptions;
create policy "push_delete_own" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
