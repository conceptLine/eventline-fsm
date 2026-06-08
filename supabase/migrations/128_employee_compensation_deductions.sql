-- Lohnbuchhaltungs-Abzuege pro Mitarbeiter.
--
-- Bisher hatte employee_compensation nur Brutto + AG-Anteil-Summe. Fuer
-- die Lohnabrechnung brauchen wir die Mitarbeiter-Abzuege im Detail
-- (alle als Prozent vom Brutto). Defaults entsprechen Schweizer Standard
-- 2026:
--   AHV/IV/EO  5.3%  (gesetzlich fix)
--   ALV        1.1%  (gesetzlich fix, bis CHF 148'200/Jahr Cap)
--   NBU        1.4%  (Unfall-Nichtbetrieb, variiert pro Vertrag)
--   BVG        0%    (Pensionskasse, altersabhaengig 7-18%; pro Mitarb. setzen)
--   KTG        0%    (Krankentaggeld, optional pro Arbeitgeber)
--   Quellensteuer 0% (nur bei nicht-Schweizer ohne C-Bewilligung)
--
-- Netto pro Stunde = Brutto × (1 - Summe-aller-Abzuege/100). UI rechnet das.

alter table public.employee_compensation
  add column if not exists ahv_iv_eo_pct numeric(5, 2) not null default 5.3,
  add column if not exists alv_pct numeric(5, 2) not null default 1.1,
  add column if not exists nbu_pct numeric(5, 2) not null default 1.4,
  add column if not exists bvg_pct numeric(5, 2) not null default 0,
  add column if not exists ktg_pct numeric(5, 2) not null default 0,
  add column if not exists quellensteuer_pct numeric(5, 2) not null default 0;
