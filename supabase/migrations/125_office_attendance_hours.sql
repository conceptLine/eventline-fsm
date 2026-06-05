-- Anwesenheit pro Tag bekommt Zeit-Range (auf Stunden gerundet).
-- start_hour 0..23 = wann komme ich ins Büro, end_hour 1..24 = wann gehe ich.
-- Beide nullable um Bestand zu erhalten (alte Rows ohne Zeit zeigt das
-- Widget als Haekchen, neue Rows kommen via Modal immer mit Zeit).
alter table public.office_attendance
  add column if not exists start_hour smallint
    check (start_hour is null or (start_hour >= 0 and start_hour <= 23)),
  add column if not exists end_hour smallint
    check (end_hour is null or (end_hour >= 1 and end_hour <= 24));

-- Wenn beide gesetzt sind muss end > start sein — sonst ist die Range
-- leer oder negativ und das Display zeigt Bloedsinn.
alter table public.office_attendance
  drop constraint if exists office_attendance_hours_order;
alter table public.office_attendance
  add constraint office_attendance_hours_order
  check (
    start_hour is null
    or end_hour is null
    or end_hour > start_hour
  );

-- UPDATE-Policy noetig fuer upsert(onConflict): wenn Row existiert,
-- macht upsert intern ein UPDATE. Vorher gab's nur INSERT/DELETE-Policies,
-- d.h. das Zeit-Editieren auf bestehende Anwesenheit haette gestreikt.
drop policy if exists "anwesenheit_update_own" on public.office_attendance;
create policy "anwesenheit_update_own"
  on public.office_attendance
  for update
  using (user_id = auth.uid() and has_permission('anwesenheit:view'))
  with check (user_id = auth.uid() and has_permission('anwesenheit:view'));
