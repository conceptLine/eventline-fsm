// Single source of truth fuer das Permission-Modell.
//
// Permissions sind Strings im Format "module:action".
//   "kunden:view"   = Kunden sehen / Kunden-Tab in Sidebar zeigen
//   "kunden:create" = Neuer Kunde anlegen
//   "kunden:edit"   = Kundendaten bearbeiten
//   "kunden:delete" = Kunde archivieren/loeschen
//
// Die admin-Rolle wird im SQL-Helper `has_permission()` und im JS-Helper
// `hasPermission()` IMMER als allmaechtig behandelt — das verhindert dass
// sich ein Admin per UI-Konfiguration selbst aussperrt.
//
// Module die keine Action-Granularitaet haben (Kalender, HR, Vertrieb,
// Einstellungen): nur "view". Wer diese Module sieht, sieht alles drin.

export type PermissionAction = "view" | "create" | "edit" | "archive" | "delete" | "manage" | "approve";

export interface PermissionModule {
  slug: string;
  label: string;
  /** Pfade die zu diesem Modul gehoeren — fuer Layout-Guard. */
  paths: string[];
  /** Welche Aktionen werden in der Rollen-Matrix angeboten. */
  actions: PermissionAction[];
}

export const PERMISSION_MODULES: PermissionModule[] = [
  // Kalender — view = Kalender sehen, create/edit/delete = Termine verwalten.
  // Ist auch fuer Termine im Auftrag-Detail relevant (gleiche Permission).
  { slug: "kalender",      label: "Kalender",      paths: ["/kalender"],                                         actions: ["view", "create", "edit", "delete"] },
  // Operationen → Aufträge (Begriff aus der Sidebar, statt "Operations").
  { slug: "auftraege",     label: "Aufträge",      paths: ["/auftraege"],                                        actions: ["view", "create", "edit", "delete"] },
  // Abrechnung — abgeschlossene Auftraege als "Rechnung gestellt" markieren.
  // view = /abrechnung-Seite sehen; edit = "Rechnung gestellt"-Button druecken.
  { slug: "abrechnung",    label: "Abrechnung",    paths: ["/abrechnung"],                                       actions: ["view", "edit"] },
  // Budget — Firmenbudget pro Jahr & Kategorie setzen (nur Soll, manuell).
  // view = /budget-Seite sehen; edit = Kategorien/Betraege anlegen/aendern.
  { slug: "budget",        label: "Budget",        paths: ["/budget"],                                           actions: ["view", "edit"] },
  // Vertrieb — Lead-Pipeline. CRUD pro Lead.
  { slug: "vertrieb",      label: "Vertrieb",      paths: ["/vertrieb"],                                         actions: ["view", "create", "edit", "delete"] },
  { slug: "locations",     label: "Locations",     paths: ["/locations", "/standorte", "/raeume"], actions: ["view", "create", "edit", "delete"] },
  { slug: "kunden",        label: "Kunden",        paths: ["/kunden"],                                           actions: ["view", "create", "edit", "archive", "delete"] },
  { slug: "lieferanten",   label: "Lieferanten",   paths: ["/lieferanten"],                                      actions: ["view", "create", "edit", "delete"] },
  // Todos sind personal (RLS ueber created_by/assigned_to). Permissions
  // gaten nur den UI-Pfad: view = Sidebar+Page, create = Anlegen-Button.
  // Edit/Delete eigener Todos ist immer erlaubt (RLS-Owner) — daher nicht
  // in der Matrix als Toggle, sonst missverstaendlich.
  { slug: "todos",         label: "Todos",         paths: ["/todos"],                                            actions: ["view", "create"] },
  // HR-Hub-Sammelseite (zeigt nur Karten — Sub-Pfade haben eigene Module).
  { slug: "hr",            label: "HR-Hub",        paths: ["/hr"],                                               actions: ["view"] },
  // Loehne — Pro-Mitarbeiter-Saetze (Brutto + Arbeitgeber-Anteil) pflegen.
  // Sensitives Modul: nur HR/Geschaeftsfuehrung. Mitarbeiter sehen ihre
  // eigene Brutto-Zahl via /einstellungen → Mein Konto (RPC, kein Modul-View).
  // KEINE eigene Route — die Lohntabelle ist Content im Loehne-Tab unter /hr,
  // daher leere paths-Liste. Page-Gate uebernimmt 'hr:view'.
  { slug: "lohn",          label: "Löhne",         paths: [],                                                    actions: ["manage"] },
  // Stempelzeiten als eigenes Modul — User mit hr:view aber nicht
  // stempelzeiten:view kann den HR-Hub sehen, aber nicht die Stempel-Liste.
  { slug: "stempelzeiten", label: "Stempelzeiten", paths: ["/stempelzeiten"],                                    actions: ["view"] },
  { slug: "tickets",       label: "Tickets",       paths: ["/tickets"],                                          actions: ["view", "create", "manage"] },
  { slug: "einstellungen", label: "Einstellungen", paths: ["/einstellungen"],                                    actions: ["view"] },
  // Ferien: Mitarbeiter sehen + beantragen ihre eigenen via RLS
  // (kein view-Slug noetig). approve = Admin/Genehmiger genehmigt
  // oder lehnt ab. /ferien Pfad fuer alle authenticated User offen.
  { slug: "ferien",        label: "Ferien",        paths: ["/ferien"],                                           actions: ["view", "approve"] },
  // Admin-only: User-Aktivitaets-Log einsehen (wann welcher Mitarbeiter
  // in der App war). Hat keinen eigenen Pfad — Tab im /einstellungen.
  // Wird via has_permission('admin:activity') gegated, Admin durch.
];

