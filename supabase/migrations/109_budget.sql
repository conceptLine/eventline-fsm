-- Budget-Feature: Firmen-Budget pro Jahr & Kategorie setzen.
--
-- Design-Entscheidungen (langfristig stabil):
--  • Zwei Tabellen: budget_categories (Hierarchie) + budget_entries (Werte).
--  • period_type/period_index sind von Anfang an im Schema, damit Monats-/
--    Quartals-Budgets spaeter ohne Migration moeglich sind. v1 nutzt nur
--    period_type='year' / period_index=NULL.
--  • amount_chf numeric(14,2) — exakte Zentbetraege, kein Float-Drift.
--  • Soft-Delete via archived_at — historische Budgets bleiben lesbar.
--  • RLS via has_permission('budget:view'|'budget:edit') — Admin durch,
--    andere Rollen via roles.permissions konfigurierbar.

-- === 1. Tabellen ===

create table public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.budget_categories(id) on delete restrict,
  name text not null,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index budget_categories_parent_idx on public.budget_categories(parent_id);
create index budget_categories_sort_idx on public.budget_categories(parent_id nulls first, sort_order);

create trigger budget_categories_updated_at
  before update on public.budget_categories
  for each row execute function public.update_updated_at();

create table public.budget_entries (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.budget_categories(id) on delete cascade,
  fiscal_year int not null check (fiscal_year between 2000 and 2100),
  period_type text not null default 'year' check (period_type in ('year', 'quarter', 'month')),
  period_index int check (period_index is null or period_index between 1 and 12),
  amount_chf numeric(14, 2) not null default 0,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- Genau ein Eintrag pro Kategorie x Jahr x Periode.
  -- NULL=NULL gleicht in unique nicht — fuer period_type='year' nutzen wir
  -- partial unique-Index (siehe unten).
  constraint budget_entries_period_index_consistent check (
    (period_type = 'year' and period_index is null)
    or (period_type = 'quarter' and period_index between 1 and 4)
    or (period_type = 'month' and period_index between 1 and 12)
  )
);

create index budget_entries_category_idx on public.budget_entries(category_id);
create index budget_entries_year_idx on public.budget_entries(fiscal_year);

-- Yearly: ein Eintrag pro (category, year). Quarter/Month: pro (category, year, period_index).
create unique index budget_entries_unique_year
  on public.budget_entries(category_id, fiscal_year)
  where period_type = 'year';
create unique index budget_entries_unique_period
  on public.budget_entries(category_id, fiscal_year, period_type, period_index)
  where period_type <> 'year';

create trigger budget_entries_updated_at
  before update on public.budget_entries
  for each row execute function public.update_updated_at();

-- === 2. RLS ===

alter table public.budget_categories enable row level security;
alter table public.budget_entries enable row level security;

create policy "budget_categories_select" on public.budget_categories for select to authenticated
  using (public.has_permission('budget:view'));
create policy "budget_categories_insert" on public.budget_categories for insert to authenticated
  with check (public.has_permission('budget:edit'));
create policy "budget_categories_update" on public.budget_categories for update to authenticated
  using (public.has_permission('budget:edit'));
create policy "budget_categories_delete" on public.budget_categories for delete to authenticated
  using (public.has_permission('budget:edit'));

create policy "budget_entries_select" on public.budget_entries for select to authenticated
  using (public.has_permission('budget:view'));
create policy "budget_entries_insert" on public.budget_entries for insert to authenticated
  with check (public.has_permission('budget:edit'));
create policy "budget_entries_update" on public.budget_entries for update to authenticated
  using (public.has_permission('budget:edit'));
create policy "budget_entries_delete" on public.budget_entries for delete to authenticated
  using (public.has_permission('budget:edit'));

-- === 3. Admin-Rolle bekommt budget-Permissions ===
-- has_permission() laesst Admin zwar immer durch, aber die UI-Rollen-Matrix
-- liest aus roles.permissions — daher Admin explizit ergaenzen.
update public.roles
set permissions = (
  coalesce(permissions, '[]'::jsonb)
  - 'budget:view' - 'budget:edit'
) || '["budget:view","budget:edit"]'::jsonb
where slug = 'admin';

-- === 4. Default-Kategorien fuer Eventfirmen ===
-- Idempotent: nur einfuegen wenn Tabelle noch leer ist (z.B. nach Reset).
do $$
declare
  v_count int;
  v_personal_id uuid;
  v_betrieb_id uuid;
begin
  select count(*) into v_count from public.budget_categories;
  if v_count > 0 then return; end if;

  -- Top-Level
  insert into public.budget_categories (name, sort_order) values
    ('Personal',         10) returning id into v_personal_id;
  insert into public.budget_categories (name, sort_order) values
    ('Betrieb',          20) returning id into v_betrieb_id;
  insert into public.budget_categories (name, sort_order) values
    ('Equipment',        30),
    ('Marketing',        40),
    ('IT & Software',    50),
    ('Versicherungen',   60),
    ('Weiterbildung',    70),
    ('Sonstiges',        80);

  -- Sub-Kategorien Personal
  insert into public.budget_categories (parent_id, name, sort_order) values
    (v_personal_id, 'Lohn',             10),
    (v_personal_id, 'Sozialleistungen', 20),
    (v_personal_id, 'Spesen',           30);

  -- Sub-Kategorien Betrieb
  insert into public.budget_categories (parent_id, name, sort_order) values
    (v_betrieb_id, 'Miete',         10),
    (v_betrieb_id, 'Nebenkosten',   20),
    (v_betrieb_id, 'Fahrzeuge',     30);
end$$;
