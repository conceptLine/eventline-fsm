-- Budget v2 — Soll/Ist-Vergleich via Bexio-Konten:
--
--  1. budget_category_account_map  — N:M von budget_categories zu Bexio-Konten.
--                                    "Personal/Sozialleistungen" → ["5200","5270","5280"]
--  2. budget_account_snapshot       — pro Konto pro Monat eine aggregierte
--                                    Summe (das "Ist"). Cron schreibt rein,
--                                    Client liest. KEINE Einzel-Buchungen.
--  3. budget_access_log             — Audit-Spur fuer Finanz-Zugriffe.
--  4. budget:view-actuals          — separater Permission-Slug damit jemand
--                                    "Soll" sehen darf ohne "Ist".

-- =====================================================================
-- 1. Category ↔ Bexio-Konto Mapping
-- =====================================================================

create table public.budget_category_account_map (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.budget_categories(id) on delete cascade,
  -- Bexio-Konto-Nummer als text (Bexio fuehrt Konten z.T. mit fuehrenden
  -- Nullen — "1020" vs "01020" sollen unterscheidbar bleiben). Keine FK
  -- auf eine lokale Konten-Tabelle, weil die Liste aus Bexio kommt und sich
  -- jederzeit aendern kann.
  bexio_account_no text not null,
  -- Snapshot des Konto-Namens zum Zeitpunkt der Verknuepfung — fuer die
  -- UI-Anzeige ohne extra Bexio-API-Call. Wird beim Sync aktualisiert.
  bexio_account_name text,
  created_at timestamptz default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique(category_id, bexio_account_no)
);

create index budget_cat_account_map_cat_idx on public.budget_category_account_map(category_id);
create index budget_cat_account_map_acct_idx on public.budget_category_account_map(bexio_account_no);

alter table public.budget_category_account_map enable row level security;

create policy "bcam_select" on public.budget_category_account_map for select to authenticated
  using (public.has_permission('budget:view'));
create policy "bcam_insert" on public.budget_category_account_map for insert to authenticated
  with check (public.has_permission('budget:edit'));
create policy "bcam_update" on public.budget_category_account_map for update to authenticated
  using (public.has_permission('budget:edit'));
create policy "bcam_delete" on public.budget_category_account_map for delete to authenticated
  using (public.has_permission('budget:edit'));

-- =====================================================================
-- 2. Aggregated Monthly Snapshot
-- =====================================================================
-- Eine Zeile pro Konto pro Monat. Cron berechnet die Summen aus Bexio-
-- Buchungen und upserted. KEIN Detail (keine Einzel-Buchung, kein Empfaenger,
-- kein Datum exakt) — Leak-Risiko bewusst minimiert.

create table public.budget_account_snapshot (
  id uuid primary key default gen_random_uuid(),
  bexio_account_no text not null,
  fiscal_year int not null check (fiscal_year between 2000 and 2100),
  fiscal_month int not null check (fiscal_month between 1 and 12),
  sum_chf numeric(14, 2) not null default 0,
  booking_count int not null default 0,
  last_synced_at timestamptz not null default now(),
  unique(bexio_account_no, fiscal_year, fiscal_month)
);

create index budget_snapshot_year_idx on public.budget_account_snapshot(fiscal_year, fiscal_month);
create index budget_snapshot_account_idx on public.budget_account_snapshot(bexio_account_no);

alter table public.budget_account_snapshot enable row level security;

-- Sehen darf jeder mit budget:view-actuals — Soll-Sehen reicht hier nicht,
-- Ist ist sensibler.
create policy "bas_select" on public.budget_account_snapshot for select to authenticated
  using (public.has_permission('budget:view-actuals'));
-- Insert/Update/Delete: nur service_role (Cron). KEINE Policy fuer
-- authenticated -> default-deny.

-- =====================================================================
-- 3. Audit-Log
-- =====================================================================
-- Wer hat wann was angeschaut. Tabelle waechst (~1 Eintrag pro Page-View),
-- daher bigserial-PK + Index auf created_at fuer schnelles Trimming.
-- Retention: nightly Cron loescht aelter als 365 Tage (separater Job).

create table public.budget_access_log (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete set null,
  -- 'view_soll', 'view_ist', 'edit_amount', 'sync_started', 'sync_completed',
  -- 'sync_failed', 'mapping_changed', 'category_archived'
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index budget_access_log_user_idx on public.budget_access_log(user_id);
create index budget_access_log_created_idx on public.budget_access_log(created_at);
create index budget_access_log_action_idx on public.budget_access_log(action);

alter table public.budget_access_log enable row level security;

-- Lesen: nur Admins (Log-Analyse).
create policy "bal_select" on public.budget_access_log for select to authenticated
  using ((select role from public.profiles where id = auth.uid()) = 'admin');
-- Insert/Update/Delete: nur service_role (Server-Side-Logging via Admin-Client).

-- =====================================================================
-- 4. Permission-Split
-- =====================================================================
-- Neuer Slug 'budget:view-actuals' fuer das Ist-Sehen. Soll-Sehen
-- (budget:view) bleibt entkoppelt. Admin bekommt automatisch beides.

update public.roles
set permissions = (
  coalesce(permissions, '[]'::jsonb)
  - 'budget:view-actuals'
) || '["budget:view-actuals"]'::jsonb
where slug = 'admin';
