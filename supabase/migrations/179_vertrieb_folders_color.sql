-- Vertrieb-Folders: Farb-Slot pro Ordner (Outlook-Style Color-Coding).
--
-- Speichert einen Slug-String (z.B. 'amber', 'red', 'blue') statt freies
-- Hex — Frontend mappt das auf Tailwind-Klassen, was Light/Dark-Mode
-- konsistent loest. NULL = Default (amber). Allowlist als CHECK-Constraint
-- damit niemand kreative Werte rein-injectet die das UI dann nicht
-- rendern kann.

ALTER TABLE public.vertrieb_folders
  ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE public.vertrieb_folders
  DROP CONSTRAINT IF EXISTS vertrieb_folders_color_check;
ALTER TABLE public.vertrieb_folders
  ADD CONSTRAINT vertrieb_folders_color_check
  CHECK (color IS NULL OR color IN (
    'amber','red','orange','yellow','green','teal','blue','indigo','purple','pink','gray'
  ));

COMMENT ON COLUMN public.vertrieb_folders.color IS
  'Optionaler Farb-Slug fuer Folder-Icon. NULL = amber (Default). Erlaubte Werte: siehe CHECK.';
