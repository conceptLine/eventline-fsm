-- Stempelnummer pro time_entries-Zeile.
--
-- Bisher hatten Stempeleintraege keine menschen-lesbare ID. Jetzt:
-- monotone auto-inkrementierte Nummer (STM-00001, STM-00002, ...) damit
-- Stunden + Stempelvorgaenge nachverfolgbar sind.
--
-- Backfill in created_at-Reihenfolge, dann sequence-default fuer alle
-- neuen Inserts. NOT NULL + UNIQUE damit nichts durchrutscht.

alter table public.time_entries add column if not exists entry_number bigint;

do $$
declare
  rec record;
  n bigint := 0;
begin
  for rec in
    select id from public.time_entries
    where entry_number is null
    order by created_at nulls last, id
  loop
    n := n + 1;
    update public.time_entries set entry_number = n where id = rec.id;
  end loop;
end $$;

create sequence if not exists time_entries_entry_number_seq;
select setval(
  'time_entries_entry_number_seq',
  greatest(1, (select coalesce(max(entry_number), 0) from public.time_entries))
);
alter table public.time_entries
  alter column entry_number set default nextval('time_entries_entry_number_seq'::regclass);
alter table public.time_entries
  alter column entry_number set not null;

-- Sequence "owns" der Spalte → wird automatisch gedroppt wenn die Spalte gedroppt wird
alter sequence time_entries_entry_number_seq owned by public.time_entries.entry_number;

create unique index if not exists time_entries_entry_number_unique
  on public.time_entries (entry_number);
