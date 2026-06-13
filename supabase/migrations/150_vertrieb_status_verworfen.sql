-- Neuer Lead-Status 'verworfen' (= Lead nie kontaktiert + nicht weiter
-- verfolgt). Geht ins Archiv wie gewonnen/abgesagt, bleibt fuer Audit
-- erhalten. Unterscheidet sich von 'abgesagt' (= Kunde hat unser Angebot
-- abgesagt) weil hier die Sales-Seite den Lead aus eigener Initiative
-- aussortiert hat, ohne je Kontakt aufgenommen zu haben.

alter table public.vertrieb_contacts
  drop constraint if exists vertrieb_contacts_status_check;

alter table public.vertrieb_contacts
  add constraint vertrieb_contacts_status_check
  check (status in ('offen', 'kontaktiert', 'gespraech', 'gewonnen', 'abgesagt', 'verworfen'));

-- Counts-View aktualisieren: verworfen muss aus Step-1..4-Filter raus
-- (war vorher implizit drin, jetzt explizit ausschliessen wie 'gewonnen'/
-- 'abgesagt'). DROP-Create weil columns sich aendern (neue Spalte
-- 'verworfen') -- create-or-replace toleriert nur additive returns.
-- War in 072 als materialized view angelegt (offenbar manuell konvertiert),
-- daher drop materialized.
drop materialized view if exists public.vertrieb_counts;
create view public.vertrieb_counts
with (security_invoker = on) as
select
  count(*)::int                                                             as total,
  count(*) filter (where status = 'offen')::int                             as offen,
  count(*) filter (where status = 'kontaktiert')::int                       as kontaktiert,
  count(*) filter (where status = 'gespraech')::int                         as gespraech,
  count(*) filter (where status = 'gewonnen')::int                          as gewonnen,
  count(*) filter (where status = 'abgesagt')::int                          as abgesagt,
  count(*) filter (where status = 'verworfen')::int                         as verworfen,
  count(*) filter (
    where coalesce(step, 1) = 1 and status not in ('gewonnen', 'abgesagt', 'verworfen')
  )::int as step_1,
  count(*) filter (
    where coalesce(step, 1) = 2 and status not in ('gewonnen', 'abgesagt', 'verworfen')
  )::int as step_2,
  count(*) filter (
    where coalesce(step, 1) = 3 and status not in ('gewonnen', 'abgesagt', 'verworfen')
  )::int as step_3,
  count(*) filter (
    where coalesce(step, 1) = 4 and status not in ('gewonnen', 'abgesagt', 'verworfen')
  )::int as step_4
from public.vertrieb_contacts;

grant select on public.vertrieb_counts to authenticated;
