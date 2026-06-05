-- get_anwesenheit_users — fuer das Office-Attendance-Widget auf dem Dashboard.
-- Liefert id+full_name aller aktiven Eventline-Mitarbeiter (role != partner)
-- die in ihrer Rollen-Definition 'anwesenheit:view' haben.
--
-- Begruendung fuer SECURITY DEFINER: profiles-RLS verbietet einem normalen
-- User direktes select(*) auf andere Profile-Rows. Diese RPC umgeht das
-- bewusst auf die schmal-projizierten Spalten id+full_name, und nur fuer
-- die User-Liste die im Anwesenheits-Widget eh angezeigt werden soll.

create or replace function public.get_anwesenheit_users()
returns table(id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name
  from public.profiles p
  join public.roles r on r.slug = p.role
  where p.is_active = true
    and p.role <> 'partner'
    and (
      p.role = 'admin'
      or r.permissions ? 'anwesenheit:view'
    )
  order by p.full_name;
$$;

grant execute on function public.get_anwesenheit_users() to authenticated;
