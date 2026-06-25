// Zentrale Farb-Palette fuer Vertriebs-Folders. Slugs werden 1:1 in der
// DB (vertrieb_folders.color) gespeichert — Allowlist als CHECK-Constraint.
//
// Pro Slot fertige Tailwind-Klassen:
//   icon   — fuer das Folder-Lucide-Icon (text-* mit dark-mode-Variante)
//   dot    — kleiner runder Color-Dot (bg-* + dark)
//   ring   — Selected-Ring beim Color-Picker (ring-*)

export type FolderColorSlug =
  | "amber" | "red" | "orange" | "yellow" | "green" | "teal"
  | "blue" | "indigo" | "purple" | "pink" | "gray";

export const FOLDER_COLOR_SLUGS: FolderColorSlug[] = [
  "amber", "red", "orange", "yellow", "green", "teal",
  "blue", "indigo", "purple", "pink", "gray",
];

interface ColorDef {
  label: string;
  icon: string;
  dot: string;
  ring: string;
}

// Liste statt Map damit Tailwind JIT die Klassen sieht und nicht purgt.
const COLOR_DEFS: Record<FolderColorSlug, ColorDef> = {
  amber:  { label: "Bernstein", icon: "text-amber-600 dark:text-amber-400",   dot: "bg-amber-500",   ring: "ring-amber-500" },
  red:    { label: "Rot",       icon: "text-red-600 dark:text-red-400",       dot: "bg-red-500",     ring: "ring-red-500" },
  orange: { label: "Orange",    icon: "text-orange-600 dark:text-orange-400", dot: "bg-orange-500",  ring: "ring-orange-500" },
  yellow: { label: "Gelb",      icon: "text-yellow-600 dark:text-yellow-400", dot: "bg-yellow-500",  ring: "ring-yellow-500" },
  green:  { label: "Grün",      icon: "text-green-600 dark:text-green-400",   dot: "bg-green-500",   ring: "ring-green-500" },
  teal:   { label: "Türkis",    icon: "text-teal-600 dark:text-teal-400",     dot: "bg-teal-500",    ring: "ring-teal-500" },
  blue:   { label: "Blau",      icon: "text-blue-600 dark:text-blue-400",     dot: "bg-blue-500",    ring: "ring-blue-500" },
  indigo: { label: "Indigo",    icon: "text-indigo-600 dark:text-indigo-400", dot: "bg-indigo-500",  ring: "ring-indigo-500" },
  purple: { label: "Lila",      icon: "text-purple-600 dark:text-purple-400", dot: "bg-purple-500",  ring: "ring-purple-500" },
  pink:   { label: "Pink",      icon: "text-pink-600 dark:text-pink-400",     dot: "bg-pink-500",    ring: "ring-pink-500" },
  gray:   { label: "Grau",      icon: "text-gray-500 dark:text-gray-400",     dot: "bg-gray-500",    ring: "ring-gray-500" },
};

/** Mapt einen DB-Slug auf seine Farb-Klassen. NULL/unknown -> 'amber' (Default). */
export function folderColor(slug: string | null | undefined): ColorDef {
  if (slug && slug in COLOR_DEFS) return COLOR_DEFS[slug as FolderColorSlug];
  return COLOR_DEFS.amber;
}

export function folderColorLabel(slug: string | null | undefined): string {
  return folderColor(slug).label;
}
