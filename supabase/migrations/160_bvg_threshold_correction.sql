-- BVG-Eintrittsschwelle: Korrektur des Default-Werts.
--
-- Frueher hatten wir Default 1890 mit der falschen Annahme "leicht ueber
-- der Schwelle als Sicherheitspuffer". Das ist umgekehrt-falsch: bei
-- Schwelle 1890 wuerde das System einen MA mit Brutto 1850 als "noch ok"
-- markieren, obwohl er gesetzlich bei >1837.50 schon BVG-pflichtig ist.
--
-- Korrekt: Schwelle = das gesetzliche Limit 1837.50 selber. Der Warn-
-- Puffer entsteht durch die 95%-Crit-Trigger-Logik im UI (= bei
-- ~1745 CHF startet Crit-Status, damit der Admin REAGIEREN kann bevor
-- der MA tatsaechlich BVG-pflichtig wird).
--
-- Quelle: BVV2 Art. 5 i.V.m. AHV-Maximalrente 2026:
--   Jahres-Schwelle = 22'050 CHF
--   Monats-Schwelle = 22'050 / 12 = 1'837.50 CHF/Monat
--
-- Migration setzt sowohl den Column-Default fuer kuenftige Inserts als
-- auch den bestehenden Singleton-Row-Wert.

alter table public.app_settings
  alter column bvg_threshold_chf set default 1837.50;

-- Bestehenden Wert aktualisieren, ABER nur wenn er noch auf dem alten
-- Default 1890 steht. Falls der Admin den manuell auf z.B. 1700
-- (eigener Sicherheitspuffer) gesetzt hat, lassen wir das in Ruhe.
update public.app_settings
set bvg_threshold_chf = 1837.50
where id = 1
  and bvg_threshold_chf = 1890.00;
