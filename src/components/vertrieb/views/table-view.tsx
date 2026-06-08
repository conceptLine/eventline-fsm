"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Calendar, PartyPopper, Flame } from "lucide-react";
import type { VertriebContact } from "@/types";
import { STATUS_OPTIONS, PRIORITY_OPTIONS } from "@/app/(app)/vertrieb/constants";
import { detectLeadAnomaly, hasAnomaly, daysSinceLastTouch, parseEventStart, type LeadAnomaly } from "@/lib/vertrieb-anomaly";

/**
 * Dichte Tabellen-View fuer Vertrieb — fuer hohe Lead-Volumen optimiert.
 *
 * - Sticky-Header bleibt beim Scrollen sichtbar.
 * - Sort by header click (cycle: asc -> desc -> none).
 * - Inline-Anomalien-Spalte zeigt Flags (Stale / Hot-Idle / Event-Soon / Forgotten).
 * - Row-Click navigiert zur Detail-Page.
 * - Row-Hintergrund tinted rot wenn Anomalie aktiv (visueller Anker beim Scrollen).
 */

type SortKey = "nr" | "firma" | "step" | "status" | "prio" | "owner" | "touched" | "event";
type SortDir = "asc" | "desc";

interface Props {
  contacts: VertriebContact[];
  salesPeople: { id: string; full_name: string }[];
}

export function VertriebTableView({ contacts, salesPeople }: Props) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "nr", dir: "asc" });
  const nowMs = Date.now();
  const ownerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of salesPeople) m.set(s.id, s.full_name);
    return m;
  }, [salesPeople]);

  const sorted = useMemo(() => {
    const arr = [...contacts];
    const sign = sort.dir === "asc" ? 1 : -1;
    const prioOrder = { top: 0, gut: 1, mittel: 2 };
    const statusOrder = { offen: 0, kontaktiert: 1, gespraech: 2, gewonnen: 3, abgesagt: 4 };
    arr.sort((a, b) => {
      switch (sort.key) {
        case "nr": return sign * (a.nr - b.nr);
        case "firma": return sign * a.firma.localeCompare(b.firma);
        case "step": return sign * ((a.step || 1) - (b.step || 1));
        case "status": return sign * (statusOrder[a.status] - statusOrder[b.status]);
        case "prio": return sign * (prioOrder[a.prioritaet] - prioOrder[b.prioritaet]);
        case "owner": {
          const an = a.assigned_to ? ownerName.get(a.assigned_to) ?? "zzz" : "zzz";
          const bn = b.assigned_to ? ownerName.get(b.assigned_to) ?? "zzz" : "zzz";
          return sign * an.localeCompare(bn);
        }
        case "touched": {
          const ad = daysSinceLastTouch(a, nowMs);
          const bd = daysSinceLastTouch(b, nowMs);
          if (ad === null && bd === null) return 0;
          if (ad === null) return 1;
          if (bd === null) return -1;
          return sign * (ad - bd);
        }
        case "event": {
          const ae = parseEventStart(a);
          const be = parseEventStart(b);
          if (!ae && !be) return 0;
          if (!ae) return 1;
          if (!be) return -1;
          return sign * (ae.getTime() - be.getTime());
        }
        default: return 0;
      }
    });
    return arr;
  }, [contacts, sort, ownerName, nowMs]);

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  return (
    <Card className="bg-card">
      <CardContent className="p-0 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b z-10">
            <tr>
              <Th label="Nr" sortKey="nr" sort={sort} onSort={toggleSort} className="w-20 text-left" />
              <Th label="Firma" sortKey="firma" sort={sort} onSort={toggleSort} className="text-left" />
              <Th label="Step" sortKey="step" sort={sort} onSort={toggleSort} className="w-24 text-left" />
              <Th label="Status" sortKey="status" sort={sort} onSort={toggleSort} className="w-32 text-left" />
              <Th label="Prio" sortKey="prio" sort={sort} onSort={toggleSort} className="w-24 text-left" />
              <Th label="Owner" sortKey="owner" sort={sort} onSort={toggleSort} className="w-24 text-left" />
              <Th label="Last Touch" sortKey="touched" sort={sort} onSort={toggleSort} className="w-28 text-right" />
              <Th label="Event" sortKey="event" sort={sort} onSort={toggleSort} className="w-28 text-right" />
              <th className="w-20 text-right px-2 py-2 font-semibold">Flags</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const anomaly = detectLeadAnomaly(c, nowMs);
              const flagged = hasAnomaly(anomaly);
              const daysSince = daysSinceLastTouch(c, nowMs);
              const eventStart = parseEventStart(c);
              const stepNr = c.step || 1;
              const statusConf = STATUS_OPTIONS.find((s) => s.value === c.status)!;
              const prioConf = PRIORITY_OPTIONS.find((p) => p.value === c.prioritaet)!;
              const owner = c.assigned_to ? ownerName.get(c.assigned_to) : null;

              return (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/vertrieb/${c.id}`)}
                  className={`border-b last:border-b-0 hover:bg-muted/50 cursor-pointer ${
                    flagged ? "bg-amber-50/40 dark:bg-amber-500/5" : ""
                  }`}
                >
                  <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                    LEAD-{String(c.nr).padStart(4, "0")}
                  </td>
                  <td className="px-2 py-1.5 font-medium truncate max-w-[260px]" title={c.firma}>{c.firma}</td>
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0 text-[10px] font-semibold rounded bg-blue-500/15 text-blue-700 dark:text-blue-300">
                      {stepNr}/4
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[10px] font-medium px-1.5 py-0 rounded border ${statusConf.color}`}>
                      {statusConf.label}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[10px] font-medium px-1.5 py-0 rounded border ${prioConf.color}`}>
                      {prioConf.label}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[120px]" title={owner ?? ""}>
                    {owner ? owner.split(" ")[0] : <span className="opacity-40">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {daysSince === null ? <span className="opacity-40">—</span>
                      : daysSince === 0 ? "heute"
                      : daysSince === 1 ? "1d"
                      : `${daysSince}d`}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {eventStart ? eventStart.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" })
                      : <span className="opacity-40">—</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <FlagBadges anomaly={anomaly} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <p className="text-center py-8 text-sm text-muted-foreground">Keine Leads im aktuellen Filter.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Th({
  label, sortKey, sort, onSort, className,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`px-2 py-2 font-semibold ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
        <Icon className="h-3 w-3 opacity-60" />
      </button>
    </th>
  );
}

function FlagBadges({ anomaly }: { anomaly: LeadAnomaly }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      {anomaly.stale && (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400" data-tooltip="Stale: >14d kein Kontakt">
          <AlertTriangle className="h-2.5 w-2.5" />
        </span>
      )}
      {anomaly.hotIdle && (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400" data-tooltip="Hot + offen: Top-Prio + Step 1">
          <Flame className="h-2.5 w-2.5" />
        </span>
      )}
      {anomaly.eventSoon && (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400" data-tooltip="Event <14d aber noch nicht in Operations">
          <PartyPopper className="h-2.5 w-2.5" />
        </span>
      )}
      {anomaly.forgotten && (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-gray-200 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400" data-tooltip="Vergessen: angelegt >7d, nie kontaktiert">
          <Calendar className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
  );
}
