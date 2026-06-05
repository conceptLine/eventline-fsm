-- Büro-Anwesenheit pro User pro Tag.
--
-- Use-Case: jeder mit Permission 'anwesenheit:view' kann auf dem Dashboard
-- in einem Wochen-Grid eintragen wenn er an einem Tag im Büro ist und
-- sieht wer noch da ist. Hilft Sales/Backoffice fuer Lunch-Planung und
-- "wer ist heute erreichbar"-Sicht.
--
-- Existence der Row = "im Buero". Toggle = INSERT oder DELETE. Eine zweite
-- Spalte present BOOL wäre unnoetig — Abwesenheit ist die Default-Annahme.
--
-- Ferien/Krank/Frei werden separat in time_off gepflegt; die Anwesenheits-
-- Liste ist nur "ich plane heute reinzukommen", losgeloest vom HR-Workflow.

create table if not exists public.office_attendance (
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  marked_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- Range-Queries nach Datum (Wochen-Slice) brauchen einen Index neben dem
-- (user_id, date)-PK.
create index if not exists office_attendance_date_idx
  on public.office_attendance (date);

alter table public.office_attendance enable row level security;

-- SELECT: alle die das Modul sehen duerfen, sehen alle Eintraege.
-- Kein per-User-Filter, weil das Widget alle Mitarbeiter zeigt.
create policy "anwesenheit_select"
  on public.office_attendance
  for select
  using (has_permission('anwesenheit:view'));

-- INSERT: nur eigene Anwesenheit eintragen, und auch nur wenn Permission
-- vorhanden — sonst kann jemand ohne sichtbaren Grid Eintraege schaffen.
create policy "anwesenheit_insert_own"
  on public.office_attendance
  for insert
  with check (
    user_id = auth.uid()
    and has_permission('anwesenheit:view')
  );

-- DELETE: nur eigene Eintraege loeschen koennen (= sich selbst austragen).
-- Admin kann via has_permission('anwesenheit:view') trotzdem alles, weil
-- in has_permission() admin-Bypass eingebaut ist.
create policy "anwesenheit_delete_own"
  on public.office_attendance
  for delete
  using (
    (user_id = auth.uid() or public.is_admin())
    and has_permission('anwesenheit:view')
  );
