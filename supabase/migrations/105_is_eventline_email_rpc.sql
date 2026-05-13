-- Migration 105: is_eventline_email RPC
--
-- Komplement zu is_partner_email (Migration 103). Liefert true wenn die
-- Email einem AKTIVEN EVENTLINE-Mitarbeiter (role != 'partner') gehoert.
-- Wird auf /partner/login fuer den Pre-Flight-Check verwendet: wenn ein
-- Eventline-User dort tippt, leiten wir ihn direkt auf /login ohne
-- Auth-Versuch.
--
-- SECURITY DEFINER + boolean-only → kein PII-Leak, gleiches Enumeration-
-- Risk-Profil wie 103 (akzeptabel fuer internes Tool).

CREATE OR REPLACE FUNCTION public.is_eventline_email(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(email) = lower(trim(p_email))
      AND role <> 'partner'
      AND is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_eventline_email(text) TO anon, authenticated;
