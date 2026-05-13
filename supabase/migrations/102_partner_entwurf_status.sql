-- Neuer Job-Status `partner_entwurf`: Partner-Anfrage in Vorbereitung —
-- noch nicht an EVENTLINE abgeschickt. Workflow:
--
--   partner_entwurf  (Partner pflegt, kein Termin oder noch nicht fertig)
--          │
--          │ Partner drueckt "Anfrage senden" (Termin Pflicht)
--          ▼
--   partner_anfrage  (Wartet auf EVENTLINE)
--          │
--          │ EVENTLINE bestaetigt
--          ▼
--        offen      (Bestaetigt, Team-Lead weist zu)
--
-- EVENTLINE sieht partner_entwurf NICHT im /auftraege-Workflow — diese
-- gehoeren komplett ins Partner-Portal. Erst wenn der Partner explizit
-- absendet (Status-Wechsel zu partner_anfrage), taucht die Anfrage auf
-- EVENTLINE-Seite zur Bestaetigung auf.

-- 1) Status-CHECK erweitern
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_status_check
  CHECK (status = ANY (ARRAY[
    'partner_entwurf'::text,
    'partner_anfrage'::text,
    'anfrage'::text,
    'entwurf'::text,
    'offen'::text,
    'abgeschlossen'::text,
    'storniert'::text
  ]));

-- 2) jobs_update_partner: auch partner_entwurf erlauben
DROP POLICY IF EXISTS "jobs_update_partner" ON public.jobs;
CREATE POLICY "jobs_update_partner" ON public.jobs
  FOR UPDATE TO authenticated
  USING (
    is_admin_or_lead()
    OR (
      status IN ('partner_anfrage', 'partner_entwurf')
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'partner'
          AND partner_location_id IS NOT NULL
          AND partner_location_id = jobs.location_id
      )
    )
  )
  WITH CHECK (
    is_admin_or_lead()
    OR (
      status IN ('partner_anfrage', 'partner_entwurf')
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'partner'
          AND partner_location_id IS NOT NULL
          AND partner_location_id = jobs.location_id
      )
    )
  );

-- 3) documents_insert_partner: status partner_entwurf zusaetzlich erlauben
DROP POLICY IF EXISTS "documents_insert_partner" ON public.documents;
CREATE POLICY "documents_insert_partner" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    is_admin_or_lead()
    OR (
      uploaded_by = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.jobs j
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE j.id = documents.job_id
          AND j.status IN ('partner_anfrage', 'partner_entwurf', 'offen')
          AND p.role = 'partner'
      )
    )
  );

-- 4) documents_delete_partner: Partner darf in Entwurf + offene-Anfrage-Phase
-- selbst hochgeladene Files loeschen. Nach Annahme (offen) NICHT mehr
-- damit EVENTLINE auf den Files arbeiten kann.
DROP POLICY IF EXISTS "documents_delete_partner" ON public.documents;
CREATE POLICY "documents_delete_partner" ON public.documents
  FOR DELETE TO authenticated
  USING (
    is_admin_or_lead()
    OR (
      uploaded_by = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.jobs j
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE j.id = documents.job_id
          AND j.status IN ('partner_anfrage', 'partner_entwurf')
          AND p.role = 'partner'
      )
    )
  );

-- 5) partner_update_notes RPC: auch partner_entwurf erlauben
CREATE OR REPLACE FUNCTION public.partner_update_notes(
  p_job_id uuid,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_caller_loc uuid;
  v_job_status text;
  v_job_creator uuid;
  v_job_location uuid;
BEGIN
  SELECT role, partner_location_id INTO v_caller_role, v_caller_loc
  FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'partner' THEN
    RAISE EXCEPTION 'forbidden: only partner role can call partner_update_notes';
  END IF;

  SELECT status, created_by, location_id
  INTO v_job_status, v_job_creator, v_job_location
  FROM public.jobs WHERE id = p_job_id;

  IF v_job_status IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF v_job_creator <> auth.uid()
     AND (v_caller_loc IS NULL OR v_caller_loc <> v_job_location) THEN
    RAISE EXCEPTION 'forbidden: not your job';
  END IF;

  IF v_job_status NOT IN ('partner_anfrage', 'partner_entwurf', 'offen') THEN
    RAISE EXCEPTION 'job not editable in status %', v_job_status;
  END IF;

  UPDATE public.jobs
  SET notes = NULLIF(trim(p_notes), '')
  WHERE id = p_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_update_notes(uuid, text) TO authenticated;

-- 6) RPC fuer "Anfrage senden" — partner_entwurf → partner_anfrage. Prueft
-- dass min. 1 Termin existiert (sonst sinnlos abzuschicken).
CREATE OR REPLACE FUNCTION public.partner_submit_anfrage(
  p_job_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_caller_loc uuid;
  v_job_status text;
  v_job_creator uuid;
  v_job_location uuid;
  v_termin_count int;
BEGIN
  SELECT role, partner_location_id INTO v_caller_role, v_caller_loc
  FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'partner' THEN
    RAISE EXCEPTION 'forbidden: only partner role can submit anfragen';
  END IF;

  SELECT status, created_by, location_id
  INTO v_job_status, v_job_creator, v_job_location
  FROM public.jobs WHERE id = p_job_id;

  IF v_job_status IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF v_job_creator <> auth.uid()
     AND (v_caller_loc IS NULL OR v_caller_loc <> v_job_location) THEN
    RAISE EXCEPTION 'forbidden: not your job';
  END IF;

  IF v_job_status <> 'partner_entwurf' THEN
    RAISE EXCEPTION 'can only submit from partner_entwurf state, current: %', v_job_status;
  END IF;

  SELECT count(*) INTO v_termin_count FROM public.job_appointments WHERE job_id = p_job_id;
  IF v_termin_count = 0 THEN
    RAISE EXCEPTION 'mindestens ein Termin erforderlich vor dem Absenden';
  END IF;

  UPDATE public.jobs
  SET status = 'partner_anfrage'
  WHERE id = p_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_submit_anfrage(uuid) TO authenticated;

-- 7) Daten-Migration: die 11 Barakuba-Uebergaben die nach Migration aus
-- Versehen status='offen' bekamen (statt durch den Bestaetigen-Workflow)
-- → zurueck auf partner_entwurf, da kein/wenige Termine.
UPDATE public.jobs
SET status = 'partner_entwurf',
    accepted_at = NULL
WHERE location_id = 'd0219c22-458a-4bb5-99fa-e532c5a6bc4e'
  AND created_by = 'c5bcbcd7-7502-44e2-b7f9-61148957fb83'
  AND status = 'offen'
  AND was_anfrage = false
  AND job_number IN (26209,26210,26211,26212,26213,26214,26215,26216,26217,26218,26219);
