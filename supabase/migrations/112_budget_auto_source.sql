-- Auto-computed Budget-Kategorien:
--
-- Manche Kategorien werden aus internen Daten berechnet, nicht manuell
-- eingetragen oder aus Bexio gezogen. Beispiel: "Lohn" wird aus
-- job_appointments (Soll) + time_entries (Ist) mit konstantem
-- Vollkosten-Satz pro Stunde berechnet.
--
-- Die Berechnung selbst lebt in der Anwendung (/api/budget/internal-stats),
-- nicht in der DB — sie braucht Zugriff auf den Vollkosten-Satz und die
-- Eligibility-Logik (welche User zaehlen). Hier markieren wir nur welche
-- Kategorie auto-computed ist.

alter table public.budget_categories
  add column if not exists auto_source text;

comment on column public.budget_categories.auto_source is
  'NULL = manuelle Eingabe (default). Wenn gesetzt, wird Soll+Ist aus internen
   Daten berechnet. Aktuell unterstuetzt: ''internal_labor'' (Stunden * Vollkostensatz).';

-- Default-Lohn-Kategorie auf internal_labor setzen.
-- Idempotent — falls schon gesetzt, bleibt's gesetzt.
update public.budget_categories
set auto_source = 'internal_labor'
where name = 'Lohn'
  and parent_id in (
    select id from public.budget_categories where name = 'Personal' and parent_id is null
  );
