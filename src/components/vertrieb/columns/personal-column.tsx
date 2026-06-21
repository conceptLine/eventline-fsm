"use client";

/**
 * PersonalColumn — Leads die einem User zugewiesen sind.
 *
 * Default: zeigt die eigenen Leads (assigned_to = currentUserId).
 * Admin: Person-Switcher oben (Dropdown) zum Anzeigen fremder Pipelines.
 *
 * Drop-Target: Lead aus GeneralColumn hier rein = assign an die aktuell
 * ausgewaehlte Person.
 * Drag-Source: jede Lead-Row ist draggable, kann zurueck in General
 * (= unassign) oder in eine andere personal column (= reassign, nur Admin).
 *
 * Reassign-Regel: nur Admins koennen einem Lead einen anderen Owner geben.
 * Wenn nicht-Admin einen Lead droppt der schon einem anderen gehoert,
 * blockt der Parent-Handler — wir zeigen nur die UI.
 */

import { useMemo, useState } from "react";
import { LeadRow } from "./lead-row";
import { SearchableSelect } from "@/components/searchable-select";
import { Input } from "@/components/ui/input";
import { Inbox, Search, Moon } from "lucide-react";
import type { VertriebContact } from "@/types";
import { daysSinceLastTouch, leadSortBucket } from "@/lib/vertrieb-anomaly";

interface Props {
  contacts: VertriebContact[];
  selectedId: string | null;
  onSelect: (c: VertriebContact) => void;
  /** Auf wen ist die Spalte aktuell gefiltert? Standard: currentUserId. */
  viewedUserId: string;
  setViewedUserId: (id: string) => void;
  currentUserId: string;
  isAdmin: boolean;
  salesPeople: { id: string; full_name: string }[];
  /** Drop von einem Lead in diese Spalte. Parent entscheidet ob assign
   *  erlaubt (Reassign-Regel). */
  onAssign: (leadId: string, toUserId: string) => void;
}

export function PersonalColumn({
  contacts, selectedId, onSelect, viewedUserId, setViewedUserId,
  currentUserId, isAdmin, salesPeople, onAssign,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [search, setSearch] = useState("");
  const [showSnoozed, setShowSnoozed] = useState(false);
  const nowMs = Date.now();

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return contacts
      .filter((c) => c.assigned_to === viewedUserId && c.status !== "gewonnen" && c.status !== "abgesagt" && c.status !== "verworfen")
      .filter((c) => !q || c.firma.toLowerCase().includes(q) || (c.ansprechperson || "").toLowerCase().includes(q))
      // Snoozed-Leads aus der aktiven Sicht ausblenden — koennen via
      // 'Snoozed'-Filter (siehe Header) wieder eingeblendet werden.
      .filter((c) => {
        if (showSnoozed) return true;
        if (!c.wiedervorlage_snoozed || !c.wiedervorlage_am) return true;
        return new Date(c.wiedervorlage_am).getTime() <= nowMs;
      })
      .sort((a, b) => {
        // Bucket-basiert: vergessene Stale-Leads ohne Reminder zuerst,
        // dann ueberfaellige Reminder, dann stale-mit-Reminder, dann Rest
        // (siehe leadSortBucket in vertrieb-anomaly.ts). Innerhalb des
        // Buckets nach aging-days DESC.
        const ba = leadSortBucket(a, nowMs);
        const bb = leadSortBucket(b, nowMs);
        if (ba !== bb) return ba - bb;
        const ad = daysSinceLastTouch(a, nowMs);
        const bd = daysSinceLastTouch(b, nowMs);
        if (ad === null && bd === null) return 0;
        if (ad === null) return 1;
        if (bd === null) return -1;
        return bd - ad;
      });
  }, [contacts, viewedUserId, nowMs, search, showSnoozed]);

  const snoozedCount = useMemo(
    () => contacts.filter((c) =>
      c.assigned_to === viewedUserId
      && c.status !== "gewonnen" && c.status !== "abgesagt" && c.status !== "verworfen"
      && c.wiedervorlage_snoozed
      && c.wiedervorlage_am
      && new Date(c.wiedervorlage_am).getTime() > nowMs
    ).length,
    [contacts, viewedUserId, nowMs],
  );

  const viewedName = salesPeople.find((s) => s.id === viewedUserId)?.full_name ?? "Mich";

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const data = e.dataTransfer.getData("text/plain");
    if (!data.startsWith("lead:")) return;
    const leadId = data.slice(5);
    onAssign(leadId, viewedUserId);
  }

  // Person-Switcher Items: Mich zuerst, dann alle anderen.
  const peopleOptions = useMemo(() => {
    const me = salesPeople.find((s) => s.id === currentUserId);
    const others = salesPeople.filter((s) => s.id !== currentUserId);
    const items: { id: string; label: string }[] = [];
    if (me) items.push({ id: me.id, label: `Meine (${me.full_name})` });
    items.push(...others.map((s) => ({ id: s.id, label: s.full_name })));
    return items;
  }, [salesPeople, currentUserId]);

  return (
    <div
      className={`flex flex-col h-full min-h-0 ${dragOver ? "ring-2 ring-red-500 ring-inset" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="p-2 border-b border-border space-y-1.5 shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
          {viewedUserId === currentUserId ? "Meine" : viewedName} · {filtered.length}
        </p>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Suche…" className="pl-7 h-8 text-xs"
          />
        </div>
        {snoozedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowSnoozed((v) => !v)}
            className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
              showSnoozed
                ? "border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            <Moon className="h-2.5 w-2.5" />Snoozed ({snoozedCount})
          </button>
        )}
        {/* Person-Switcher fuer Admins. Nicht-Admins sehen fix die eigene. */}
        {isAdmin && peopleOptions.length > 1 && (
          <SearchableSelect
            value={viewedUserId}
            onChange={setViewedUserId}
            items={peopleOptions}
            searchable={false}
            clearable={false}
            active={viewedUserId !== currentUserId}
          />
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-xs text-muted-foreground space-y-2">
            <Inbox className="h-6 w-6 mx-auto opacity-40" />
            <p>Leer.</p>
            <p className="text-[10px] opacity-70">Leads aus der linken Spalte hierher ziehen.</p>
          </div>
        ) : filtered.map((c) => (
          <LeadRow
            key={c.id}
            contact={c}
            selected={selectedId === c.id}
            onClick={onSelect}
            draggable
          />
        ))}
      </div>
    </div>
  );
}
