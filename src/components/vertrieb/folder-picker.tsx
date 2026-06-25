"use client";

// Folder-Picker fuer den Lead-Editor — kleines Inline-Dropdown
// "Ordner: <name> ▾". Zeigt den Tree als verschachtelte Optionen,
// klick = Lead in den Folder verschieben, "Aus Ordner entfernen" als
// erster Eintrag. Privat pro User (RLS).

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Folder, FolderInput, FolderOpen, X, ChevronDown } from "lucide-react";

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
}

interface Props {
  leadId: string;
  /** Nach erfolgreicher Aenderung — Parent darf neu laden. */
  onChanged?: () => void;
}

export function VertriebFolderPicker({ leadId, onChanged }: Props) {
  const supabase = createClient();
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const [foldersRes, mineRes] = await Promise.all([
      supabase.from("vertrieb_folders").select("id, parent_id, name").order("name"),
      user
        ? supabase
            .from("vertrieb_lead_folders")
            .select("folder_id")
            .eq("lead_id", leadId)
            .eq("owner_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setFolders((foldersRes.data ?? []) as FolderRow[]);
    const fid = (mineRes.data as { folder_id: string } | null)?.folder_id ?? null;
    setCurrentFolderId(fid);
  }, [supabase, leadId]);

  useEffect(() => { load(); }, [load]);

  // Outside-click schliesst das Menue.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const flatTree = useMemo(() => {
    // Tree als flache Liste mit depth — fuer dropdown-Anzeige.
    const childrenBy = new Map<string | null, FolderRow[]>();
    for (const f of folders) {
      const arr = childrenBy.get(f.parent_id) ?? [];
      arr.push(f);
      childrenBy.set(f.parent_id, arr);
    }
    const out: { f: FolderRow; depth: number }[] = [];
    function walk(parentId: string | null, depth: number) {
      const kids = (childrenBy.get(parentId) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
      for (const k of kids) {
        out.push({ f: k, depth });
        walk(k.id, depth + 1);
      }
    }
    walk(null, 0);
    return out;
  }, [folders]);

  const currentName = currentFolderId ? folders.find((f) => f.id === currentFolderId)?.name ?? null : null;

  async function assignTo(folderId: string | null) {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Nicht eingeloggt"); setSaving(false); return; }
    if (folderId === null) {
      // Aus Ordner entfernen
      const { error } = await supabase
        .from("vertrieb_lead_folders")
        .delete()
        .eq("lead_id", leadId)
        .eq("owner_id", user.id);
      if (error) { toast.error("Konnte nicht entfernen: " + error.message); setSaving(false); return; }
      toast.success("Aus Ordner entfernt");
    } else {
      // Upsert: ein Lead pro Owner in genau einem Folder
      const { error } = await supabase
        .from("vertrieb_lead_folders")
        .upsert({ lead_id: leadId, owner_id: user.id, folder_id: folderId }, { onConflict: "lead_id,owner_id" });
      if (error) { toast.error("Konnte nicht verschieben: " + error.message); setSaving(false); return; }
      toast.success("In Ordner verschoben");
    }
    setCurrentFolderId(folderId);
    setOpen(false);
    setSaving(false);
    onChanged?.();
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-card text-xs font-medium hover:bg-foreground/[0.04] transition-colors disabled:opacity-50"
        data-tooltip={currentName ? `In Ordner: ${currentName}` : "In einen Ordner verschieben"}
      >
        {currentFolderId ? (
          <FolderOpen className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        ) : (
          <FolderInput className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="max-w-[140px] truncate">{currentName ?? "Kein Ordner"}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 min-w-[220px] max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg py-1">
          {currentFolderId && (
            <button
              type="button"
              onClick={() => assignTo(null)}
              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-foreground/[0.06] inline-flex items-center gap-1.5 text-red-600 dark:text-red-400"
            >
              <X className="h-3.5 w-3.5" />Aus Ordner entfernen
            </button>
          )}
          {flatTree.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-muted-foreground italic">
              Noch keine Ordner. Lege links in der Ordner-Sidebar einen an.
            </p>
          ) : (
            flatTree.map(({ f, depth }) => {
              const isCurrent = f.id === currentFolderId;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => assignTo(f.id)}
                  disabled={isCurrent}
                  className={`w-full text-left px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5 ${
                    isCurrent ? "bg-foreground/[0.06] text-foreground/60 cursor-default" : "hover:bg-foreground/[0.06] text-foreground/90"
                  }`}
                  style={{ paddingLeft: `${depth * 12 + 10}px` }}
                >
                  <Folder className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="truncate">{f.name}</span>
                  {isCurrent && <span className="ml-auto text-[10px] text-muted-foreground shrink-0">aktuell</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
