-- Lohn-Abzuege als firmenweite Standards mit per-Mitarbeiter-Override.
-- Analog zu Migration 152 (employer_costs): app_settings haelt die
-- Standardwerte, employee_compensation kann sie pro Mitarbeiter per
-- Override ueberschreiben (NULL = nutze Standard).
--
-- Schweizer Standard 2026 (gleich wie alte Spalten-Defaults aus 128):
--   AHV/IV/EO  5.3%
--   ALV        1.1%
--   NBU        1.4%
--   BVG        0%   (altersabhaengig, pro Mitarbeiter)
--   KTG        0%   (optional)
--   Quellensteuer 0% (nur Auslaender ohne C)
--
-- Bestehende Daten bleiben als explizite Overrides erhalten — kein
-- automatisches Migrieren auf NULL (alte Eintraege koennen via UI bei
-- Bedarf auf 'Standard' geschaltet werden).

-- 1. Defaults in app_settings.
alter table public.app_settings
  add column if not exists default_ahv_iv_eo_pct numeric(5, 2) not null default 5.3,
  add column if not exists default_alv_pct numeric(5, 2) not null default 1.1,
  add column if not exists default_nbu_pct numeric(5, 2) not null default 1.4,
  add column if not exists default_bvg_pct numeric(5, 2) not null default 0,
  add column if not exists default_ktg_pct numeric(5, 2) not null default 0,
  add column if not exists default_quellensteuer_pct numeric(5, 2) not null default 0;

-- 2. Per-Mitarbeiter-Spalten nullable machen + Defaults abbauen.
alter table public.employee_compensation
  alter column ahv_iv_eo_pct drop not null,
  alter column ahv_iv_eo_pct drop default,
  alter column alv_pct drop not null,
  alter column alv_pct drop default,
  alter column nbu_pct drop not null,
  alter column nbu_pct drop default,
  alter column bvg_pct drop not null,
  alter column bvg_pct drop default,
  alter column ktg_pct drop not null,
  alter column ktg_pct drop default,
  alter column quellensteuer_pct drop not null,
  alter column quellensteuer_pct drop default;
