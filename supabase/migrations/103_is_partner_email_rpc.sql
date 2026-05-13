-- Pre-flight Login-Check: ist diese E-Mail ein Partner-User?
--
-- Verwendung: /login ruft diese RPC bevor signIn versucht wird. Wenn ja
-- → Redirect auf /partner/login mit Email-Prefill, damit Partner sich
-- ueber das richtige Portal anmelden und der Auth-Versuch erst gar nicht
-- ueber /login geht (sonst muesste man signOut+Redirect dance machen).
--
-- SECURITY DEFINER bypassed die strikte profiles-RLS (eigenes Profil +
-- admin) — wir geben nur ein boolean zurueck, kein PII.
--
-- Enumeration-Risk: Aufrufer kann durchprobieren ob eine E-Mail Partner ist.
-- Bei einem internen Tool dieser Groesse akzeptabel; Partner-User sind in
-- der Regel ohnehin bekannte Geschaeftspartner.

CREATE OR REPLACE FUNCTION public.is_partner_email(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(email) = lower(trim(p_email))
      AND role = 'partner'
      AND is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_partner_email(text) TO anon, authenticated;
