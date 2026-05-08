-- Vertrieb-Leads bekommen einen "Zustaendigen" — bisher hatten alle Leads
-- keine explizite Zuordnung; Leo und Mischa muessen aber unterscheiden
-- koennen wer welchen Lead bearbeitet.
--
-- assigned_to ist nullable — Bestand bleibt initial unzugewiesen, neue Leads
-- werden via UI zugewiesen (Toggle Leo/Mischa auf der Lead-Card). FK auf
-- profiles.id mit ON DELETE SET NULL: wenn ein User geloescht wird (z.B.
-- weil er die Firma verlaesst), bleiben die Leads erhalten und werden zu
-- "unzugewiesen".

alter table public.vertrieb_contacts
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

-- Index fuer Filter "meine Leads" (assigned_to = auth.uid()).
create index if not exists vertrieb_contacts_assigned_to_idx
  on public.vertrieb_contacts(assigned_to);
