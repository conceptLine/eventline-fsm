-- Audit-Fixes Partnerportal (Mai 2026).
-- Adressiert:
--   #3 appointments_insert_partner Status-Liste (fehlte partner_entwurf)
--   #4 jobs_insert_partner Status-Liste (fehlte partner_entwurf)
--   #5 jobs_update_partner sollte nur Trigger-validiert sein
--   #6 Eventline-Notification bei Partner-Submit
--   #9 Audit-Trail: submitted_at/by Spalten
--   #10 Letzter Termin in partner_anfrage nicht loeschbar
--   Plus: Index auf jobs(location_id, status, start_date)

-- ===================================================================
-- 1) INSERT-/DELETE-Policies fuer Termine + Jobs auf partner_entwurf
--    erweitern (Migration 102 hat nur UPDATE-Policy erweitert).
-- ===================================================================

DROP POLICY IF EXISTS "jobs_insert_partner" ON public.jobs;
CREATE POLICY "jobs_insert_partner" ON public.jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    is_admin_or_lead()
    OR (
      status IN ('partner_anfrage', 'partner_entwurf')
      AND created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'partner'
          AND partner_location_id IS NOT NULL
          AND partner_location_id = jobs.location_id
      )
    )
  );

DROP POLICY IF EXISTS "appointments_insert_partner" ON public.job_appointments;
CREATE POLICY "appointments_insert_partner" ON public.job_appointments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_admin_or_lead()
    OR (
      job_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.jobs j
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE j.id = job_appointments.job_id
          AND j.status IN ('partner_anfrage', 'partner_entwurf')
          AND p.role = 'partner'
          AND p.partner_location_id IS NOT NULL
          AND p.partner_location_id = j.location_id
      )
    )
  );

DROP POLICY IF EXISTS "appointments_delete_partner" ON public.job_appointments;
CREATE POLICY "appointments_delete_partner" ON public.job_appointments
  FOR DELETE TO authenticated
  USING (
    is_admin_or_lead()
    OR (
      job_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.jobs j
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE j.id = job_appointments.job_id
          AND j.status IN ('partner_anfrage', 'partner_entwurf')
          AND p.role = 'partner'
          AND p.partner_location_id IS NOT NULL
          AND p.partner_location_id = j.location_id
      )
    )
  );

-- ===================================================================
-- 2) Audit-Trail-Spalten fuer Anfrage-Submission
-- ===================================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ===================================================================
-- 3) Status-Wechsel-Guard fuer Partner-Rolle
--
-- jobs_update_partner WITH CHECK erlaubt aktuell status IN (partner_entwurf,
-- partner_anfrage). Damit kann ein Partner via Direct-DB-Call freely zwischen
-- den beiden Status springen — z.B. partner_entwurf → partner_anfrage ohne
-- den Termin-Check der RPC partner_submit_anfrage zu durchlaufen.
--
-- Fix: Trigger der bei Partner-Rolle nur Same-Status-Updates erlaubt. Status-
-- Wechsel muss ueber SECURITY DEFINER RPC laufen (partner_submit_anfrage
-- setzt session_replication_role temporaer auf 'replica' um den Trigger zu
-- umgehen — saubere Variante: via current_setting-Marker).
-- ===================================================================

CREATE OR REPLACE FUNCTION public.partner_status_change_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  -- Admin/Lead-Pfad: alles erlaubt
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'partner' THEN
    RETURN NEW;
  END IF;

  -- Marker-Setting wird von erlaubten RPCs (partner_submit_anfrage) gesetzt,
  -- um den Guard temporaer zu umgehen. current_setting mit missing_ok=true
  -- gibt NULL zurueck wenn nicht gesetzt.
  IF current_setting('app.partner_status_change_ok', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'partner role cannot change status from % to % directly — use partner_submit_anfrage RPC',
      OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partner_status_change_guard_trg ON public.jobs;
CREATE TRIGGER partner_status_change_guard_trg
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_status_change_guard();

-- ===================================================================
-- 4) partner_submit_anfrage RPC: setzt submitted_at/by, sendet
--    Notification an Admins, umgeht Status-Guard via Marker.
-- ===================================================================

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
  v_caller_name text;
  v_job_status text;
  v_job_creator uuid;
  v_job_location uuid;
  v_job_title text;
  v_termin_count int;
  v_admin_id uuid;
