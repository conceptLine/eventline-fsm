-- Tabelle `partners` (= Catering/Technik/AV/etc. — externe Firmen die wir
-- fuer Jobs einkaufen) wird in `lieferanten` umbenannt.
--
-- Grund: Naming-Kollision mit dem Partner-Portal-Konzept (Locationspartner,
-- die Anfragen an uns senden). "Partner" ist app-weit reserviert fuer die
-- Locationspartner-Welt. Catering/Technik-Anbieter sind in der DACH-
-- Buchhaltungssprache (und in Bexio, wo wir sie sowieso fuehren) sauber
-- "Lieferanten" — Kreditoren-Seite, egal ob Ware oder Dienstleistung.
--
-- Effekte:
--   - Tabelle, Indexes, Sequences werden umbenannt (alle FK-Beziehungen
--     bleiben automatisch dran haengen — Postgres hat keine FKs auf
--     partners gefunden, aber ALTER TABLE RENAME handhabt sowas eh sauber).
--   - RLS-Policies werden mit umgezogen und neu benannt.
--   - Permission-Strings in public.roles.permissions: 'partner:*' wird zu
--     'lieferanten:*' aktualisiert (admin/team-leiter/techniker betroffen).
--     'partner-anfragen:*' und 'partner-belegungsplan:*' bleiben unberuehrt
--     — die gehoeren zum Partnerportal-Namespace.
--
-- Idempotent: prueft ob umzubenennende Objekte bereits existieren bevor
-- es renamed (relevant fuer dev-Reapplies — produktion ist Single-Apply).

DO $$
BEGIN
  -- Tabelle
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='partners')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='lieferanten') THEN
    ALTER TABLE public.partners RENAME TO lieferanten;
  END IF;

  -- Primary-Key-Constraint (heisst nach Table-Rename noch partners_pkey)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='partners_pkey') THEN
    ALTER TABLE public.lieferanten RENAME CONSTRAINT partners_pkey TO lieferanten_pkey;
  END IF;

  -- Indexes
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='partners_type_idx') THEN
    ALTER INDEX public.partners_type_idx RENAME TO lieferanten_type_idx;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='partners_name_idx') THEN
    ALTER INDEX public.partners_name_idx RENAME TO lieferanten_name_idx;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='partners_name_trgm_idx') THEN
    ALTER INDEX public.partners_name_trgm_idx RENAME TO lieferanten_name_trgm_idx;
  END IF;
END $$;

-- RLS-Policies neu anlegen mit neuem Namen + Tabelle.
-- Alte Policies droppen (mit IF EXISTS, falls Rerun).
DROP POLICY IF EXISTS "Partner sehen" ON public.lieferanten;
DROP POLICY IF EXISTS "Partner anlegen" ON public.lieferanten;
DROP POLICY IF EXISTS "Partner bearbeiten" ON public.lieferanten;
DROP POLICY IF EXISTS "Partner löschen" ON public.lieferanten;
DROP POLICY IF EXISTS "Lieferanten sehen" ON public.lieferanten;
DROP POLICY IF EXISTS "Lieferanten anlegen" ON public.lieferanten;
DROP POLICY IF EXISTS "Lieferanten bearbeiten" ON public.lieferanten;
DROP POLICY IF EXISTS "Lieferanten löschen" ON public.lieferanten;

-- Permission-Slugs angepasst: partner:* → lieferanten:*
CREATE POLICY "Lieferanten sehen" ON public.lieferanten
  FOR SELECT TO authenticated
  USING (has_permission('lieferanten:view'));

CREATE POLICY "Lieferanten anlegen" ON public.lieferanten
  FOR INSERT TO authenticated
  WITH CHECK (has_permission('lieferanten:create'));

CREATE POLICY "Lieferanten bearbeiten" ON public.lieferanten
  FOR UPDATE TO authenticated
  USING (has_permission('lieferanten:edit'))
  WITH CHECK (has_permission('lieferanten:edit'));

CREATE POLICY "Lieferanten löschen" ON public.lieferanten
  FOR DELETE TO authenticated
  USING (has_permission('lieferanten:delete'));

-- Bestehende Rollen umschreiben: jedes 'partner:<action>'-Element in
-- permissions wird zu 'lieferanten:<action>'. 'partner-anfragen:*' und
-- 'partner-belegungsplan:*' (Partnerportal-Namespace) bleiben unangetastet
-- — der LIKE-Filter matcht nur exakt 'partner:'-Prefix.
UPDATE public.roles
SET permissions = (
  SELECT jsonb_agg(
    CASE
      WHEN value::text LIKE '"partner:%'
        THEN to_jsonb('lieferanten:' || split_part(trim('"' FROM value::text), ':', 2))
      ELSE value
    END
  )
  FROM jsonb_array_elements(permissions) AS value
)
WHERE permissions::text LIKE '%"partner:%';
