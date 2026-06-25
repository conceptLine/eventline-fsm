"use client";

// Outlook-aehnliche Folder-Sidebar fuer das Vertriebs-Cockpit.
//
// Tree pro User (RLS sorgt fuer Isolation). Beliebig verschachtelt via
// parent_id. CRUD inline: neuer Folder (auf Root oder als Sub),
// Umbenennen, Loeschen. Klick auf einen Folder filtert die Listen
// rechts. Spezial-Eintraege:
//   "Alle Leads"   — kein Folder-Filter
//   "Ohne Folder"  — Leads die noch in keinem Folder vom Owner sind
//
// V1 ohne Drag&Drop von Leads — Verschieben passiert ueber den Picker
// im Lead-Editor (siehe folder-picker.tsx). Drag&Drop kann spaeter
// nachgezogen werden, das Datenmodell ist darauf ausgelegt.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TOAST } from "@/lib/messages";
import { toast } from "sonner";
import { ChevronRight, ChevronDown, Folder, FolderPlus, Inbox, Layers, Pencil, Trash2, Plus, Palette } from "lucide-react";
import { useConfirm } from "@/components/ui/use-confirm";
import { usePrompt } from "@/components/ui/use-prompt";
import { folderColor, FOLDER_COLOR_SLUGS, folderColorLabel, type FolderColorSlug } from "@/components/vertrieb/folder-colors";

export type FolderFilter = { kind: "all" } | { kind: "inbox" } | { kind: "folder"; id: string };

// DnD-Payload-Format matched lead-row.tsx: "lead:<id>".
const LEAD_DRAG_PREFIX = "lead:";

export interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  color: string | null;
}

interface Props {
  /** Aktuell ausgewaehlter Filter — Parent steuert das. */
  selected: FolderFilter;
  onSelect: (f: FolderFilter) => void;
  /** Map folder_id -> Anzahl Leads in diesem Folder (nur direkt, keine
   *  Children). Fuer "inbox" + "all" als spezielle keys. */
  counts: Map<string, number>;
  /** Aufgerufen wenn der Folder-Baum oder Lead-Zuordnungen sich aendern,
   *  damit Parent neu laden kann (Counts etc.). */
  onChanged: () => void;
}

