-- Empfangsbestaetigung fuer Lohnausweise.
--
-- Schweizer Steuerrecht / Arbeitsrecht: Arbeitgeber ist verpflichtet den
-- jaehrlichen Lohnausweis (Formular 11) auszuhaendigen. Bei digitaler
-- Bereitstellung braucht es einen Nachweis dass der Mitarbeiter das
-- Dokument erhalten hat. Dafuer dient diese Spalte: der MA klickt
-- "Erhalt bestaetigen" und wir loggen den Timestamp.
--
-- Nur fuer doc_type='lohnausweis' relevant — monatliche Lohnabrechnungen
-- brauchen keine eigene Empfangsbestaetigung. Wir schraenken das NICHT
-- per Check-Constraint ein, weil das App-seitig sauberer ist und wir
-- spaeter evtl. auch Monats-Abrechnungen bestaetigen lassen wollen.
--
-- Update geht ausschliesslich ueber API-Route (Admin-Client, prueft
-- ownership in Code). Daher keine zusaetzliche User-Update-RLS-Policy.

alter table public.wage_documents
  add column if not exists received_confirmed_at timestamptz;

-- Index nicht noetig — Spalte wird nur per id-Lookup gesetzt und in der
-- Liste pro Dokument einmal mitgelesen.