BEGIN
  SELECT role, partner_location_id, full_name
  INTO v_caller_role, v_caller_loc, v_caller_name
  FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'partner' THEN
    RAISE EXCEPTION 'forbidden: only partner role can submit anfragen';
  END IF;

  SELECT status, created_by, location_id, title
  INTO v_job_status, v_job_creator, v_job_location, v_job_title
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

  -- Status-Guard temporaer umgehen
  PERFORM set_config('app.partner_status_change_ok', 'on', true);

  UPDATE public.jobs
  SET status = 'partner_anfrage',
      submitted_at = now(),
      submitted_by = auth.uid()
  WHERE id = p_job_id;

  PERFORM set_config('app.partner_status_change_ok', 'off', true);

  -- In-App-Notification an alle aktiven Admins (keine Mail per Leo's Wunsch).
  FOR v_admin_id IN
    SELECT id FROM public.profiles WHERE role = 'admin' AND is_active = true
  LOOP
    INSERT INTO public.notifications (user_id, title, message, link)
    VALUES (
      v_admin_id,
      'Neue Partner-Anfrage: ' || coalesce(v_job_title, 'Anfrage'),
      coalesce(v_caller_name, 'Partner') || ' hat eine Anfrage abgeschickt.',
      '/auftraege/' || p_job_id::text
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_submit_anfrage(uuid) TO authenticated;

-- ===================================================================
-- 5) Letzter-Termin-Schutz: Partner darf in partner_anfrage den letzten
--    Termin nicht loeschen. UI-Sperre reicht nicht — RLS muss greifen.
-- ===================================================================

CREATE OR REPLACE FUNCTION public.protect_last_termin_for_partner_anfrage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining int;
  v_status text;
  v_caller_role text;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'partner' THEN
    RETURN OLD; -- Admin/Lead/Team duerfen
  END IF;

  SELECT status INTO v_status FROM public.jobs WHERE id = OLD.job_id;
  IF v_status <> 'partner_anfrage' THEN
    RETURN OLD; -- Nur in partner_anfrage geschuetzt
  END IF;

  -- Wieviele Termine bleiben NACH dem Delete uebrig?
  SELECT count(*) INTO v_remaining
  FROM public.job_appointments
  WHERE job_id = OLD.job_id AND id <> OLD.id;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'Mindestens ein Termin muss in dieser Phase bleiben. Zuerst neuen Termin anlegen, dann den alten loeschen.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_last_termin_trg ON public.job_appointments;
CREATE TRIGGER protect_last_termin_trg
  BEFORE DELETE ON public.job_appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_last_termin_for_partner_anfrage();

-- ===================================================================
-- 6) Index fuer Partner-Queries
-- ===================================================================

CREATE INDEX IF NOT EXISTS jobs_location_status_start_idx
  ON public.jobs (location_id, status, start_date)
  WHERE is_deleted IS NOT TRUE;

-- ===================================================================
-- 7) partner_withdraw_anfrage RPC: atomares Loeschen einer Anfrage
--    (Termine + Documents + Job in einer Transaktion). Storage-Files
--    bleiben Frontend-Sache (kein DB-Trigger fuer Storage).
-- ===================================================================

CREATE OR REPLACE FUNCTION public.partner_withdraw_anfrage(
  p_job_id uuid
)
RETURNS TABLE(storage_paths text[])
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
  v_paths text[];
BEGIN
  SELECT role, partner_location_id INTO v_caller_role, v_caller_loc
  FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'partner' THEN
    RAISE EXCEPTION 'forbidden: only partner role can withdraw anfragen';
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

  -- Nur in den Pre-Accept-Status zurueckziehbar
  IF v_job_status NOT IN ('partner_entwurf', 'partner_anfrage') THEN
    RAISE EXCEPTION 'cannot withdraw job in status %', v_job_status;
  END IF;

  -- Storage-Paths fuer Frontend-Cleanup zurueckgeben
  SELECT array_agg(storage_path) INTO v_paths
  FROM public.documents WHERE job_id = p_job_id;

  -- Cascade: documents, appointments, dann job. Status-Guard greift nicht
  -- bei DELETE (BEFORE UPDATE only).
  DELETE FROM public.documents WHERE job_id = p_job_id;
  DELETE FROM public.job_appointments WHERE job_id = p_job_id;
  DELETE FROM public.jobs WHERE id = p_job_id;

  RETURN QUERY SELECT coalesce(v_paths, ARRAY[]::text[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_withdraw_anfrage(uuid) TO authenticated;
