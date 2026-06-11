-- Rollen-Permissions-Audit (Phase 2)
--
-- Audit-Ergebnis aus 2026-06-11:
--
-- team-leiter (19 Permissions): solides Set fuer operative Fuehrung.
-- Aber fehlen:
--   - ferien:approve  -> Team-Leiter sollte Anträge genehmigen koennen
--                        (sonst muss immer Admin ran)
--   - tickets:manage  -> Team-Leiter sollte Tickets bearbeiten/schliessen
--                        (heute kann er sie nur sehen + neue erstellen)
--   - anwesenheit:view -> Buero-Anwesenheits-Grid auf Dashboard
--
-- techniker / temporar / vertrieb: anwesenheit:view fehlt bei allen
--   -> Dashboard-Widget fehlt bei diesen Rollen. Wird hinzugefuegt.
--
-- Andere Rollen (admin, partner) wurden NICHT geaendert:
--   - admin: hat hardcoded-Bypass im Code (role === 'admin' return true)
--   - partner: separates Subsystem (partner-*-Permissions)
--
-- Alle Migrations-Operations sind idempotent via @>-Check.

-- team-leiter: 3 fehlende Permissions
update public.roles
set permissions = permissions || '["ferien:approve"]'::jsonb
where slug = 'team-leiter'
  and not (permissions @> '["ferien:approve"]'::jsonb);

update public.roles
set permissions = permissions || '["tickets:manage"]'::jsonb
where slug = 'team-leiter'
  and not (permissions @> '["tickets:manage"]'::jsonb);

-- anwesenheit:view fuer team-leiter, techniker, temporar, vertrieb
update public.roles
set permissions = permissions || '["anwesenheit:view"]'::jsonb
where slug in ('team-leiter', 'techniker', 'temporar', 'vertrieb')
  and not (permissions @> '["anwesenheit:view"]'::jsonb);
