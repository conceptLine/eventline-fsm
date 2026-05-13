"use client";

/**
 * Rollen-Tab in /einstellungen — admin-only.
 *
 * Liste aller Rollen, jede Karte einklappbar (Default kollabiert) damit
 * sich nicht alle Matrizen gleichzeitig auftuermen.
 *
 * Pro Rolle:
 *   - Modul-Matrix (Sehen/Anlegen/Bearbeiten/Löschen) als Tabelle.
 *   - Feature-Section (z.B. Bexio-Zugriff) — cross-cutting Permissions
 *     die nicht an einen Modul-Pfad gebunden sind.
 *
 * Aktive Permission = rotes X-Icon im Cell. Anklickbares Cell, Toggle
 * fuegt die Permission der Liste zu / entfernt sie.
 *
 * Schutzregeln:
 *   - Admin-Rolle ist gesperrt (sonst Lockout-Risiko).
 *   - System-Rollen (admin, techniker) sind nicht loeschbar; techniker-
 *     Permissions koennen aber editiert werden.
 *   - Custom-Rollen sind voll editier- und loeschbar (nur wenn keine User
 *     mehr drauf haengen).
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/use-confirm";
import { PERMISSION_MODULES, PERMISSION_FEATURES, type PermissionAction } from "@/lib/permissions";
import { Plus, Trash2, Lock, Save, X, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { TOAST } from "@/lib/messages";

interface Role {
  slug: string;
  label: string;
  permissions: string[];
  is_system: boolean;
}

const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "Sehen",
  create: "Anlegen",
  edit: "Bearbeiten",
  archive: "Archivieren",
  delete: "Löschen",
  manage: "Verwalten",
  approve: "Genehmigen",
};

const ACTION_COLUMNS: PermissionAction[] = ["view", "create", "edit", "archive", "delete", "approve"];

// Visuelles Toggle-Cell: aktive Permission = rotes X im Cell, sonst leer.
// `onToggle` fehlt bei locked-Rollen (Admin) damit die Cells nicht klickbar sind.
function PermCell({ active, locked, onToggle, label }: {
  active: boolean;
  locked: boolean;
  onToggle?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onToggle}
      aria-label={label}
      aria-pressed={active}
      className={`
        inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors
        ${active
          ? "border-red-300 bg-red-50 dark:bg-red-500/15 dark:border-red-500/40"
          : "border-border hover:bg-foreground/[0.04]"}
        ${locked ? "cursor-not-allowed opacity-70" : "cursor-pointer"}
      `}
    >
      {active && <X className="h-4 w-4 text-red-600 dark:text-red-400" strokeWidth={3} />}
    </button>
  );
}

interface RollenTabProps {
  /** "firma" = alle Rollen ausser partner, "partner" = nur partner.
      Default "firma". Steuert Filter + UI-Texte. */
  scope?: "firma" | "partner";
}

