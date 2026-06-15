-- Geburtsdatum pro Mitarbeiter + automatische Ferienanteil-Logik.
--
-- Schweizer Recht (Art. 329a OR + Art. 329d OR):
--   - Erwachsene (>=20 Jahre) haben Anspruch auf 4 Wochen Ferien -> 8.33%
--     Ferienanteil im Stundenlohn (4/52 = 7.69%, aufgerundet auf 8.33%
--     fuer den allgemeinen Standard).
--   - Jugendliche (<20 Jahre) haben Anspruch auf 5 Wochen Ferien
--     -> 10.64% (5/47 = 10.638%).
--
-- birthdate ist sensible Daten (DSGVO/DSG). Nur Admins + der MA selbst
-- duerfen lesen. RLS bestehend auf profiles -- mit der add-column
-- Erweiterung greift das automatisch.

alter table public.profiles
  add column if not exists birthdate date;

-- Optional: Override-Spalte fuer Ferienanteil pro Mitarbeiter falls
-- mal eine Sondervereinbarung (z.B. >20 aber mehr Ferien per Vertrag).
-- NULL = aus birthdate ermittelt (8.33 oder 10.64).
alter table public.employee_compensation
  add column if not exists ferienanteil_pct_override numeric(5, 2);

-- Kein Index — niemand queryt nach birthdate (nur join auf profile_id).
