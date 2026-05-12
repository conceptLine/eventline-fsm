"use client";

/**
 * Tickets-Listenseite.
 *
 * Vier Typen (it, beleg, stempel_aenderung, material), drei Status
 * (offen, erledigt, abgelehnt). RLS sortiert: Mitarbeiter sehen ihre
 * eigenen + die ihnen zugewiesenen, Admins sehen alles.
 *
 * Layout 1:1 wie /auftraege /todos: Header + Filter-Bar + Cards.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/lib/use-permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/searchable-select";
import { NewTicketModal } from "@/components/tickets/new-ticket-modal";
import {
  Plus, Search, Ticket as TicketIcon, Wrench, Receipt, Clock, Package,
} from "lucide-react";
import type { TicketWithRelations, TicketType, TicketStatus } from "@/types";

type FilterStatus = "alle" | TicketStatus;
type FilterType = "alle" | TicketType;

// Tickets gelten als 'archiviert' wenn sie erledigt/abgelehnt sind UND
// das vor mehr als 14 Tagen passiert ist. Nur dann werden sie aus der
// aktiven Liste ausgeblendet.
const ARCHIVE_AFTER_DAYS = 14;

// Cursor-Pagination — 100 Rows pro Page, "Mehr laden"-Button am Ende.
// Bei 100 Mitarbeitern × ~5 Tickets/Monat ueberschreitet die Liste die
// 500-Bound aus Phase D nach knapp einem Jahr — hier dann sauber paginiert.
const PAGE_SIZE = 100;

const TYPE_META: Record<TicketType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  it:               { label: "IT-Problem",        icon: Wrench,  color: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/15" },
  beleg:            { label: "Beleg",              icon: Receipt, color: "text-amber-600  dark:text-amber-400  bg-amber-50  dark:bg-amber-500/15"  },
  stempel_aenderung:{ label: "Stempel-Änderung",  icon: Clock,   color: "text-green-600  dark:text-green-400  bg-green-50  dark:bg-green-500/15"  },
  material:         { label: "Material",          icon: Package, color: "text-red-600    dark:text-red-400    bg-red-50    dark:bg-red-500/15"    },
};

const STATUS_META: Record<TicketStatus, { label: string; classes: string }> = {
  offen:     { label: "Offen",     classes: "bg-blue-100  text-blue-700  dark:bg-blue-500/20  dark:text-blue-300"  },
  erledigt:  { label: "Erledigt",  classes: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" },
  abgelehnt: { label: "Abgelehnt", classes: "bg-red-100   text-red-700   dark:bg-red-500/20   dark:text-red-300"   },
};

export default function TicketsPage() {
  const supabase = createClient();
  const [tickets, setTickets] = useState<TicketWithRelations[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchNumber, setSearchNumber] = useState("");
  const [searchTitle, setSearchTitle] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("offen");
  const [filterType, setFilterType] = useState<FilterType>("alle");
  const [showNew, setShowNew] = useState(false);
  const { can } = usePermissions();
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Eigene User-ID laden — wird fuer den "Nur meine"-Filter gebraucht.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);
    })();
  }, [supabase]);

  // Query-Builder — beide Loader-Pfade (initial + load-more) bauen die
  // gleiche Query mit unterschiedlichem Cursor.
  // Cursor ist Composite (created_at, id) damit Tickets mit identischem
  // created_at (Bulk-Imports, KI-Analyse-Massenanlagen) deterministisch
  // sortiert werden und nichts in der naechsten Page durchrutscht.
  const buildQuery = useCallback((cursor: { ts: string; id: string } | null) => {
    let q = supabase
      .from("tickets")
      .select(`
        *,
        creator:profiles!created_by(full_name),
        assignee:profiles!assigned_to(full_name),
        resolver:profiles!resolved_by(full_name),
        attachments:ticket_attachments(id, filename, storage_path, mime_type)
      `)
      // Belege leben jetzt auf /abrechnung — aus der Tickets-Liste raus,
      // damit IT/Material/Stempel-Tickets nicht mit Buchhaltungs-Krempel
      // gemischt sind.
      .neq("type", "beleg")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      // PAGE_SIZE+1: der "(n+1)-Trick" → wenn wir 101 zurueckkriegen,
      // wissen wir es gibt mindestens eine weitere Page, ohne extra
      // count-Query zu machen.
      .limit(PAGE_SIZE + 1);

    if (cursor !== null) {
      // Composite-Cursor: lt(created_at) ODER (eq(created_at) AND lt(id))
      q = q.or(`created_at.lt.${cursor.ts},and(created_at.eq.${cursor.ts},id.lt.${cursor.id})`);
    }

    // Im Archiv-Modus den Status-Filter ignorieren — archivierte Tickets sind
    // per Definition NICHT "offen" (nur erledigt/abgelehnt nach 14 Tagen).
    if (!showArchive && filterStatus !== "alle") q = q.eq("status", filterStatus);
    if (filterType !== "alle") q = q.eq("type", filterType);
    if (showOnlyMine && currentUserId) q = q.eq("created_by", currentUserId);

    // Archive vs Active per Server-Side-Filter — vorher wurden ALLE Rows
    // geladen und client-seitig gefiltert.
    const archiveCutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    if (showArchive) {
      q = q.in("status", ["erledigt", "abgelehnt"]).lt("resolved_at", archiveCutoff);
    } else {
      q = q.or(`resolved_at.is.null,resolved_at.gte.${archiveCutoff}`);
    }

    const numQ = searchNumber.trim();
    if (numQ) {
      const n = parseInt(numQ, 10);
      if (Number.isFinite(n)) q = q.eq("ticket_number", n);
    }
    const titleQ = searchTitle.trim();
    if (titleQ) {
      // PostgREST or-Filter parsed Komma als Trennzeichen und Klammern als
      // Gruppierung. User-Input mit "," oder "(" zerschiesst sonst die Query
      // (search "ABB, Basel" wuerde unintendend zwei Filter werden).
      // Loesung: in Double-Quotes wrappen und embedded \"" + \\\\ escapen,
      // damit PostgREST den ganzen String als einen Wert behandelt.
      const escaped = titleQ.replace(/[\\"]/g, "\\$&");
      const like = `"%${escaped}%"`;
      q = q.or(`title.ilike.${like},description.ilike.${like}`);
    }
    return q;
  }, [supabase, filterStatus, filterType, showOnlyMine, showArchive, currentUserId, searchNumber, searchTitle]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await buildQuery(null);
    const rows = (data as unknown as TicketWithRelations[]) ?? [];
    setHasMore(rows.length > PAGE_SIZE);
    setTickets(rows.slice(0, PAGE_SIZE));
    setLoading(false);
  }, [buildQuery]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || tickets.length === 0) return;
    setLoadingMore(true);
    const last = tickets[tickets.length - 1];
    const { data } = await buildQuery({ ts: last.created_at, id: last.id });
    const rows = (data as unknown as TicketWithRelations[]) ?? [];
    setHasMore(rows.length > PAGE_SIZE);
    setTickets((prev) => [...prev, ...rows.slice(0, PAGE_SIZE)]);
    setLoadingMore(false);
  }, [buildQuery, loadingMore, hasMore, tickets]);

  useEffect(() => {
    const t = setTimeout(() => { load(); }, 200);
    return () => clearTimeout(t);
  }, [load]);

  function formatDate(iso: string): string {
    // timeZone explizit Europe/Zurich — sonst rendern Mitarbeiter in
    // anderen TZ den falschen Tag (created_at ist UTC im DB).
    return new Date(iso).toLocaleDateString("de-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", year: "2-digit" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3 min-h-9">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tickets</h1>
          <p className="text-sm text-muted-foreground mt-1">
            IT-Probleme · Belege · Stempel-Änderungen · Material-Anfragen
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowArchive((v) => !v)}
            className={showArchive ? "kasten-active" : "kasten-toggle-off"}
          >
            Archiv
          </button>
          {can("tickets:create") && (
            <button type="button" onClick={() => setShowNew(true)} className="kasten kasten-red">
              <Plus className="h-3.5 w-3.5" />Neues Ticket
            </button>
          )}
        </div>
      </div>

      {/* Filter-Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Suche Nummer */}
        <div className="relative w-full sm:w-44">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono text-muted-foreground/60 pointer-events-none">
            T-
          </span>
          <Input
            placeholder="0000"
            value={searchNumber}
            onChange={(e) => setSearchNumber(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            pattern="[0-9]*"
            className="pl-[2.4rem] h-9 font-mono bg-card"
            aria-label="Ticket-Nummer"
          />
        </div>
        {/* Suche Titel */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Titel oder Beschreibung…"
            value={searchTitle}
            onChange={(e) => setSearchTitle(e.target.value)}
            className="pl-9 h-9 bg-card"
            aria-label="Titel"
          />
        </div>
        <div className="w-full sm:w-44">
          <SearchableSelect
            value={filterStatus}
            onChange={(v) => setFilterStatus(v as FilterStatus)}
            items={[
              { id: "offen", label: "Offen" },
              { id: "erledigt", label: "Erledigt" },
              { id: "abgelehnt", label: "Abgelehnt" },
              { id: "alle", label: "Alle Status" },
            ]}
            searchable={false}
            clearable={false}
            active={filterStatus !== "offen"}
          />
        </div>
        <div className="w-full sm:w-44">
          <SearchableSelect
            value={filterType}
            onChange={(v) => setFilterType(v as FilterType)}
            items={[
              { id: "alle", label: "Alle Typen" },
              { id: "it", label: "IT-Problem" },
              { id: "stempel_aenderung", label: "Stempel-Änderung" },
              { id: "material", label: "Material" },
            ]}
            searchable={false}
            clearable={false}
            active={filterType !== "alle"}
          />
        </div>
        {/* "Nur meine"-Toggle nur fuer User die normalerweise alle Tickets sehen
            (tickets:manage). Andere sehen via RLS eh nur eigene — der Filter
            waere redundant. */}
        {can("tickets:manage") && (
          <button
            type="button"
            onClick={() => setShowOnlyMine((v) => !v)}
            className={showOnlyMine ? "kasten-active" : "kasten-toggle-off"}
          >
            Nur meine
          </button>
        )}
      </div>

      {/* Liste */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map((i) => <Card key={i} className="animate-pulse bg-card"><CardContent className="p-4 h-20" /></Card>)}</div>
      ) : tickets.length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="py-16 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <TicketIcon className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-lg">Keine Tickets</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {searchNumber || searchTitle || filterType !== "alle" || filterStatus !== "offen" || showArchive
                ? "Mit den aktuellen Filtern wurde nichts gefunden."
                : "Erstelle dein erstes Ticket über den Knopf oben."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => {
            const typeMeta = TYPE_META[t.type];
            const Icon = typeMeta.icon;
            return (
              <Link key={t.id} href={`/tickets/${t.id}`} className="block">
                <Card className="card-hover bg-card">
                  <CardContent className="px-4 py-1.5 flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${typeMeta.color}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[11px] font-semibold text-muted-foreground shrink-0">T-{t.ticket_number}</span>
                        <span className="font-medium text-sm truncate">{t.title}</span>
                        <span className={`inline-flex items-center px-1.5 py-0 text-[10px] font-medium rounded-full shrink-0 ${STATUS_META[t.status].classes}`}>
                          {STATUS_META[t.status].label}
                        </span>
                        {t.priority === "dringend" && (
                          <span className="inline-flex items-center px-1.5 py-0 text-[10px] font-semibold rounded-full bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300 shrink-0">
                            Dringend
                          </span>
                        )}
                        {t.filed_at && (
                          <span
                            className="inline-flex items-center px-1.5 py-0 text-[10px] font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 shrink-0"
                            data-tooltip={t.filed_reference ?? "Abgelegt"}
                          >
                            Abgelegt
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                        <span>{typeMeta.label}</span>
                        <span>·</span>
                        <span>{t.creator?.full_name ?? "—"}</span>
                        <span>·</span>
                        <span>{formatDate(t.created_at)}</span>
                        {t.attachments.length > 0 && (
                          <>
                            <span>·</span>
                            <span>{t.attachments.length} Anhang{t.attachments.length === 1 ? "" : "e"}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
          {hasMore && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="kasten kasten-muted"
              >
                {loadingMore ? "Lade…" : "Mehr laden"}
              </button>
            </div>
          )}
        </div>
      )}

      <NewTicketModal open={showNew} onClose={() => setShowNew(false)} onCreated={load} />
    </div>
  );
}
