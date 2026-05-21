-- Trusted-Device-Schicht fuer sensible Bereiche (Finanzen, Loehne).
--
-- Threat-Model: Angreifer hat Login (Phishing / Datenleak). Ziel: er kann
-- sich einloggen, aber NICHT die /budget-Seite oder die Lohntabelle
-- aufrufen, weil sein Geraet kein gueltiges trusted_device-Cookie hat.
--
-- Flow:
--   1. User klickt auf Geraet A "Dieses Geraet vertrauen".
--   2. Server generiert 256-Bit Cookie-Token + 256-Bit Confirm-Token.
--      → Cookie wird auf Geraet A gesetzt (HttpOnly, Secure, SameSite=Lax).
--      → Confirm-Token wird per Email an admin@eventline-basel.com geschickt.
--   3. Wer auch immer den Confirm-Link klickt (zentrale Admin-Mailbox),
--      markiert die Zeile als 'approved'.
--   4. Geraet A's naechster API-Call: Cookie wird gegen DB gehashed
--      verglichen, status='approved' → Zugriff. Sonst → 403.
--
-- Wichtig: Bestaetigungs-Mail geht IMMER an admin@eventline-basel.com,
-- NICHT an die Email des einloggenden Users. Das zentralisiert die
-- Approval-Autoritaet — selbst wenn der Email-Account eines Mitarbeiters
-- kompromittiert ist, kann er kein Geraet selbst freischalten. Nur wer
-- die Admin-Mailbox kontrolliert (Leo) kann Geraete approven.

create table public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- Hash des Cookie-Tokens. Der raw Token lebt nur als Cookie auf dem
  -- Client; wir speichern nur SHA-256 — selbst bei DB-Leak laesst sich
  -- daraus kein gueltiger Cookie reverse-engineeren.
  cookie_token_hash text not null,

  -- Hash des Confirm-Tokens (Email-Link). Wird auf NULL gesetzt nach
  -- erfolgreicher Bestaetigung — Single-Use, kein zweimaliges Approven.
  confirm_token_hash text,

  device_name text not null,
  user_agent_hint text,    -- z.B. "Chrome 132 on Windows 11" (kein Fingerprint)
  ip_hint text,            -- nur fuer Audit, nicht fuer Auth

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'revoked')),

  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  -- Wer hat approved — typischerweise admin@eventline-basel.com, aber wir
  -- loggen die echte Email des klickenden Users, falls sich der Workflow
  -- aendert. Nur fuer Audit.
  approved_by_email text,

  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 year'),
  revoked_at timestamptz
);

create unique index trusted_devices_cookie_unique on public.trusted_devices(cookie_token_hash);
create index trusted_devices_user_idx on public.trusted_devices(user_id);
create index trusted_devices_confirm_idx on public.trusted_devices(confirm_token_hash) where confirm_token_hash is not null;
create index trusted_devices_status_idx on public.trusted_devices(status);

-- RLS: User sieht/aendert nur eigene Geraete. Admin darf alle (via
-- has_permission durchlaufen-Logik). Confirm-Token-Resolution laeuft
-- ueber service_role (kein User-RLS noetig).
alter table public.trusted_devices enable row level security;

create policy "trusted_devices_self_select" on public.trusted_devices for select to authenticated
  using (user_id = auth.uid() or public.has_permission('admin:audit'));
create policy "trusted_devices_self_insert" on public.trusted_devices for insert to authenticated
  with check (user_id = auth.uid());
create policy "trusted_devices_self_revoke" on public.trusted_devices for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "trusted_devices_self_delete" on public.trusted_devices for delete to authenticated
  using (user_id = auth.uid());

-- Hilfsfunktion: ist mein Cookie-Token in der DB als 'approved' und
-- nicht abgelaufen? Server-Code ruft das vor jedem sensiblen API-Call.
-- security definer + grant nur an service_role: nur Backend nutzt.
create or replace function public.is_trusted_device(p_token_hash text, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.trusted_devices
    where user_id = p_user_id
      and cookie_token_hash = p_token_hash
      and status = 'approved'
      and (expires_at is null or expires_at > now())
      and revoked_at is null
  );
$$;

revoke all on function public.is_trusted_device(text, uuid) from public, anon, authenticated;
grant execute on function public.is_trusted_device(text, uuid) to service_role;
