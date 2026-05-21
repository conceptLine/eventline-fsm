-- Pro-Mitarbeiter-Loehne — ersetzt den fruehen Ansatz mit globalem
-- Vollkostensatz (28.04 CHF/h hardcodet). Jeder Mitarbeiter hat
-- jetzt eigene Brutto- + Arbeitgeber-Anteile, das Budget-Auto rechnet
-- damit genauer. Lohn-History (effective_from/to) ist von Anfang an im
-- Schema, damit Lohnerhoehungen rueckwirkend korrekt aggregiert werden.
--
-- Sichtbarkeit:
--   • Tabelle: nur lohn:manage darf SELECT — User sehen ihren eigenen
--     Datensatz NICHT direkt aus der Tabelle (auch wenn er sie betrifft).
--   • Self-View: SECURITY-DEFINER-RPC get_my_compensation() liefert nur
--     hourly_wage_chf + effective_from/to (KEIN employer_costs).
--     So sieht der Mitarbeiter "mein Lohn ist X CHF/h", aber niemals
--     was die Firma zusaetzlich zahlt.
--
-- Permission-Modell:
--   lohn:manage — alle CRUD-Operationen + employer_costs sehen.
--   Admin laeuft via has_permission() automatisch durch (NIE explizit
--   in JS oder SQL gegen 'admin' pruefen — Memory-Regel).

-- === 1. Tabelle ===

create table public.employee_compensation (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,

  -- Brutto-Stundenlohn (was im Lohnausweis steht). Sieht der Mitarbeiter.
  hourly_wage_chf numeric(8, 2) not null,

  -- Arbeitgeber-Anteil pro Stunde: Sozialleistungen (AHV/BVG/UVG/FAK)
  -- + ggf. Spesen-Pauschale. Sieht der Mitarbeiter NICHT.
  employer_costs_chf_per_hour numeric(8, 2) not null default 0,

  -- Gueltigkeits-Fenster fuer Historie. effective_to=NULL = aktueller
  -- Datensatz. Bei Lohnerhoehung wird der alte mit effective_to=Datum
  -- geschlossen und ein neuer mit effective_from=Datum angelegt.
  effective_from date not null default current_date,
  effective_to date,
  notes text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint emp_comp_range_valid check (effective_to is null or effective_to >= effective_from)
);

create index emp_comp_profile_idx on public.employee_compensation(profile_id);
create index emp_comp_effective_idx on public.employee_compensation(profile_id, effective_from desc);

create trigger emp_comp_updated_at
  before update on public.employee_compensation
  for each row execute function public.update_updated_at();

-- === 2. RLS ===
-- Streng: nur lohn:manage. User sehen via RPC, nicht direkt.

alter table public.employee_compensation enable row level security;

create policy "emp_comp_select" on public.employee_compensation for select to authenticated
  using (public.has_permission('lohn:manage'));
create policy "emp_comp_insert" on public.employee_compensation for insert to authenticated
  with check (public.has_permission('lohn:manage'));
create policy "emp_comp_update" on public.employee_compensation for update to authenticated
  using (public.has_permission('lohn:manage'));
create policy "emp_comp_delete" on public.employee_compensation for delete to authenticated
  using (public.has_permission('lohn:manage'));

-- === 3. Self-View-RPC ===
-- Liefert NUR Brutto-Felder fuer den eingeloggten User. employer_costs
-- ist in der Return-Signatur nicht enthalten — auch wenn jemand die
-- Function reverse-engineered, bekommt er den Wert nicht.

create or replace function public.get_my_compensation()
returns table(
  hourly_wage_chf numeric(8, 2),
  effective_from date,
  effective_to date,
  notes text
)
language sql
security definer
set search_path = public
stable
as $$
  select hourly_wage_chf, effective_from, effective_to, notes
  from public.employee_compensation
  where profile_id = auth.uid()
    and effective_from <= current_date
    and (effective_to is null or effective_to >= current_date)
  order by effective_from desc
  limit 1;
$$;

grant execute on function public.get_my_compensation() to authenticated;

-- === 4. Admin-Rolle bekommt neue Permission ===
update public.roles
set permissions = (
  coalesce(permissions, '[]'::jsonb) - 'lohn:manage'
) || '["lohn:manage"]'::jsonb
where slug = 'admin';
