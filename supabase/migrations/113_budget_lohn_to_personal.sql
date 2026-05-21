-- Konzeptionelle Korrektur:
-- 28.04 CHF/h sind die VOLLKOSTEN pro Stunde (Lohn + Sozial + Spesen
-- zusammen). Daher gehoert der auto-berechnete Wert auf die
-- Top-Level-Kategorie "Personal", nicht auf die Sub-Kategorie "Lohn"
-- — sonst wuerden Sozialleistungen + Spesen ggf. doppelt gezaehlt
-- wenn Sub-Kategorien manuell gefuellt sind.
--
-- Aenderungen:
--  1. auto_source von Sub-"Lohn" auf Top-"Personal" verschieben.
--  2. Die drei Default-Sub-Kategorien (Lohn, Sozialleistungen, Spesen)
--     archivieren, damit nicht doppelt gerechnet werden kann. Wer
--     spaeter manuelle Sub-Buchungen will, kann sie wiederherstellen
--     (archived_at = NULL setzen) oder neue anlegen.

do $$
declare
  v_personal_id uuid;
begin
  select id into v_personal_id
  from public.budget_categories
  where name = 'Personal' and parent_id is null;

  if v_personal_id is null then
    return; -- Default-Set nicht vorhanden, nichts zu tun.
  end if;

  -- 1. Auto-Flag verschieben.
  update public.budget_categories
  set auto_source = null
  where parent_id = v_personal_id and name = 'Lohn';

  update public.budget_categories
  set auto_source = 'internal_labor'
  where id = v_personal_id;

  -- 2. Default-Sub-Kategorien archivieren (idempotent: setzt nur archived_at
  --    wenn noch NULL, damit ein manueller Unarchive nicht ueberschrieben wird).
  update public.budget_categories
  set archived_at = now()
  where parent_id = v_personal_id
    and archived_at is null
    and name in ('Lohn', 'Sozialleistungen', 'Spesen');
end$$;