export function RollenTab({ scope = "firma" }: RollenTabProps = {}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ label: "", permissions: [] as string[] });
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  // Welche Rollen-Karten sind aufgeklappt? Default: alles zugeklappt damit
  // die Liste kompakt bleibt.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { confirm, ConfirmModalElement } = useConfirm();

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/roles");
    const json = await res.json();
    if (json.success) {
      // Scope-Filter: firma = alle ausser partner, partner = nur partner.
      // Trennung der zwei Rollen-Welten in /einstellungen (Firmenportal vs
      // Partnerportal Haupt-Tabs).
      const filtered: Role[] = (json.roles as Role[]).filter((r) =>
        scope === "partner" ? r.slug === "partner" : r.slug !== "partner"
      );
      setRoles(filtered);
      const initial: Record<string, string[]> = {};
      for (const r of filtered) initial[r.slug] = [...r.permissions];
      setEdits(initial);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function toggleExpanded(slug: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  }

  function togglePermission(slug: string, perm: string) {
    setEdits((prev) => {
      const current = prev[slug] ?? [];
      const adding = !current.includes(perm);
      let next = adding ? [...current, perm] : current.filter((s) => s !== perm);

      // Auto-Aktivierung der module:view-Permission wenn create/edit/delete/
      // archive aktiviert wird. Ein User kann z.B. kunden:edit nicht
      // sinnvoll nutzen wenn er die Kunden-Liste gar nicht sehen darf —
      // ohne diesen Auto-Toggle muesste der Admin daran denken view extra
      // anzuhaken.
      if (adding && perm.includes(":")) {
        const [mod, action] = perm.split(":");
        if (action !== "view" && !next.includes(`${mod}:view`)) {
          next = [...next, `${mod}:view`];
        }
      }

      return { ...prev, [slug]: next };
    });
  }

  // "Alle ankreuzen" pro Modul-Zeile — schnellerer Custom-Rollen-Build.
  function setAllForModule(roleSlug: string, modSlug: string, actions: PermissionAction[]) {
    setEdits((prev) => {
      const current = prev[roleSlug] ?? [];
      const modPerms = actions.map((a) => `${modSlug}:${a}`);
      const allSet = modPerms.every((p) => current.includes(p));
      // Wenn alle schon da: alle entfernen. Sonst alle hinzufuegen.
      const next = allSet
        ? current.filter((p) => !modPerms.includes(p))
        : [...new Set([...current, ...modPerms])];
      return { ...prev, [roleSlug]: next };
    });
  }

  function isDirty(role: Role): boolean {
    const edited = edits[role.slug] ?? [];
    if (edited.length !== role.permissions.length) return true;
    return edited.some((s) => !role.permissions.includes(s));
  }

  async function saveRole(role: Role) {
    setSavingSlug(role.slug);
    const res = await fetch(`/api/admin/roles/${role.slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: edits[role.slug] ?? [] }),
    });
    const json = await res.json();
    setSavingSlug(null);
    if (!json.success) {
      TOAST.errorOr(json.error);
      return;
    }
    toast.success("Berechtigungen gespeichert");
    load();
  }

  async function deleteRole(role: Role) {
    const ok = await confirm({
      title: "Rolle löschen?",
      message: `Die Rolle "${role.label}" wird endgültig entfernt.`,
      confirmLabel: "Löschen",
      variant: "red",
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/roles/${role.slug}`, { method: "DELETE" });
    const json = await res.json();
    if (!json.success) {
      TOAST.errorOr(json.error);
      return;
    }
    toast.success("Rolle gelöscht");
    load();
  }

  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch("/api/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createForm),
    });
    const json = await res.json();
    setCreating(false);
    if (!json.success) {
      TOAST.errorOr(json.error);
      return;
    }
    toast.success("Rolle angelegt");
    setShowCreate(false);
    setCreateForm({ label: "", permissions: [] });
    load();
  }

  function renderModuleMatrix(roleSlug: string, currentPerms: string[], locked: boolean, onToggle: (perm: string) => void) {
    return (
      <div className="overflow-x-auto -mx-2 sm:mx-0">
        <table className="w-full text-sm border-separate border-spacing-y-1 px-2 sm:px-0">
          <thead>
            <tr className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              <th className="text-left pb-1 pr-3">Bereich</th>
              {ACTION_COLUMNS.map((a) => (
                <th key={a} className="text-center pb-1 px-1 w-16">{ACTION_LABELS[a]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MODULES.map((mod) => {
              // Tooltip-Hinweise pro Modul wo es Sub-Pfade gibt die nicht
              // offensichtlich sind. Wird auf den Bereich-Namen gelegt.
              const moduleTooltip = mod.slug === "kalender"
                ? "Steuert auch Termine auf Auftrag-Detail-Seiten."
                : mod.slug === "stempelzeiten"
                ? "Eigene Stempelzeiten bleiben sichtbar; diese Permission steuert die /stempelzeiten-Seite."
                : undefined;
              return (
              <tr key={`${roleSlug}-${mod.slug}`} className="bg-foreground/[0.02] dark:bg-foreground/[0.04]">
                <td className="py-1 px-3 rounded-l-lg text-xs font-medium">
                  <div className="flex items-center gap-1.5">
                    <span data-tooltip={moduleTooltip}>{mod.label}</span>
                    {!locked && mod.actions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setAllForModule(roleSlug, mod.slug, mod.actions)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                        data-tooltip={`Alle ${ACTION_COLUMNS.filter(a => mod.actions.includes(a)).length} Aktionen toggeln`}
                      >
                        Alle
                      </button>
                    )}
                  </div>
                </td>
                {ACTION_COLUMNS.map((a) => {
                  const supported = mod.actions.includes(a);
                  const perm = `${mod.slug}:${a}`;
                  const active = locked ? supported : currentPerms.includes(perm);
                  const isLast = a === ACTION_COLUMNS[ACTION_COLUMNS.length - 1];
                  return (
                    <td key={a} className={`text-center py-1 px-1 ${isLast ? "rounded-r-lg" : ""}`}>
                      {supported ? (
                        <PermCell
                          active={active}
                          locked={locked}
                          onToggle={() => onToggle(perm)}
                          label={`${mod.label} ${ACTION_LABELS[a]}`}
                        />
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderFeatureGrid(currentPerms: string[], locked: boolean, onToggle: (perm: string) => void) {
    if (PERMISSION_FEATURES.length === 0) return null;
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Zusatz-Funktionen
        </p>
        <div className="space-y-1">
          {PERMISSION_FEATURES.map((f) => {
            const active = locked ? true : currentPerms.includes(f.key);
            return (
              <div key={f.key} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-foreground/[0.02] dark:bg-foreground/[0.04]">
                <PermCell
                  active={active}
                  locked={locked}
                  onToggle={() => onToggle(f.key)}
                  label={f.label}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">{f.label}</p>
                  <p className="text-[11px] text-muted-foreground">{f.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          {scope === "partner"
            ? "Berechtigungen der Partner-Rolle. Steuert was Locationspartner im Partner-Portal sehen und tun dürfen."
            : "Pro Rolle steuerst du, welche Bereiche sichtbar sind und welche Aktionen erlaubt. Admin sieht und darf immer alles."}
        </p>
        {scope === "firma" && (
          <button type="button" onClick={() => setShowCreate(true)} className="kasten kasten-red">
            <Plus className="h-3.5 w-3.5" />Neue Rolle
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2].map((i) => <Card key={i} className="animate-pulse bg-card"><CardContent className="p-4 h-12" /></Card>)}</div>
      ) : (
        <div className="space-y-2">
          {roles.map((role) => {
            const locked = role.slug === "admin";
            const dirty = !locked && isDirty(role);
            const currentPerms = edits[role.slug] ?? [];
            const isOpen = expanded.has(role.slug);
            return (
              <Card key={role.slug} className="bg-card overflow-hidden">
                {/* Header — komplett klickbar fuer Aufklappen. */}
                <button
                  type="button"
                  onClick={() => toggleExpanded(role.slug)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2 hover:bg-foreground/[0.02] transition-colors text-left"
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <h3 className="font-semibold text-sm">{role.label}</h3>
                    {role.is_system && (
                      <span className="inline-flex px-1.5 py-0 text-[10px] font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                        System
                      </span>
                    )}
                    {locked && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0 text-[10px] font-medium rounded-full bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300">
                        <Lock className="h-2.5 w-2.5" />Geschützt
                      </span>
                    )}
                    {dirty && (
                      <span className="inline-flex px-1.5 py-0 text-[10px] font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                        Ungespeichert
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {dirty && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); saveRole(role); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); saveRole(role); } }}
                        aria-disabled={savingSlug === role.slug}
                        className="kasten kasten-red"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {savingSlug === role.slug ? "Speichert…" : "Speichern"}
                      </span>
                    )}
                    {!role.is_system && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); deleteRole(role); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); deleteRole(role); } }}
                        aria-label="Rolle löschen"
                        className="kasten kasten-muted"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                </button>

                {isOpen && (
                  <CardContent className="px-4 pt-0 pb-4 space-y-4 border-t border-border">
                    <div className="pt-3 text-[11px] text-muted-foreground italic">
                      Rotes X = erlaubt. Klick auf eine Zelle setzt oder entfernt die Berechtigung.
                    </div>
                    {renderModuleMatrix(role.slug, currentPerms, locked, (perm) => togglePermission(role.slug, perm))}
                    {renderFeatureGrid(currentPerms, locked, (perm) => togglePermission(role.slug, perm))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={showCreate} onClose={() => !creating && setShowCreate(false)} title="Neue Rolle" size="lg">
        <form onSubmit={createRole} className="space-y-4">
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground/70 ml-1">Name *</p>
            <Input
              value={createForm.label}
              onChange={(e) => setCreateForm({ ...createForm, label: e.target.value })}
              placeholder="z.B. Vertrieb, Buchhaltung"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground/70 ml-1">Berechtigungen</p>
            <p className="text-[11px] text-muted-foreground italic mb-2">
              Rotes X = erlaubt. Klick auf eine Zelle setzt oder entfernt die Berechtigung.
            </p>
            {renderModuleMatrix("create", createForm.permissions, false, (perm) => {
              const next = createForm.permissions.includes(perm)
                ? createForm.permissions.filter((s) => s !== perm)
                : [...createForm.permissions, perm];
              setCreateForm({ ...createForm, permissions: next });
            })}
            <div className="pt-3">
              {renderFeatureGrid(createForm.permissions, false, (perm) => {
                const next = createForm.permissions.includes(perm)
                  ? createForm.permissions.filter((s) => s !== perm)
                  : [...createForm.permissions, perm];
                setCreateForm({ ...createForm, permissions: next });
              })}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setShowCreate(false)} disabled={creating} className="kasten kasten-muted flex-1">Abbrechen</button>
            <button type="submit" disabled={creating || !createForm.label} className="kasten kasten-red flex-1">
              {creating ? "Erstellt…" : "Rolle anlegen"}
            </button>
          </div>
        </form>
      </Modal>

      {ConfirmModalElement}
    </div>
  );
}
