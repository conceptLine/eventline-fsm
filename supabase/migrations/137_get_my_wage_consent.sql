-- Self-View RPC fuer Lohndokumente-Consent-State.
-- Vorher las das Frontend direkt profiles.lohndokumente_digital_accepted_*
-- via .from('profiles').select(...).eq('id', auth.uid()) — Self-RLS deckt
-- das ab, aber Pattern-Konvention ist Profile-Reads ueber RPC.

create or replace function public.get_my_wage_consent()
returns table (accepted_at timestamptz, accepted_version text)
language sql
stable
security definer
set search_path = public
as $$
  select lohndokumente_digital_accepted_at, lohndokumente_digital_accepted_version
  from public.profiles
  where id = auth.uid()
$$;

grant execute on function public.get_my_wage_consent() to authenticated;