export function VertriebFoldersSidebar({ selected, onSelect, counts, onChanged }: Props) {
  const supabase = createClient();
  const { confirm, ConfirmModalElement } = useConfirm();
  const { prompt, PromptModalElement } = usePrompt();
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // Welches Drop-Target gerade ein Lead-Drag ueber sich hat (fuer Highlight).
  // Special-Werte: "__inbox__". Sonst folder-id.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Color-Picker: welcher Folder hat ihn gerade offen (NULL = keiner).
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);

  // Lead via DnD in Folder (oder Inbox = aus Folder raus) verschieben.
  // Aufgerufen aus den onDrop-Handlern der Folder-Zeilen + Spezial-Items.
  const moveLeadToFolder = useCallback(async (leadId: string, folderId: string | null) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Nicht eingeloggt"); return; }
    if (folderId === null) {
      const { error } = await supabase
        .from("vertrieb_lead_folders")
        .delete()
        .eq("lead_id", leadId)
        .eq("owner_id", user.id);
      if (error) { TOAST.supabaseError(error, "Konnte nicht entfernen"); return; }
      toast.success("Aus Ordner entfernt");
    } else {
      const { error } = await supabase
        .from("vertrieb_lead_folders")
        .upsert({ lead_id: leadId, owner_id: user.id, folder_id: folderId }, { onConflict: "lead_id,owner_id" });
      if (error) { TOAST.supabaseError(error, "Konnte nicht verschieben"); return; }
      toast.success("In Ordner verschoben");
    }
    onChanged();
  }, [supabase, onChanged]);

  function parseLeadDrag(e: React.DragEvent): string | null {
    const data = e.dataTransfer.getData("text/plain");
    if (!data.startsWith(LEAD_DRAG_PREFIX)) return null;
    return data.slice(LEAD_DRAG_PREFIX.length);
  }

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("vertrieb_folders")
      .select("id, parent_id, name, sort_order, color")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) { TOAST.supabaseError(error); setLoading(false); return; }
    setFolders((data ?? []) as FolderRow[]);
    setLoading(false);
  }, [supabase]);

  async function setFolderColor(folderId: string, color: FolderColorSlug | null) {
    const { error } = await supabase.from("vertrieb_folders").update({ color }).eq("id", folderId);
    if (error) { TOAST.supabaseError(error); return; }
    setColorPickerFor(null);
    await load();
  }

  useEffect(() => { load(); }, [load]);

  // Bauen wir einen kleinen Index parent_id -> children fuer den Tree.
  const childrenBy = useMemo(() => {
    const map = new Map<string | null, FolderRow[]>();
    for (const f of folders) {
      const key = f.parent_id;
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    return map;
  }, [folders]);

  // Beim ersten Render: alle Root-Knoten ausgeklappt zeigen.
  useEffect(() => {
    if (!loading && expanded.size === 0 && folders.length > 0) {
      const rootIds = folders.filter((f) => !f.parent_id).map((f) => f.id);
      setExpanded(new Set(rootIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function createFolder(parentId: string | null) {
    const name = await prompt({
      title: parentId ? "Unterordner anlegen" : "Ordner anlegen",
      label: "Name",
      placeholder: "z.B. Hot Leads, Q3 2026, Basel...",
      confirmLabel: "Anlegen",
      variant: "blue",
      maxLength: 80,
    });
    if (!name) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Nicht eingeloggt"); return; }
    const { error } = await supabase.from("vertrieb_folders").insert({
      owner_id: user.id,
      parent_id: parentId,
      name,
      sort_order: folders.length,
    });
    if (error) { TOAST.supabaseError(error, "Konnte Ordner nicht anlegen"); return; }
    toast.success("Ordner angelegt");
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
    await load();
    onChanged();
  }

  async function renameFolder(f: FolderRow) {
    const name = await prompt({
      title: "Ordner umbenennen",
      label: "Neuer Name",
      defaultValue: f.name,
      confirmLabel: "Speichern",
      variant: "blue",
      maxLength: 80,
    });
    if (!name || name === f.name) return;
    const { error } = await supabase.from("vertrieb_folders").update({ name }).eq("id", f.id);
    if (error) { TOAST.supabaseError(error); return; }
    toast.success("Umbenannt");
    await load();
    onChanged();
  }

  async function deleteFolder(f: FolderRow) {
    const childCount = (childrenBy.get(f.id) ?? []).length;
    const leadCount = counts.get(f.id) ?? 0;
    const extra = childCount > 0 || leadCount > 0
      ? `\n\nEnthaelt ${childCount} Unterordner und ${leadCount} Lead-Zuordnung(en). Beides wird mit-geloescht (Leads selbst bleiben — nur die Zuordnung).`
      : "";
    const ok = await confirm({
      title: `Ordner "${f.name}" loeschen?`,
      message: `Aus deinem Postfach entfernt.${extra}`,
      confirmLabel: "Loeschen",
      variant: "red",
    });
    if (!ok) return;
    const { error } = await supabase.from("vertrieb_folders").delete().eq("id", f.id);
    if (error) { TOAST.supabaseError(error); return; }
    toast.success("Geloescht");
    if (selected.kind === "folder" && selected.id === f.id) onSelect({ kind: "all" });
    await load();
    onChanged();
  }

  function renderNode(f: FolderRow, depth: number): React.ReactNode {
    const kids = childrenBy.get(f.id) ?? [];
    const hasKids = kids.length > 0;
    const isOpen = expanded.has(f.id);
    const isSelected = selected.kind === "folder" && selected.id === f.id;
    const leadCount = counts.get(f.id) ?? 0;
    const isDropOver = dropTarget === f.id;
    return (
      <div key={f.id}>
        <div
          className={`group flex items-center gap-1 pr-1 py-1 rounded-md text-xs cursor-pointer transition-colors ${
            isDropOver
              ? "bg-blue-500/20 ring-2 ring-blue-500/60 text-foreground"
              : isSelected
                ? "bg-foreground/[0.08] text-foreground font-semibold"
                : "hover:bg-foreground/[0.04] text-foreground/80"
          }`}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          onClick={() => onSelect({ kind: "folder", id: f.id })}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("text/plain")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropTarget !== f.id) setDropTarget(f.id);
            }
          }}
          onDragLeave={() => { if (dropTarget === f.id) setDropTarget(null); }}
          onDrop={async (e) => {
            const id = parseLeadDrag(e);
            setDropTarget(null);
            if (!id) return;
            e.preventDefault();
            await moveLeadToFolder(id, f.id);
          }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (hasKids) toggle(f.id); }}
            className={`shrink-0 w-4 h-4 inline-flex items-center justify-center ${hasKids ? "text-foreground/60" : "opacity-0"}`}
            tabIndex={-1}
            aria-label={isOpen ? "Einklappen" : "Ausklappen"}
          >
            {hasKids && (isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
          </button>
          <Folder className={`h-3.5 w-3.5 shrink-0 ${folderColor(f.color).icon}`} />
          <span className="truncate flex-1">{f.name}</span>
          {leadCount > 0 && (
            <span className="text-[10px] font-mono tabular-nums text-foreground/50 shrink-0 px-1">{leadCount}</span>
          )}
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setColorPickerFor(colorPickerFor === f.id ? null : f.id); }}
              className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 text-foreground/60"
              data-tooltip="Farbe"
              aria-label="Farbe"
            >
              <Palette className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); createFolder(f.id); }}
              className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 text-foreground/60"
              data-tooltip="Unterordner anlegen"
              aria-label="Unterordner anlegen"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); renameFolder(f); }}
              className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 text-foreground/60"
              data-tooltip="Umbenennen"
              aria-label="Umbenennen"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); deleteFolder(f); }}
              className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-red-500/15 text-red-600 dark:text-red-400"
              data-tooltip="Loeschen"
              aria-label="Loeschen"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
        {colorPickerFor === f.id && (
          <div
            className="mx-2 my-1 p-2 rounded-lg border border-border bg-popover shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-6 gap-1.5">
              {FOLDER_COLOR_SLUGS.map((slug) => {
                const def = folderColor(slug);
                const isActive = (f.color ?? "amber") === slug;
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => setFolderColor(f.id, slug)}
                    className={`w-5 h-5 rounded-full ${def.dot} ${isActive ? `ring-2 ring-offset-1 ring-offset-popover ${def.ring}` : "hover:scale-110"} transition-transform`}
                    data-tooltip={folderColorLabel(slug)}
                    aria-label={folderColorLabel(slug)}
                  />
                );
              })}
            </div>
          </div>
        )}
        {hasKids && isOpen && (
          <div>{kids.map((k) => renderNode(k, depth + 1))}</div>
        )}
      </div>
    );
  }

  const rootFolders = childrenBy.get(null) ?? [];
  const allCount = counts.get("__all__") ?? 0;
  const inboxCount = counts.get("__inbox__") ?? 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2 py-2 border-b border-border shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ordner</span>
        <button
          type="button"
          onClick={() => createFolder(null)}
          className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 text-foreground/70"
          data-tooltip="Neuer Ordner"
          aria-label="Neuer Ordner"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
        {/* Spezial-Eintraege. "Ohne Ordner" ist auch Drop-Target: Lead
            wird aus seinem Folder entfernt (junction delete). */}
        <SpecialItem
          icon={<Layers className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />}
          label="Alle Leads"
          count={allCount}
          active={selected.kind === "all"}
          onClick={() => onSelect({ kind: "all" })}
        />
        <SpecialItem
          icon={<Inbox className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Ohne Ordner"
          count={inboxCount}
          active={selected.kind === "inbox"}
          onClick={() => onSelect({ kind: "inbox" })}
          isDropOver={dropTarget === "__inbox__"}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("text/plain")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropTarget !== "__inbox__") setDropTarget("__inbox__");
            }
          }}
          onDragLeave={() => { if (dropTarget === "__inbox__") setDropTarget(null); }}
          onDrop={async (e) => {
            const id = parseLeadDrag(e);
            setDropTarget(null);
            if (!id) return;
            e.preventDefault();
            await moveLeadToFolder(id, null);
          }}
        />
        <div className="my-1 border-t border-border" />
        {loading ? (
          <p className="text-[11px] text-muted-foreground italic px-2 py-1">Lade…</p>
        ) : rootFolders.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic px-2 py-1 leading-snug">
            Noch keine Ordner. Klick oben rechts auf <FolderPlus className="inline h-3 w-3 align-text-bottom" /> um den ersten anzulegen.
          </p>
        ) : (
          rootFolders.map((f) => renderNode(f, 0))
        )}
      </div>
      {ConfirmModalElement}
      {PromptModalElement}
    </div>
  );
}

function SpecialItem({ icon, label, count, active, onClick, isDropOver, onDragOver, onDragLeave, onDrop }: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  isDropOver?: boolean;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer transition-colors ${
        isDropOver
          ? "bg-blue-500/20 ring-2 ring-blue-500/60 text-foreground"
          : active
            ? "bg-foreground/[0.08] text-foreground font-semibold"
            : "hover:bg-foreground/[0.04] text-foreground/80"
      }`}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {icon}
      <span className="truncate flex-1">{label}</span>
      {count > 0 && (
        <span className="text-[10px] font-mono tabular-nums text-foreground/50">{count}</span>
      )}
    </div>
  );
}
