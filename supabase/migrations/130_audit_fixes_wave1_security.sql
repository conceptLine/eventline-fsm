-- Audit Wave 1: Security + Data-Integrity-Fixes.
--
-- 1. partner_form_template SELECT: Partner sahen ALLE Templates (auch
--    Overrides anderer Locations). Jetzt: Partner sieht NUR globale
--    Templates ODER sein eigenes Location-Override.
--
-- 2. employee_compensation: kein Unique-Constraint auf "aktuelle Zeile"
--    pro Profile. Zwei gleichzeitige Lohn-Edits konnten zwei aktive
--    Zeilen erzeugen (race im POST). Partial Unique Index fixt das.

-- 1) partner_form_template SELECT-Policy verschaerfen
drop policy if exists "partner_form_template_select" on public.partner_form_template;
create policy "partner_form_template_select"
  on public.partner_form_template
  for select
  using (
    public.is_admin_or_lead()
    or (
      scope = 'global'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'partner'
      )
    )
    or (
      scope = 'location'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role = 'partner'
          and p.partner_location_id = partner_form_template.location_id
      )
    )
  );

-- 2) employee_compensation: max 1 aktive Lohn-Zeile pro Mitarbeiter
create unique index if not exists emp_comp_one_active_per_profile
  on public.employee_compensation (profile_id)
  where effective_to is null;
