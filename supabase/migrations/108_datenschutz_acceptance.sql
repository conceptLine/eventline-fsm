-- Migration 108: Datenschutz-Akzeptanz
--
-- Speichert wann ein User die Datenschutzerklaerung akzeptiert hat.
-- Pflicht-Akzeptanz wird primaer fuer Partner enforced (Partner-Portal-
-- Modal beim ersten Login), aber das Feld gilt fuer alle Rollen — so
-- haben wir spaeter die Option, auch fuer EVENTLINE-Mitarbeitende eine
-- Akzeptanz zu verlangen.
--
-- Die Version-Spalte ermoeglicht spaeter Re-Akzeptanz bei Aenderungen
-- der Datenschutzerklaerung (z.B. neuer Sub-Auftragsbearbeiter).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS datenschutz_akzeptiert_at timestamptz,
  ADD COLUMN IF NOT EXISTS datenschutz_akzeptiert_version text;

-- RPC fuer die Akzeptanz — sicherheits-relevant, daher SECURITY DEFINER:
-- prueft dass der User auth.uid() === eigene Profile-Row hat und schreibt
-- nur die zwei Datenschutz-Felder, nichts anderes.

CREATE OR REPLACE FUNCTION public.accept_datenschutz(p_version text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'forbidden: nicht angemeldet';
  END IF;
  IF p_version IS NULL OR length(trim(p_version)) = 0 THEN
    RAISE EXCEPTION 'invalid: version fehlt';
  END IF;
  UPDATE public.profiles
  SET datenschutz_akzeptiert_at = now(),
      datenschutz_akzeptiert_version = p_version
  WHERE id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_datenschutz(text) TO authenticated;
