-- Sicherheits-Fix: tickets-RLS war effektiv offen.
--
-- Migration 012 hat 4 Policies mit USING(true) angelegt ("Tickets sind
-- sichtbar", "Jeder kann Tickets erstellen", "Jeder kann Tickets
-- aktualisieren", "Admins koennen Tickets loeschen"). Migration 061 hat
-- danach saubere Policies hinzugefuegt (tickets_select_own_or_admin,
-- tickets_insert_self, tickets_update_admin, tickets_update_own_open,
-- tickets_delete_admin), aber die alten NIE gedroppt.
--
-- Postgres OR-kombiniert RLS-Policies: ein Row ist sichtbar wenn IRGEND-
-- eine Policy USING-true zurueckgibt. Damit hat die alte "USING (true)"
-- die neuen restriktiven Policies komplett ueberstimmt — jeder
-- authentifizierte User sah/aenderte/loeschte ALLE Tickets, egal was 061
-- versucht hat.
--
-- Hier: alte Policies droppen, sodass nur noch die 061-Policies greifen.

DROP POLICY IF EXISTS "Tickets sind sichtbar" ON public.tickets;
DROP POLICY IF EXISTS "Jeder kann Tickets erstellen" ON public.tickets;
DROP POLICY IF EXISTS "Jeder kann Tickets aktualisieren" ON public.tickets;
DROP POLICY IF EXISTS "Admins können Tickets löschen" ON public.tickets;
