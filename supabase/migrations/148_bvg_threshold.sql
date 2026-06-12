-- BVG-Eintrittsschwelle (CHF/Monat).
--
-- Schweizer BVG-Eintrittsschwelle 2026 = 22'050 CHF/Jahr = 1'837.50/Monat.
-- Default 1890 = leicht hoeherer Cap mit Sicherheitspuffer fuer
-- Schwankungen + Sozialleistungen, vom User explizit gewuenscht.
--
-- Wert wird im HR-Tab 'BVG-Monitor' fuer Forecast-Berechnung und bei
-- Termin-Anlage als Warn-Schwelle gelesen.

alter table public.app_settings
  add column if not exists bvg_threshold_chf numeric(10,2) not null default 1890.00;

-- Seed-Row falls noch keine existiert
insert into public.app_settings (id) values (1)
on conflict (id) do nothing;
