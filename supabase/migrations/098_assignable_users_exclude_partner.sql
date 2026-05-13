-- get_assignable_users() liefert die "öffentlichen" Profile für alle
-- Assignee-Dropdowns im Firmenportal (Termin-Zuweisung, Auftrag-Zuweisung,
-- Stempelzeiten-Filter, Todos, Tickets-Approver etc.).
--
-- Bisher: alle aktiven Profile inkl. role='partner'. Locationspartner
-- tauchten dadurch in Firmenportal-Pickern auf — strikt unerwünscht,
-- weil die zwei Welten getrennt sind (siehe /einstellungen Haupt-Tabs
-- Firmenportal vs Partnerportal).
--
-- Jetzt: zusätzlicher Filter role <> 'partner'. Partner-User existieren
-- weiterhin in profiles, werden aber nicht mehr als auswählbar
-- ausgespielt.

create or replace function public.get_assignable_users()
returns table (
  id uuid,
  full_name text,
  role text,
  is_active boolean,
  avatar_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select id, full_name, role, is_active, avatar_url
  from public.profiles
  where is_active = true
    and role <> 'partner'
  order by full_name;
$$;
