-- Migration 107: apply_ticket bekommt p_corrected_job_id-Parameter
--
-- Hintergrund: Beim Stempel-Aenderung-Ticket konnte der Mitarbeiter beim
-- Erstellen einen falschen Auftrag waehlen (z.B. zwei aehnlich benannte
-- Events). Der Admin sah das beim Approve, konnte den Job aber nicht mehr
-- korrigieren — die alte RPC uebernahm stur data.job_id. Beispiel:
-- INT-26261 vs INT-26234 ("Mediterranean Music Festival" vs ".../City
-- centre entry permit").
--
-- Fix: Optionaler p_corrected_job_id-Parameter. Wenn NULL → bisheriges
-- Verhalten (uebernimmt data.job_id bzw. existierenden Eintrag-Job).
-- Wenn gesetzt:
--   - 'ANDERE_ARBEIT'   → job_id = NULL (keinem Auftrag zugeordnet)
--   - <uuid>            → job_id = uebergebener Wert
-- Funktioniert in beiden Modi (Korrektur eines time_entries vs neuer
-- Eintrag bei "Vergessen einzustempeln").

-- Alten Overload droppen damit nicht zwei Versionen nebeneinander leben.
DROP FUNCTION IF EXISTS public.apply_ticket(uuid, ticket_status, text);

CREATE OR REPLACE FUNCTION public.apply_ticket(
  p_ticket_id uuid,
  p_new_status ticket_status,
  p_resolution_note text,
  p_corrected_job_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tickets%ROWTYPE;
  v_user_id uuid := auth.uid();
  v_data jsonb;
  v_corrected_job_id uuid;
  v_has_correction boolean := p_corrected_job_id IS NOT NULL;
BEGIN
  -- Permission-Check: nur Admin/Manager.
  IF NOT (public.is_admin() OR public.has_permission('tickets:manage')) THEN
    RAISE EXCEPTION 'forbidden: nur fuer tickets:manage';
  END IF;

  -- Ticket laden + locken.
  SELECT * INTO t FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket not found';
  END IF;

  IF p_new_status NOT IN ('erledigt', 'abgelehnt') THEN
    RAISE EXCEPTION 'invalid target status: %', p_new_status;
  END IF;

  -- corrected_job_id parsen. Sentinel 'ANDERE_ARBEIT' → NULL, sonst UUID.
  IF v_has_correction AND p_corrected_job_id <> 'ANDERE_ARBEIT' AND p_corrected_job_id <> '' THEN
    v_corrected_job_id := p_corrected_job_id::uuid;
  ELSE
    v_corrected_job_id := NULL;
  END IF;

  -- Spezial-Logik: bei stempel_aenderung + erledigt → time_entries updaten.
  IF t.type = 'stempel_aenderung' AND p_new_status = 'erledigt' THEN
    v_data := t.data;

    IF v_data ? 'time_entry_id' AND COALESCE(v_data->>'time_entry_id', '') <> '' THEN
      -- Korrektur eines existierenden Eintrags. Bei v_has_correction wird
      -- auch der Auftrag mit aktualisiert; sonst bleibt der bestehende
      -- job_id auf der time_entries-Row unangetastet.
      IF v_has_correction THEN
        UPDATE public.time_entries
        SET clock_in = COALESCE((v_data->>'neu_start')::timestamptz, clock_in),
            clock_out = COALESCE((v_data->>'neu_end')::timestamptz, clock_out),
            job_id = v_corrected_job_id,
            notes = CONCAT_WS(E'\n', notes, '[Korrektur via Ticket #' || p_ticket_id || ']')
        WHERE id = (v_data->>'time_entry_id')::uuid;
      ELSE
        UPDATE public.time_entries
        SET clock_in = COALESCE((v_data->>'neu_start')::timestamptz, clock_in),
            clock_out = COALESCE((v_data->>'neu_end')::timestamptz, clock_out),
            notes = CONCAT_WS(E'\n', notes, '[Korrektur via Ticket #' || p_ticket_id || ']')
        WHERE id = (v_data->>'time_entry_id')::uuid;
      END IF;
    ELSE
      -- Neuer Eintrag (Mitarbeiter hat vergessen einzustempeln). Bei
      -- v_has_correction nimmt der Admin-Wert den Vorrang vor data.job_id.
      INSERT INTO public.time_entries (user_id, job_id, clock_in, clock_out, description, notes)
      VALUES (
        t.created_by,
        CASE WHEN v_has_correction THEN v_corrected_job_id
             ELSE NULLIF(v_data->>'job_id', '')::uuid END,
        (v_data->>'neu_start')::timestamptz,
        (v_data->>'neu_end')::timestamptz,
        v_data->>'beschreibung',
        '[Nachtraeglich erfasst via Ticket #' || p_ticket_id || ']'
      );
    END IF;
  END IF;

  -- Status-Update.
  UPDATE public.tickets
  SET status = p_new_status,
      resolved_at = now(),
      resolved_by = v_user_id,
      resolution_note = p_resolution_note
  WHERE id = p_ticket_id;
END;
$$;
