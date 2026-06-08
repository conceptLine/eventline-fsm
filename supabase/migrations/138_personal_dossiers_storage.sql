-- Personal-Dossiers Storage-Bucket Lockdown.
--
-- Bucket `personal-dossiers` enthaelt komplette Datenpakete (ZIPs)
-- pro geloeschtem Mitarbeiter — alle Jobs, Stempel, Rapporte, Wage-
-- Documents, Notizen als JSON + PDFs. Nur Admins duerfen darauf
-- zugreifen, und auch nur ueber die API (signed URLs). Direkter
-- Storage-Zugriff von authenticated/anon ist geblockt — selbst Admins
-- muessen die API nutzen damit Audit-Trail moeglich ist (zukuenftig
-- koennten Dossier-Downloads geloggt werden).

drop policy if exists "personal_dossiers_no_direct_access_select" on storage.objects;
create policy "personal_dossiers_no_direct_access_select" on storage.objects
  for select to authenticated, anon
  using (bucket_id <> 'personal-dossiers');

drop policy if exists "personal_dossiers_no_direct_access_insert" on storage.objects;
create policy "personal_dossiers_no_direct_access_insert" on storage.objects
  for insert to authenticated, anon
  with check (bucket_id <> 'personal-dossiers');

drop policy if exists "personal_dossiers_no_direct_access_update" on storage.objects;
create policy "personal_dossiers_no_direct_access_update" on storage.objects
  for update to authenticated, anon
  using (bucket_id <> 'personal-dossiers')
  with check (bucket_id <> 'personal-dossiers');

drop policy if exists "personal_dossiers_no_direct_access_delete" on storage.objects;
create policy "personal_dossiers_no_direct_access_delete" on storage.objects
  for delete to authenticated, anon
  using (bucket_id <> 'personal-dossiers');
