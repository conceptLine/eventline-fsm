-- Permission-Change-Audit-Log.
--
-- Bisher gab es keine Spur wer wann was an Rollen oder
-- User-Rollen-Zuweisungen geaendert hat. Bei 100+ Mitarbeitenden
-- compliance-relevant — und einfach falls jemand sich fragt 'wann
-- hat XYZ Admin-Rechte bekommen?'.
--
-- Tabelle wird ueber API-Routes (admin/roles + admin/users) befuellt.
-- Reads: admin-only (sensible Info).

create table public.permission_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  -- Wer hat geaendert
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_label text,                -- denormalisiert (full_name) damit Log
                                   -- nach User-Loeschung lesbar bleibt
  -- Welche Art von Aenderung
  action text not null check (action in (
    'role.created', 'role.updated', 'role.deleted',
    'user.role_changed', 'user.permissions_changed'
  )),
  -- Worauf (eines der beiden je nach action)
  target_role_slug text,
  target_profile_id uuid references public.profiles(id) on delete set null,
  target_profile_label text,       -- ebenso denormalisiert
  -- Detail-Payload (vorher/nachher), generisch
  details jsonb not null default '{}'::jsonb
);

create index permission_audit_log_occurred_idx
  on public.permission_audit_log (occurred_at desc);

create index permission_audit_log_actor_idx
  on public.permission_audit_log (actor_profile_id);

create index permission_audit_log_target_role_idx
  on public.permission_audit_log (target_role_slug);

alter table public.permission_audit_log enable row level security;

-- Nur Admins lesen den Audit-Log. Inserts laufen via API/Service-Role
-- (kein Client schreibt direkt), daher keine INSERT-Policy noetig.
create policy "permission_audit_select_admin"
  on public.permission_audit_log
  for select
  using (is_admin());
