-- Vertrieb: private Folder-Struktur (wie Outlook-Postfach).
--
-- Jeder Sales-User legt sich eigene Ordner an, sieht nur seine. Ordner
-- sind beliebig tief verschachtelt (parent_id -> self). Leads werden
-- via junction in genau einen Ordner pro User eingeordnet.
--
-- Visibility: Leo sieht seine Ordner + sein Folder-Assignment, Mischa
-- seine. Der Lead selbst ist team-weit sichtbar (RLS auf vertrieb_contacts
-- aendert sich nicht).
--
-- Datenmodell:
--   vertrieb_folders        — der Tree pro Owner
--   vertrieb_lead_folders   — Junction: welcher Lead steckt in welchem
--                             Folder fuer welchen Owner
--                             UNIQUE(lead_id, owner_id) ⇒ ein Lead in
--                             max einem Folder per User (Outlook-Logik).

CREATE TABLE IF NOT EXISTS public.vertrieb_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.vertrieb_folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vertrieb_folders_name_not_empty CHECK (length(trim(name)) > 0),
  -- Kein Ordner kann sein eigener Parent sein (zusaetzliche Cycle-Schutz
  -- ueber Application-Layer; Postgres hat keine triviale Cycle-Constraint).
  CONSTRAINT vertrieb_folders_no_self_parent CHECK (id <> parent_id)
);

CREATE INDEX IF NOT EXISTS vertrieb_folders_owner_idx
  ON public.vertrieb_folders(owner_id);
CREATE INDEX IF NOT EXISTS vertrieb_folders_parent_idx
  ON public.vertrieb_folders(parent_id);

ALTER TABLE public.vertrieb_folders ENABLE ROW LEVEL SECURITY;

-- RLS: jeder User sieht/bearbeitet nur seine eigenen Ordner. Admins
-- haben ueber has_permission/is_admin nichts Extra zu sehen — Folders
-- sind explizit privat (Outlook-Logik).
DROP POLICY IF EXISTS vertrieb_folders_owner_select ON public.vertrieb_folders;
CREATE POLICY vertrieb_folders_owner_select
  ON public.vertrieb_folders FOR SELECT
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS vertrieb_folders_owner_insert ON public.vertrieb_folders;
CREATE POLICY vertrieb_folders_owner_insert
  ON public.vertrieb_folders FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS vertrieb_folders_owner_update ON public.vertrieb_folders;
CREATE POLICY vertrieb_folders_owner_update
  ON public.vertrieb_folders FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS vertrieb_folders_owner_delete ON public.vertrieb_folders;
CREATE POLICY vertrieb_folders_owner_delete
  ON public.vertrieb_folders FOR DELETE
  USING (owner_id = auth.uid());

-- Trigger: updated_at automatisch pflegen
CREATE OR REPLACE FUNCTION public.vertrieb_folders_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vertrieb_folders_touch ON public.vertrieb_folders;
CREATE TRIGGER vertrieb_folders_touch
  BEFORE UPDATE ON public.vertrieb_folders
  FOR EACH ROW
  EXECUTE FUNCTION public.vertrieb_folders_touch_updated_at();

-- Junction: Lead in Folder. owner_id wird mitgespeichert (denormalisiert)
-- damit RLS-Filter ohne Folder-Join laufen kann.
CREATE TABLE IF NOT EXISTS public.vertrieb_lead_folders (
  lead_id uuid NOT NULL REFERENCES public.vertrieb_contacts(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL REFERENCES public.vertrieb_folders(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, owner_id)
);

CREATE INDEX IF NOT EXISTS vertrieb_lead_folders_folder_idx
  ON public.vertrieb_lead_folders(folder_id);
CREATE INDEX IF NOT EXISTS vertrieb_lead_folders_owner_idx
  ON public.vertrieb_lead_folders(owner_id);

ALTER TABLE public.vertrieb_lead_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vertrieb_lead_folders_owner_all ON public.vertrieb_lead_folders;
CREATE POLICY vertrieb_lead_folders_owner_all
  ON public.vertrieb_lead_folders FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

COMMENT ON TABLE public.vertrieb_folders IS
  'Private Outlook-aehnliche Ordner-Struktur pro Sales-User fuer Lead-Organisation.';
COMMENT ON TABLE public.vertrieb_lead_folders IS
  'Junction Lead<->Folder pro Owner. Ein Lead kann pro User in genau einem Folder stehen (PK lead_id+owner_id).';
