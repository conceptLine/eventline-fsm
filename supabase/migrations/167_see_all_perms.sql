-- 'see-all' / 'edit-all'-Permissions fuer owner-only-Tabellen.
--
-- Bisher war fuer todos + time_entries die Sicht streng: nur eigene
-- (created_by / user_id) plus is_admin() Bypass. Damit konnte niemand
-- ausser Admin allen Mitarbeitern bei den Stempelzeiten oder allen
-- Todos zuschauen, ohne gleich volle Admin-Rechte zu bekommen.
--
-- Jetzt: pro Modul gibt es 'see-all' (sieht alle Datensaetze) und
-- 'edit-all' (darf alle bearbeiten/loeschen). Owner-Rechte bleiben
-- unveraendert. Die Permissions koennen ueber die Rollen-Matrix
-- gezielt vergeben werden (z.B. an HR-Verantwortliche).

-- ─────── todos ───────

drop policy if exists "Eigene Todos sichtbar" on public.todos;
create policy "todos_select" on public.todos
  for select
  using (
    created_by = auth.uid()
    or assigned_to = auth.uid()
    or is_admin()
    or has_permission('todos:see-all')
  );

drop policy if exists "Eigene Todos bearbeiten" on public.todos;
create policy "todos_update" on public.todos
  for update
  using (
    created_by = auth.uid()
    or assigned_to = auth.uid()
    or is_admin()
    or has_permission('todos:edit-all')
  );

drop policy if exists "Eigene Todos loeschen" on public.todos;
create policy "todos_delete" on public.todos
  for delete
  using (
    created_by = auth.uid()
    or is_admin()
    or has_permission('todos:edit-all')
  );

-- ─────── time_entries (Stempelzeiten) ───────

drop policy if exists "time_entries_select_own" on public.time_entries;
create policy "time_entries_select" on public.time_entries
  for select
  using (
    user_id = auth.uid()
    or is_admin()
    or has_permission('stempelzeiten:see-all')
  );

drop policy if exists "time_entries_update_own" on public.time_entries;
create policy "time_entries_update" on public.time_entries
  for update
  using (
    user_id = auth.uid()
    or is_admin()
    or has_permission('stempelzeiten:edit-all')
  );

drop policy if exists "time_entries_delete_own" on public.time_entries;
create policy "time_entries_delete" on public.time_entries
  for delete
  using (
    user_id = auth.uid()
    or is_admin()
    or has_permission('stempelzeiten:edit-all')
  );
