-- Mein-Konto-Onboarding (V1) — Welcome-Modal + Sidebar-Badge.
--
-- Beim naechsten Login sieht der User ein einmaliges Welcome-Modal
-- das die neue Mein-Konto-Seite vorstellt; zusaetzlich pulsiert ein
-- roter Dot neben dem Mein-Konto-Eintrag im Sidebar bis er das erste
-- Mal die Seite besucht hat.
--
-- Zwei separate Flags weil:
--   - Modal-Dismiss bedeutet nicht "Seite besucht" (User klickt evtl.
--     direkt 'Verstanden' ohne hinzunavigieren)
--   - Badge soll als visueller Anker bleiben bis tatsaechlich besucht

alter table public.profiles
  add column if not exists mein_konto_intro_dismissed_at timestamptz,
  add column if not exists mein_konto_first_visited_at timestamptz;

-- Self-View-RPC analog zu get_my_wage_consent — Profile-Reads gehen
-- via SECURITY-DEFINER-RPC, nicht direkt ueber die profiles-Tabelle.
create or replace function public.get_my_mein_konto_onboarding()
returns table (
  intro_dismissed_at timestamptz,
  first_visited_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select mein_konto_intro_dismissed_at, mein_konto_first_visited_at
  from public.profiles
  where id = auth.uid()
$$;

grant execute on function public.get_my_mein_konto_onboarding() to authenticated;
