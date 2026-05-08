-- Customer-Sichtbarkeit: User die einen Auftrag sehen koennen, sollen
-- auch den verknuepften Kunden oeffnen koennen — selbst ohne kunden:view-
-- Permission. Sonst sehen Techniker auf der Auftrag-Detail-Page einen
-- Kundennamen, koennen aber nicht draufklicken um die Detail-Page mit
-- Kontaktdaten/Notizen zu sehen.
--
-- Aktueller Zustand: zwei Policies, eine "true" (Legacy, alle sehen alles)
-- und eine 'kunden:view'. Erste ueberfluessig. Ersetzen durch eine saubere
-- Policy die Job-Verknuepfung beruecksichtigt.

DROP POLICY IF EXISTS "Kunden sind für authentifizierte Benutzer sichtbar" ON public.customers;
DROP POLICY IF EXISTS "customers_select" ON public.customers;

CREATE POLICY "customers_select" ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.is_admin_or_lead()
    OR public.has_permission('kunden:view')
    OR EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.customer_id = customers.id
        AND public.user_can_see_job(jobs.id)
    )
  );
