-- Permission-Cleanup: budget:view-actuals droppen.
--
-- War urspruenglich fuer die Bexio-Ist-Anzeige gedacht (sensible Finanz-
-- Aggregate). Mit dem Bexio-Decoupling (Migration 119) wurde die Ist-
-- Spalte komplett aus der UI entfernt — der Permission-Slug ist tot.
--
-- Manuelles Update der Admin-Rolle ist via Migration nicht ganz "rein"
-- idempotent (jsonb-Mutation), aber die letzte SQL hat schon das Live-
-- Update gemacht. Hier nur als History-Eintrag dass der Slug bewusst
-- raus ist, damit kuenftige Audits den Trail finden.

update public.roles
set permissions = coalesce(permissions, '[]'::jsonb) - 'budget:view-actuals'
where permissions ? 'budget:view-actuals';
