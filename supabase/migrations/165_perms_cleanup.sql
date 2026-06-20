-- Permission-System-Cleanup (Phase 1).
--
-- 1. Nur 'admin' bleibt system-geschuetzt — techniker + partner werden
--    bearbeitbar/loeschbar. Hintergrund: der User soll alle Rollen
--    flexibel anpassen koennen; admin bleibt zur Lockout-Praevention
--    geschuetzt (hardcoded is_admin()-Check baut darauf).
--
-- 2. Permission-Slug 'ferien:view' aufraeumen. Die Slug ist obsolet —
--    die Ferien-Seite ist always-allowed (jeder MA beantragt seine
--    eigenen Ferien), gesteuert via time_off-RLS auf user_id. Slug war
--    nirgends in Policies referenziert, fuehrte aber in der Rollen-
--    Matrix zu unnoetigen Toggles.

update public.roles
set is_system = false
where slug in ('techniker', 'partner');

-- ferien:view aus den permissions-Arrays aller Rollen entfernen (war
-- sinnlos drin). jsonb minus operator gibt's nicht direkt fuer Array-
-- Elemente, daher via element-Index-Filter neu bauen.
update public.roles
set permissions = (
  select coalesce(jsonb_agg(p), '[]'::jsonb)
  from jsonb_array_elements_text(permissions) p
  where p <> 'ferien:view'
)
where permissions @> '["ferien:view"]'::jsonb;
