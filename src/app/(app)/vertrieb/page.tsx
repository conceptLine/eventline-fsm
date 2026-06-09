"use client";

/**
 * Vertrieb-Liste — Sales-Cockpit + Filter + Lead-Cards.
 *
 * Detail/Edit eines Leads liegt auf /vertrieb/[id] (Detail-Page).
 * Hier:
 *  - StatCards (Aktive Pipeline / Events 30 Tage / Win-Rate)
 *  - Funnel (Stage-Verteilung mit Outcome-Footer)
 *  - Suche + Kategorie/Status/Priority-Filter + Sort-Dropdown
 *  - Archiv-Toggle (zeigt nur 'abgesagt')
 *  - "Neuer Lead"-Flow (CategoryPicker → LeadForm-Inline → Insert → redirect)
 *  - Lead-Cards (Klick navigiert zur Detail-Page)
 *
 * StatCards/Funnel sind im Archiv-Modus ausgeblendet — alle Karten
 * dort haben den gleichen Status, das Reporting waere sinnfrei.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { deleteRow } from "@/lib/db-mutations";
import { TOAST } from "@/lib/messages";
import { usePermissions } from "@/lib/use-permissions";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import type { VertriebContact, VertriebStatus, VertriebPriority, VertriebKategorie } from "@/types";
import {
  Plus, TrendingUp, Search, Archive, PartyPopper, Trophy, AlertTriangle,
  LayoutGrid, LayoutList, Columns3,
} from "lucide-react";
import { toast } from "sonner";
import { STATUS_OPTIONS, PRIORITY_OPTIONS, KATEGORIE_OPTIONS } from "./constants";
import { LeadCard } from "@/components/vertrieb/lead-card";
import { VertriebTableView } from "@/components/vertrieb/views/table-view";
import { VertriebKanbanView } from "@/components/vertrieb/views/kanban-view";
import { useConfirm } from "@/components/ui/use-confirm";
import { SearchableSelect } from "@/components/searchable-select";
import { detectLeadAnomaly, hasAnomaly, parseEventStart as parseEventStartCommon } from "@/lib/vertrieb-anomaly";

type Counts = {
  total: number; offen: number; kontaktiert: number; gespraech: number;
  gewonnen: number; abgesagt: number; step_1: number; step_2: number;
  step_3: number; step_4: number;
};

type ViewMode = "cards" | "table" | "kanban";
type OwnerFilter = "all" | "mine" | string; // string = profile-id

export default function VertriebPage() {
  const router = useRouter();
  const supabase = createClient();
  const { can } = usePermissions();
  const { confirm, ConfirmModalElement } = useConfirm();

  // Daten
  const [contacts, setContacts] = useState<VertriebContact[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Sales-Mitarbeiter fuer den Assignee-Toggle. Hardcoded gefiltert auf
  // Leo+Mischa+Raul per Email — die anderen Admins (admin test, ggf. andere)
  // sind nicht im Sales-Workflow. Reihenfolge: alphabetisch nach Name.
  const [salesPeople, setSalesPeople] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Suche/Filter
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<VertriebStatus | "all">("all");
  const [filterPriority, setFilterPriority] = useState<VertriebPriority | "all">("all");
  const [filterKategorie, setFilterKategorie] = useState<VertriebKategorie | "all">("all");
  // Sort-Kriterium: Standard ist nr (Reihenfolge der Anlage). Andere
  // Kriterien helfen dem Sales-Workflow:
  //  - event: naechstes Event zuerst (Planungsblick)
  //  - stale: aelteste datum_kontakt zuerst (= veraltet, nachhaken)
  //  - priority: top zuerst (was ist wichtig)
  type SortBy = "nr" | "event" | "stale" | "priority";
  const [sortBy, setSortBy] = useState<SortBy>("nr");

  // View-Toggle (Cards/Tabelle/Kanban) + Owner-Filter — persistent in
  // localStorage damit beim Reload die Praeferenz erhalten bleibt.
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "cards";
    const stored = localStorage.getItem("vertrieb-view");
    return (stored === "cards" || stored === "table" || stored === "kanban") ? stored : "cards";
  });
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("vertrieb-view", view);
  }, [view]);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>(() =>
    typeof window !== "undefined" ? (localStorage.getItem("vertrieb-owner") as OwnerFilter) ?? "all" : "all",
  );
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("vertrieb-owner", ownerFilter);
  }, [ownerFilter]);
  // Single Toggle: "Auffaellig" filter — zeigt nur Leads mit aktiver
  // Anomalie. Ersatz fuer die alten 4 Quick-Chips (Hot/Stale/Soon/Forgotten).
  const [onlyAnomalies, setOnlyAnomalies] = useState(false);

  // Archiv-Modus: zeigt ausschliesslich abgesagte Leads. Persistent damit
  // ein versehentlicher Reload den Modus nicht verliert. Pattern uebernommen
  // vom Operations-Archiv (auftraege/page.tsx).
  const [showArchive, setShowArchive] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("vertrieb-archive") === "true" : false,
  );
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("vertrieb-archive", String(showArchive));
  }, [showArchive]);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("realtime:vertrieb_contacts", handler);
    return () => window.removeEventListener("realtime:vertrieb_contacts", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    const [{ data }, countsRes, salesRes, userRes] = await Promise.all([
      supabase.from("vertrieb_contacts").select("*").order("nr").limit(2000),
      supabase.from("vertrieb_counts").select("*").single(),
      supabase
        .from("profiles")
        .select("id, full_name")
        .in("email", ["leo@eventline-basel.com", "mischa@eventline-basel.com", "raul@eventline-basel.com"])
        .eq("is_active", true)
        .order("full_name"),
      supabase.auth.getUser(),
    ]);
    if (data) setContacts(data as VertriebContact[]);
    if (countsRes.data) setCounts(countsRes.data);
    if (salesRes.data) setSalesPeople(salesRes.data);
    if (userRes.data.user) setCurrentUserId(userRes.data.user.id);
    setLoading(false);
  }

  // Optimistic Assignee-Update — sofort lokal anzeigen, im Hintergrund
  // schreiben. Bei Fehler revert + Toast. Nicht blocking damit der User
  // sofort sieht dass der Toggle reagiert hat.
  async function assignLead(leadId: string, userId: string | null) {
    const before = contacts.find((c) => c.id === leadId)?.assigned_to;
    setContacts((prev) => prev.map((c) => c.id === leadId ? { ...c, assigned_to: userId } : c));
    const { error } = await supabase
      .from("vertrieb_contacts")
      .update({ assigned_to: userId })
      .eq("id", leadId);
    if (error) {
      // Revert
      setContacts((prev) => prev.map((c) => c.id === leadId ? { ...c, assigned_to: before ?? null } : c));
      TOAST.supabaseError(error, "Zuweisung konnte nicht gespeichert werden");
    }
  }

  async function deleteContact(id: string) {
    const ok = await confirm({ title: "Lead löschen?", confirmLabel: "Löschen", variant: "red" });
    if (!ok) return;
    const result = await deleteRow("vertrieb_contacts", id);
    if (!result.ok) { toast.error("Löschen fehlgeschlagen: " + (result.error ?? "Unbekannt")); return; }
    toast.success("Eintrag gelöscht");
    load();
  }

  // event_start aus dem JSON-encodeten notizen-Feld pullen. Stable closure
  // ueber den shared parser aus lib/vertrieb-anomaly.
  const parseEventStart = parseEventStartCommon;
  const nowMs = Date.now();

  const filtered = contacts
    // Archiv-Trennung: Standard-View blendet 'abgesagt' aus, Archiv-View
    // zeigt ausschliesslich 'abgesagt'.
    .filter((c) => showArchive ? c.status === "abgesagt" : c.status !== "abgesagt")
    .filter((c) => filterKategorie === "all" || c.kategorie === filterKategorie)
    .filter((c) => filterStatus === "all" || c.status === filterStatus)
    .filter((c) => filterPriority === "all" || c.prioritaet === filterPriority)
    .filter((c) => {
      const q = search.toLowerCase();
      return !q || c.firma.toLowerCase().includes(q) || (c.ansprechperson || "").toLowerCase().includes(q) || (c.branche || "").toLowerCase().includes(q);
    })
    // Owner-Filter: "all" = alle, "mine" = ich, sonst spezifische profile-id
    .filter((c) => {
      if (ownerFilter === "all") return true;
      if (ownerFilter === "mine") return c.assigned_to === currentUserId;
      return c.assigned_to === ownerFilter;
    })
    // Auffaellig-Toggle: nur Leads mit aktiver Anomalie
    .filter((c) => !onlyAnomalies || hasAnomaly(detectLeadAnomaly(c, nowMs)));

  // Sortierung — separat nach Filter, damit die Filter-Logik linear bleibt.
  const sorted = filtered.slice().sort((a, b) => {
    if (sortBy === "event") {
      const aE = parseEventStart(a);
      const bE = parseEventStart(b);
      if (!aE && !bE) return a.nr - b.nr;
      if (!aE) return 1;
      if (!bE) return -1;
      return aE.getTime() - bE.getTime();
    }
    if (sortBy === "stale") {
      // datum_kontakt aufsteigend = aelteste oben (= laengste nicht
      // angefasst). nulls landen unten.
      if (!a.datum_kontakt && !b.datum_kontakt) return a.nr - b.nr;
      if (!a.datum_kontakt) return 1;
      if (!b.datum_kontakt) return -1;
      return a.datum_kontakt.localeCompare(b.datum_kontakt);
    }
    if (sortBy === "priority") {
      const order: Record<VertriebPriority, number> = { top: 0, gut: 1, mittel: 2 };
      const cmp = order[a.prioritaet] - order[b.prioritaet];
      return cmp !== 0 ? cmp : a.nr - b.nr;
    }
    return a.nr - b.nr;
  });

  const statusCounts: Record<string, number> = counts ? {
    offen: counts.offen, kontaktiert: counts.kontaktiert, gespraech: counts.gespraech,
    gewonnen: counts.gewonnen, abgesagt: counts.abgesagt,
  } : {};

  // Anomaly-Count (gegen GESAMTE aktive Daten, nicht gegen gefilterte —
  // damit die Zahl stabil bleibt egal welcher Filter aktiv ist).
  const anomalyCount = useMemo(() => {
    return contacts.reduce((n, c) => {
      if (c.status === "abgesagt" || c.status === "gewonnen") return n;
      return n + (hasAnomaly(detectLeadAnomaly(c, nowMs)) ? 1 : 0);
    }, 0);
  }, [contacts, nowMs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{showArchive ? "Vertrieb Archiv" : "Vertrieb"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {showArchive
              ? `${statusCounts.abgesagt || 0} abgesagte Leads`
              : `${(counts?.total ?? 0) - (statusCounts.abgesagt || 0)} aktive Kontakte · ${statusCounts.gewonnen || 0} gewonnen · ${statusCounts.offen || 0} offen`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              // Beim Wechsel den Status-Filter zuruecksetzen — sonst koennte
              // ein "abgesagt"-Filter aus alter Session ins Archiv mitgehen
              // und dort leere Resultate produzieren.
              setFilterStatus("all");
              setShowArchive(!showArchive);
            }}
            className={showArchive ? "kasten-active" : "kasten-toggle-off"}
          >
            <Archive className="h-3.5 w-3.5" />
            {showArchive ? "Aktive anzeigen" : `Archiv (${statusCounts.abgesagt || 0})`}
          </button>
          {!showArchive && can("vertrieb:create") && (
            <Link href="/vertrieb/neu" className="kasten kasten-red">
              <Plus className="h-3.5 w-3.5" />Lead
            </Link>
          )}
        </div>
      </div>

      {/* KPI-Cards + Funnel — im Archiv und auf Mobile ausgeblendet. */}
      {!showArchive && counts && counts.total > 0 && (
        <div className="hidden md:grid gap-3 md:grid-cols-3">
          <StatCards counts={counts} contacts={contacts} parseEventStart={parseEventStart} />
        </div>
      )}
      {!showArchive && counts && counts.total > 0 && (
        <div className="hidden md:block">
          <Funnel counts={counts} />
        </div>
      )}

      {/* Toolbar — eine Zeile: Suche + Owner + Status + (Auffaellig) + Views.
          Kategorie + Priority + Sort wurden in das "Mehr"-Dropdown ausgelagert,
          um die Standard-Sicht zu entrumpeln. */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Firma, Person oder Branche..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 bg-card" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Owner-Filter — ersetzt den "Meine"-Chip und das Owner-Sub-View
              gleichzeitig. Default "Alle", "Meine" hebt den eigenen Bestand
              hervor, sonst spezifische Person. */}
          <div className="w-40">
            <SearchableSelect
              value={ownerFilter}
              onChange={(v) => setOwnerFilter(v as OwnerFilter)}
              items={[
                { id: "all", label: "Alle Sales" },
                ...(currentUserId ? [{ id: "mine", label: "Meine" }] : []),
                ...salesPeople.filter((s) => s.id !== currentUserId).map((s) => ({ id: s.id, label: s.full_name })),
              ]}
              searchable={false} clearable={false} active={ownerFilter !== "all"}
            />
          </div>
          {/* Status-Filter (wichtigster) */}
          {!showArchive && (
            <div className="w-40">
              <SearchableSelect
                value={filterStatus} onChange={(v) => setFilterStatus(v as VertriebStatus | "all")}
                items={[
                  { id: "all", label: "Alle Status" },
                  ...STATUS_OPTIONS.filter((s) => s.value !== "abgesagt").map((s) => ({ id: s.value, label: `${s.label} (${statusCounts[s.value] || 0})` })),
                ]}
                searchable={false} clearable={false} active={filterStatus !== "all"}
              />
            </div>
          )}

          {/* Mehr-Filter Dropdown — Kategorie/Priority/Sort hier rein,
              damit die Standard-Toolbar nicht ueberladen wirkt. */}
          <MoreFiltersPopover
            filterKategorie={filterKategorie} setFilterKategorie={setFilterKategorie}
            filterPriority={filterPriority} setFilterPriority={setFilterPriority}
            sortBy={sortBy} setSortBy={setSortBy}
          />

          {/* Auffaellig-Toggle: prominent rechts, mit Count-Badge. */}
          {!showArchive && anomalyCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyAnomalies((v) => !v)}
              className={onlyAnomalies ? "kasten kasten-red" : "kasten-toggle-off"}
              data-tooltip="Nur Leads die Aufmerksamkeit brauchen (Stale, Hot+Offen, Event bald, Vergessen)"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {anomalyCount} brauchen Aufmerksamkeit
            </button>
          )}

          {/* View-Toggle ganz rechts */}
          {!showArchive && (
            <div className="ml-auto flex gap-1 p-1 rounded-lg bg-muted">
              <ViewBtn icon={LayoutGrid} label="Cards" active={view === "cards"} onClick={() => setView("cards")} />
              <ViewBtn icon={LayoutList} label="Tabelle" active={view === "table"} onClick={() => setView("table")} />
              <ViewBtn icon={Columns3} label="Kanban" active={view === "kanban"} onClick={() => setView("kanban")} />
            </div>
          )}
        </div>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Card key={i} className="animate-pulse bg-card"><CardContent className="p-4"><div className="h-5 bg-foreground/10 dark:bg-foreground/15 rounded w-1/3" /></CardContent></Card>)}</div>
      ) : sorted.length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="py-16 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              {showArchive ? <Archive className="h-7 w-7 text-gray-400" /> : <TrendingUp className="h-7 w-7 text-gray-400" />}
            </div>
            <h3 className="font-semibold text-lg">{showArchive ? "Keine abgesagten Leads" : "Keine Kontakte"}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {showArchive ? "Hier landen Leads sobald sie auf 'abgesagt' gesetzt werden." : "Erstelle deinen ersten Kontakt."}
            </p>
          </CardContent>
        </Card>
      ) : view === "table" ? (
        <VertriebTableView contacts={sorted} salesPeople={salesPeople} />
      ) : view === "kanban" ? (
        <VertriebKanbanView contacts={sorted} salesPeople={salesPeople} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((c) => (
            <LeadCard
              key={c.id}
              contact={c}
              onClick={(c2) => router.push(`/vertrieb/${c2.id}`)}
              onDelete={deleteContact}
              canDelete={can("vertrieb:delete")}
              salesPeople={salesPeople}
              onAssign={assignLead}
            />
          ))}
        </div>
      )}
      {ConfirmModalElement}
    </div>
  );
}