// Partnerportal-Module — separater Permission-Namespace fuer Locations-
// partner. Die zwei Portale (Firmenportal / Partnerportal) sind
// eigenstaendige Welten, sollen aber das gleiche Permission-Format teilen
// damit ein zukuenftiges has_permission()-Check beide Seiten gleich
// behandelt. Slugs sind dashed ("partner-anfragen"), das Action-Trennzeichen
// bleibt ":" wie im Firmenportal.
//
// Aktuell hat die partner-Rolle keine Granularitaet (Partnerportal-Layout
// gated nur ueber role='partner'). Diese Module bereiten die Partner-
// Sub-Rollen-Hierarchie vor (Partner-Admin vs Partner-Mitarbeiter), bei
// der ein Partner seine eigenen Mitarbeiter mit reduzierten Rechten anlegt.
export const PARTNER_PERMISSION_MODULES: PermissionModule[] = [
  { slug: "partner-anfragen",      label: "Anfragen",      paths: ["/partner/anfragen"],      actions: ["view", "create", "edit", "delete"] },
  { slug: "partner-belegungsplan", label: "Belegungsplan", paths: ["/partner/belegungsplan"], actions: ["view"] },
];

/** Pfade die fuer alle eingeloggten User erreichbar sind, unabhaengig von der Rolle. */
const ALWAYS_ALLOWED_PREFIXES = ["/dashboard"];

/** Pfade die immer erreichbar sind, auch ohne Modul-View-Permission, weil
 *  sie via Verknuepfung aus einem anderen Modul aufgerufen werden (z.B.
 *  /kunden/[uuid] aus einem Auftrag heraus, ohne dass der User die ganze
 *  Kunden-Liste sehen darf). Detail-Pages — keine Listen, keine Neu/Edit. */
const ALWAYS_ALLOWED_DETAIL_REGEX: RegExp[] = [
  /^\/kunden\/[0-9a-f-]{36}\/?$/i,
];

/** Permission-Check fuer eine konkrete Aktion (z.B. "kunden:edit"). */
export function hasPermission(permissions: string[], role: string, perm: string): boolean {
  if (role === "admin") return true;
  return permissions.includes(perm);
}

/** True wenn der User das Modul sehen darf (= module:view-Permission). */
function canSeeModule(slug: string, permissions: string[], role: string): boolean {
  return hasPermission(permissions, role, `${slug}:view`);
}

export function isPathAllowed(pathname: string, permissions: string[], role: string): boolean {
  if (role === "admin") return true;
  if (ALWAYS_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
  // Detail-Pages (/kunden/[uuid] etc.) sind ohne Modul-Permission erreichbar
  // — sie werden ueber Verknuepfungen aus anderen Modulen geoeffnet (z.B.
  // Klick auf den Kundennamen in einem Auftrag). RLS auf den Tabellen sorgt
  // dafuer dass nur sichtbare Datensaetze angezeigt werden.
  if (ALWAYS_ALLOWED_DETAIL_REGEX.some((re) => re.test(pathname))) return true;
  for (const mod of PERMISSION_MODULES) {
    if (mod.paths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return canSeeModule(mod.slug, permissions, role);
    }
  }
  // Pfade die zu keinem Modul gehoeren (z.B. /api/...) lassen wir durch.
  return true;
}

// Feature-Permissions: cross-cutting Funktionen die nicht an einen Modul-
// Pfad gebunden sind (z.B. Bexio-Buttons tauchen auf Kunden- UND Auftrags-
// Detailseiten auf). In der Rollen-Matrix als eigene Sektion gerendert.
export interface PermissionFeature {
  key: string;
  label: string;
  description: string;
}

export const PERMISSION_FEATURES: PermissionFeature[] = [
  {
    key: "bexio:use",
    label: "Bexio benutzen",
    description: "Kontakte mit Bexio verlinken, in Bexio anlegen, dort öffnen",
  },
];

/** Sammelt alle bekannten Permission-Strings — fuer API-Validierung beim Anlegen/Aendern von Rollen. */
export function allKnownPermissions(): string[] {
  const out: string[] = [];
  for (const m of PERMISSION_MODULES) {
    for (const a of m.actions) out.push(`${m.slug}:${a}`);
  }
  for (const m of PARTNER_PERMISSION_MODULES) {
    for (const a of m.actions) out.push(`${m.slug}:${a}`);
  }
  for (const f of PERMISSION_FEATURES) out.push(f.key);
  return out;
}
