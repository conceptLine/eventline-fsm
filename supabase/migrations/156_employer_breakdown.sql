-- Arbeitgeber-Anteil: einzelne Positionen statt Summen-Pct.
-- Ausserdem: pro Mitarbeiter all-or-nothing-Override statt per-Feld.
--
-- 1. Firmen-Standards: 6 AG-Positionen statt einer Summe.
--    Schweizer SME Defaults 2026:
--      AHV/IV/EO-AG: 5.3% (Mirror zu AN)
--      ALV-AG:       1.1% (Mirror zu AN)
--      FAK:          1.5% (canton-abhaengig, BS ~1.7%)
--      BU:           0.5% (Berufsunfall, AG-only)
--      BVG-AG:       3.0% (Pensionskasse AG-Anteil, plan-abhaengig)
--      Verwaltung:   0.5% (Pensionskassen-Verwaltung etc.)
--      Summe:       ~11.9%
--
-- 2. Per-Mitarbeiter: uses_standard_lohn boolean. Wenn true -> alle
--    Pct-Spalten (AN + AG) werden ignoriert, Firmen-Standard greift.
--    Wenn false -> die per-Spalten gespeicherten Werte zaehlen. Damit
--    fallen die per-Feld-Nullable-Logik weg; alles ist all-or-nothing.

-- 1. Neue AG-Defaults in app_settings.
alter table public.app_settings
  add column if not exists default_employer_ahv_pct numeric(5, 2) not null default 5.3,
  add column if not exists default_employer_alv_pct numeric(5, 2) not null default 1.1,
  add column if not exists default_employer_fak_pct numeric(5, 2) not null default 1.5,
  add column if not exists default_employer_bu_pct numeric(5, 2) not null default 0.5,
  add column if not exists default_employer_bvg_pct numeric(5, 2) not null default 3.0,
  add column if not exists default_employer_verwaltung_pct numeric(5, 2) not null default 0.5;

-- 2. Single-Pct-Spalte droppen.
alter table public.app_settings
  drop column if exists default_employer_pct;

-- 3. Neue AG-Positionen pro Mitarbeiter (nullable, werden nur gelesen
--    wenn uses_standard_lohn=false).
alter table public.employee_compensation
  add column if not exists employer_ahv_pct numeric(5, 2),
  add column if not exists employer_alv_pct numeric(5, 2),
  add column if not exists employer_fak_pct numeric(5, 2),
  add column if not exists employer_bu_pct numeric(5, 2),
  add column if not exists employer_bvg_pct numeric(5, 2),
  add column if not exists employer_verwaltung_pct numeric(5, 2);

-- 4. All-or-Nothing-Flag. Default true = nutzt komplett den Firmen-Standard.
alter table public.employee_compensation
  add column if not exists uses_standard_lohn boolean not null default true;

-- 5. Bestehende Rows: wer hatte AN-Pct-Overrides? -> uses_standard_lohn=false
--    damit ihre expliziten Werte weiter greifen (Behavior-Preservation).
update public.employee_compensation
set uses_standard_lohn = false
where (ahv_iv_eo_pct is not null
    or alv_pct is not null
    or nbu_pct is not null
    or bvg_pct is not null
    or ktg_pct is not null
    or quellensteuer_pct is not null
    or employer_pct is not null);

-- 6. Alte Summen-Pct-Spalte droppen.
alter table public.employee_compensation
  drop column if exists employer_pct;