// ------------------ ViewBtn + MoreFiltersPopover ------------------

function ViewBtn({ icon: Icon, label, active, onClick }: {
  icon: typeof LayoutGrid; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
        active ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
      data-tooltip={label}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

/** Popover mit den selten benutzten Filtern (Kategorie, Priority, Sort).
 *  Geschlossen by default — entrumpelt die Standard-Toolbar. */
function MoreFiltersPopover({
  filterKategorie, setFilterKategorie,
  filterPriority, setFilterPriority,
  sortBy, setSortBy,
}: {
  filterKategorie: VertriebKategorie | "all";
  setFilterKategorie: (v: VertriebKategorie | "all") => void;
  filterPriority: VertriebPriority | "all";
  setFilterPriority: (v: VertriebPriority | "all") => void;
  sortBy: "nr" | "event" | "stale" | "priority";
  setSortBy: (v: "nr" | "event" | "stale" | "priority") => void;
}) {
  const [open, setOpen] = useState(false);
  const activeCount =
    (filterKategorie !== "all" ? 1 : 0) +
    (filterPriority !== "all" ? 1 : 0) +
    (sortBy !== "nr" ? 1 : 0);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={activeCount > 0 ? "kasten-active" : "kasten-toggle-off"}
      >
        Mehr
        {activeCount > 0 && (
          <span className="ml-1 px-1.5 py-0 text-[10px] font-semibold rounded-full bg-foreground/15 dark:bg-foreground/20">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <>
          {/* Backdrop zum Schliessen */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 right-0 sm:left-0 w-64 rounded-lg border border-border bg-card shadow-lg p-3 space-y-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Kategorie</label>
              <div className="mt-1">
                <SearchableSelect
                  value={filterKategorie} onChange={(v) => setFilterKategorie(v as VertriebKategorie | "all")}
                  items={[{ id: "all", label: "Alle Kategorien" }, ...KATEGORIE_OPTIONS.map((k) => ({ id: k.value, label: k.label }))]}
                  searchable={false} clearable={false} active={filterKategorie !== "all"}
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Prioritaet</label>
              <div className="mt-1">
                <SearchableSelect
                  value={filterPriority} onChange={(v) => setFilterPriority(v as VertriebPriority | "all")}
                  items={[{ id: "all", label: "Alle Prioritäten" }, ...PRIORITY_OPTIONS.map((p) => ({ id: p.value, label: p.label }))]}
                  searchable={false} clearable={false} active={filterPriority !== "all"}
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sortierung</label>
              <div className="mt-1">
                <SearchableSelect
                  value={sortBy} onChange={(v) => setSortBy(v as "nr" | "event" | "stale" | "priority")}
                  items={[
                    { id: "nr", label: "Reihenfolge (Standard)" },
                    { id: "event", label: "Event-Datum (nächstes)" },
                    { id: "stale", label: "Letzter Kontakt (ältester)" },
                    { id: "priority", label: "Priorität (Top zuerst)" },
                  ]}
                  searchable={false} clearable={false} active={sortBy !== "nr"}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * StatCards — drei kompakte Kennzahl-Karten als Sales-Cockpit:
 *   1. Aktive Pipeline   — alle Leads in nicht-terminalen Stages
 *   2. Events 30 Tage    — Leads mit event_start in den naechsten 30 Tagen
 *   3. Win-Rate          — gewonnen / (gewonnen + abgesagt)
 * -------------------------------------------------------------------------- */
function StatCards({
  counts,
  contacts,
  parseEventStart,
}: {
  counts: Counts;
  contacts: VertriebContact[];
  parseEventStart: (c: VertriebContact) => Date | null;
}) {
  const aktive = counts.step_1 + counts.step_2 + counts.step_3 + counts.step_4;

  // Events 30 Tage: nur nicht-terminale Leads mit event_start in [today, today+30].
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in30 = new Date(today); in30.setDate(today.getDate() + 30);
  const events30 = contacts.filter((c) => {
    if (c.status === "abgesagt" || c.status === "gewonnen") return false;
    const ed = parseEventStart(c);
    return !!ed && ed >= today && ed <= in30;
  }).length;

  // Win-Rate: Sample-Groesse mitanzeigen damit der Wert einordbar ist.
  const closed = counts.gewonnen + counts.abgesagt;
  const winRate = closed > 0 ? Math.round((counts.gewonnen / closed) * 100) : null;

  return (
    <>
      <Card className="bg-card">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Aktive Pipeline</p>
              <p className="text-2xl font-bold leading-none mt-1.5 tabular-nums">{aktive}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Leads in Bearbeitung</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="bg-card">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
              <PartyPopper className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Events nächste 30 Tage</p>
              <p className="text-2xl font-bold leading-none mt-1.5 tabular-nums">{events30}</p>
              <p className="text-[11px] text-muted-foreground mt-1">anstehend</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="bg-card">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-green-50 dark:bg-green-500/15 text-green-600 dark:text-green-400 flex items-center justify-center shrink-0">
              <Trophy className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Win-Rate</p>
              <p className="text-2xl font-bold leading-none mt-1.5 tabular-nums">{winRate !== null ? `${winRate}%` : "—"}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {closed > 0 ? `${counts.gewonnen} von ${closed} abgeschlossen` : "noch keine abgeschlossen"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

/* --------------------------------------------------------------------------
 * Funnel — Sales-Pipeline als horizontale Bar-Liste.
 *
 * Snapshot, kein Flow: jede Stage zeigt wie viele Leads aktuell DORT
 * stehen, nicht wie viele die Stage passiert haben (Status-Change-Historie
 * fehlt). Trotzdem aussagekraeftiger als der Donut weil Stages in Reihenfolge
 * stehen und die Bar-Breiten relativ zur staerksten Stage skalieren — der
 * "Funnel-Effekt" wird visuell sichtbar.
 * -------------------------------------------------------------------------- */
function Funnel({ counts }: { counts: Counts }) {
  // Style: tinted Background + 2px solid Border in der Stage-Farbe — gleiche
  // Optik wie der TrendChart auf /abrechnung. RGB-Werte stammen aus den
  // --status-X CSS-Variablen; rgba(...)-Klassen muessen statisch im Code
  // stehen damit Tailwind-JIT sie picken kann.
  const stages = [
    { nr: 1, label: "Offen",         count: counts.step_1, color: "var(--status-gray)",    tint: "bg-[rgba(100,116,139,0.12)] dark:bg-[rgba(100,116,139,0.18)]" },
    { nr: 2, label: "Kontaktiert",   count: counts.step_2, color: "var(--status-blue)",    tint: "bg-[rgba(37,99,235,0.12)] dark:bg-[rgba(37,99,235,0.18)]" },
    { nr: 3, label: "Finalisierung", count: counts.step_3, color: "var(--status-green)",   tint: "bg-[rgba(0,168,107,0.12)] dark:bg-[rgba(0,168,107,0.18)]" },
    { nr: 4, label: "Operations",    count: counts.step_4, color: "var(--status-emerald)", tint: "bg-[rgba(4,120,87,0.12)] dark:bg-[rgba(4,120,87,0.18)]" },
  ];
  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  return (
    <Card className="bg-card">
      <CardContent className="p-4 space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</p>
        <div className="space-y-2">
          {stages.map((s) => {
            const pct = (s.count / maxCount) * 100;
            return (
              <div key={s.nr} className="flex items-center gap-3">
                <span className="w-32 sm:w-40 text-xs font-medium shrink-0 truncate">{s.nr}. {s.label}</span>
                <div className="flex-1 h-7 flex items-center">
                  {s.count > 0 && (
                    <div
                      className={`h-7 rounded-md border-2 border-solid transition-all ${s.tint}`}
                      style={{
                        width: `${pct}%`,
                        borderColor: s.color,
                        minWidth: "10px",
                      }}
                    />
                  )}
                </div>
                <span className="w-8 text-right text-sm font-mono tabular-nums font-semibold shrink-0">{s.count}</span>
              </div>
            );
          })}
        </div>
        {/* Outcomes — getrennt unter dem Funnel weil sie kein "current state"
            sind sondern abgeschlossene Faelle. */}
        <div className="border-t border-border pt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--status-green)" }} />
            <span className="text-muted-foreground">Gewonnen</span>
            <strong className="tabular-nums">{counts.gewonnen}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--status-red)" }} />
            <span className="text-muted-foreground">Verloren</span>
            <strong className="tabular-nums">{counts.abgesagt}</strong>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
