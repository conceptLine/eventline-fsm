-- Bexio-Kontenrahmen wird Single Source of Truth fuer Budget-Kategorien.
--
-- Vorher: manuelle Default-Kategorien (Personal, Equipment, Marketing, ...) mit
-- separater Mapping-Tabelle budget_category_account_map, die jede Kategorie
-- auf ein oder mehrere Bexio-Konten verwies. Doppelarbeit + Drift-Gefahr
-- (Konto in Bexio neu → keiner trackt's; Mapping vergessen → Ist falsch).
--
-- Jetzt: budget_categories bekommt eine direkte bexio_account_no. Der
-- Cron-Sync zieht alle Aufwand- + Ertragskonten aus Bexio und erstellt
-- entsprechende budget_categories. Hierarchie via Praefix (5xxx, 6xxx, ...) —
-- Bexio's account_groups waeren feiner, aber das Praefix-Modell deckt
-- Schweizer KMU-Kontenrahmen 100% ab und braucht keinen zweiten API-Call.
--
-- Aenderungen:
--   1. Spalten dazu (bexio_account_no, bexio_account_group_id, is_auto_synced)
--   2. Alte manuelle Default-Kategorien archivieren (Personal, Betrieb, Equipment,
--      Marketing, IT & Software, Versicherungen, Weiterbildung, Sonstiges).
--      Schon archivierte Sub-Kategorien (Lohn, Sozialleistungen, Spesen) bleiben
--      archiviert.
--   3. budget_category_account_map dropen — redundant.
--   4. auto_source 'internal_labor' vorerst von "Personal" entfernen — wird beim
--      ersten Sync auf die Personalaufwand-Top-Level-Gruppe neu gesetzt.

-- === 1. Neue Spalten ===
alter table public.budget_categories
  add column if not exists bexio_account_no text,
  add column if not exists bexio_account_group_id int,
  add column if not exists is_auto_synced boolean not null default false;

create unique index if not exists budget_cat_bexio_acct_unique
  on public.budget_categories(bexio_account_no)
  where bexio_account_no is not null;

comment on column public.budget_categories.bexio_account_no is
  'Bexio-Kontonummer. NULL fuer manuelle / Gruppen-Kategorien. UNIQUE wenn gesetzt.';
comment on column public.budget_categories.is_auto_synced is
  'true = wurde vom Bexio-Sync erzeugt/refreshed. Manuelle Kategorien bleiben false.';

-- === 2. Manuelle Default-Kategorien archivieren ===
update public.budget_categories
set archived_at = coalesce(archived_at, now()),
    auto_source = null
where parent_id is null
  and is_auto_synced = false
  and name in ('Personal','Betrieb','Equipment','Marketing','IT & Software','Versicherungen','Weiterbildung','Sonstiges');

-- === 3. Mapping-Tabelle weg ===
-- Sicherheit: nur droppen wenn sie wirklich nicht mehr aus anderen Bereichen
-- referenziert wird. RLS-Policies haengen dran — alles geht weg.
drop table if exists public.budget_category_account_map cascade;
