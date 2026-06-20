-- is_admin_or_lead() von Rollen-Namen-Hardcoding auf Permission-Check
-- umstellen. Damit ist der Begriff 'Lead' (= sieht alle Auftraege /
-- Termine, nicht nur eigene) NICHT mehr an die Rolle 'team-leiter'
-- gebunden — jede Rolle die die Permission 'auftraege:see-all' hat,
-- bekommt die erweiterte Sicht.
--
-- Hintergrund: vorher war 'team-leiter' als String hardcoded — wer
-- die Rolle umbenannt oder neu eingerichtet hat, hat die Funktion
-- gebrochen. Jetzt ist Lead-Funktion eine echte Permission.

create or replace function public.is_admin_or_lead()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or public.has_permission('auftraege:see-all');
$$;

-- Bestandsmigration: bisherige team-leiter-Rolle bekommt auftraege:see-all
-- damit ihre Funktion erhalten bleibt. Andere Rollen koennen ueber die
-- UI nachgezogen werden.
update public.roles
set permissions = permissions || '["auftraege:see-all"]'::jsonb
where slug = 'team-leiter'
  and not (permissions @> '["auftraege:see-all"]'::jsonb);
