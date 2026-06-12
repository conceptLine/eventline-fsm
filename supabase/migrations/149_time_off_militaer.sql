-- Neuer time_off-Typ: 'militaer' (Militaerdienst).
--
-- Schweizer Kontext: jeder Mann hat Wehrpflicht; WK/RS-Tage werden
-- als bezahlte Abwesenheit gefuehrt (kein Lohnabzug wenn der Arbeit-
-- geber einspringt). Eigener Typ damit es im Antrag-Picker auswaehl-
-- bar ist und in Auswertungen (z.B. Lohnabrechnung) sauber getrennt
-- bleibt von Ferien/Krank/Kompensation/Frei.

alter table public.time_off
  drop constraint if exists time_off_type_check;

alter table public.time_off
  add constraint time_off_type_check
  check (type in ('ferien', 'krank', 'kompensation', 'frei', 'militaer'));
