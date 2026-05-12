-- Partner darf eigene Anfragen zurueckziehen (= DELETE).
--
-- Migration 096 hat fuer Partner INSERT + UPDATE-Policies angelegt, aber
-- KEINE DELETE. Postgres rejected DELETE-Operationen ohne passende Policy
-- silently (kein Error, 0 rows affected) — der Client meldete "Anfrage
-- geloescht" obwohl nichts gelöscht wurde.
--
-- Bedingung: Status MUSS noch 'partner_anfrage' sein (also nicht bereits
-- angenommen/abgelehnt) UND der Partner war der Ersteller (created_by =
-- auth.uid()).

DROP POLICY IF EXISTS "jobs_delete_partner" ON public.jobs;
CREATE POLICY "jobs_delete_partner" ON public.jobs
  FOR DELETE TO authenticated
  USING (
    public.is_admin_or_lead()
    OR (
      status = 'partner_anfrage'
      AND created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'partner'
      )
    )
  );

-- Documents-DELETE-Policy fuer Partner: damit das Loeschen der Anfrage
-- die mit-hochgeladenen Anhaenge nicht stehen laesst. Gleiche
-- Beschraenkung: nur eigene Documents an eigenen partner_anfrage-Jobs.
DROP POLICY IF EXISTS "documents_delete_partner" ON public.documents;
CREATE POLICY "documents_delete_partner" ON public.documents
  FOR DELETE TO authenticated
  USING (
    public.is_admin_or_lead()
    OR (
      uploaded_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.jobs j
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE j.id = documents.job_id
          AND j.status = 'partner_anfrage'
          AND p.role = 'partner'
      )
    )
  );

-- Documents-INSERT-Policy: Partner darf Anhaenge an seine eigenen
-- partner_anfrage-Jobs anlegen. War in 096 vergessen.
DROP POLICY IF EXISTS "documents_insert_partner" ON public.documents;
CREATE POLICY "documents_insert_partner" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin_or_lead()
    OR (
      uploaded_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.jobs j
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE j.id = documents.job_id
          AND j.status = 'partner_anfrage'
          AND p.role = 'partner'
      )
    )
  );
