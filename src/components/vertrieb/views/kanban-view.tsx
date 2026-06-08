"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Flame, AlertTriangle, PartyPopper, Calendar } from "lucide-react";
import type { VertriebContact } from "@/types";
import { PRIORITY_OPTIONS, STEPS } from "@/app/(app)/vertrieb/constants";
import { detectLeadAnomaly, hasAnomaly, daysSinceLastTouch, parseEventStart } from "@/lib/vertrieb-anomaly";

/**
 * Kanban-View: 4 Stage-Spalten (Step 1-4). Pro Spalte ein vertikaler
 * Stack mit Mini-Cards. Spaltenhoehe ist gleich, intern scrollbar wenn
 * voll — damit alle Spalten gleichzeitig auf dem Screen sichtbar bleiben.
 *
 * Cards sind sehr kompakt (Firma + Owner-Bubble + Anomalie-Flags + Event-
 * Datum wenn vorhanden). Click navigiert zur Detail-Page.
 *
 * Gewonnen/Verloren tauchen NICHT in Kanban auf — die sind terminal und
 * gehoeren ins Archiv bzw. die Outcome-Stats. Kanban ist fuer das was
 * gerade im Pipeline ist.
 */

interface Props {
  contacts: VertriebContact[];
  salesPeople: { id: string; full_name: string }[];
}

export function VertriebKanbanView({ contacts, salesPeople }: Props) {
  const router = useRouter();
  const nowMs = Date.now();
  const ownerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of salesPeople) m.set(s.id, s.full_name);
    return m;
  }, [salesPeople]);

  const byStep = useMemo(() => {
    const m = new Map<number, VertriebContact[]>();
    for (const s of STEPS) m.set(s.nr, []);
    for (const c of contacts) {
      if (c.status === "gewonnen" || c.status === "abgesagt") continue;
      const step = Math.max(1, Math.min(4, c.step || 1));
      m.get(step)!.push(c);
    }
    // Innerhalb Spalte: Prio (top zuerst), dann staleste oben (= "Achtung").
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const prioOrder = { top: 0, gut: 1, mittel: 2 };
        const pc = prioOrder[a.prioritaet] - prioOrder[b.prioritaet];
        if (pc !== 0) return pc;
        const da = daysSinceLastTouch(a, nowMs) ?? 0;
        const db = daysSinceLastTouch(b, nowMs) ?? 0;
        return db - da;
      });
    }
    return m;
  }, [contacts, nowMs]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {STEPS.map((s) => {
        const list = byStep.get(s.nr) ?? [];
        return (
          <div key={s.nr} className="min-w-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {s.nr}. {s.label}
              </h3>
              <span className="text-xs font-bold tabular-nums">{list.length}</span>
            </div>
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1 -mr-1">
              {list.length === 0 ? (
                <div className="text-[11px] text-muted-foreground italic px-2 py-4 text-center border border-dashed rounded">
                  leer
                </div>
              ) : list.map((c) => (
                <KanbanCard
                  key={c.id}
                  contact={c}
                  ownerName={c.assigned_to ? ownerName.get(c.assigned_to) : null}
                  nowMs={nowMs}
                  onClick={() => router.push(`/vertrieb/${c.id}`)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  contact: c, ownerName, nowMs, onClick,
}: {
  contact: VertriebContact;
  ownerName: string | null | undefined;
  nowMs: number;
  onClick: () => void;
}) {
  const anomaly = detectLeadAnomaly(c, nowMs);
  const flagged = hasAnomaly(anomaly);
  const prioConf = PRIORITY_OPTIONS.find((p) => p.value === c.prioritaet)!;
  const eventStart = parseEventStart(c);
  const daysSince = daysSinceLastTouch(c, nowMs);
  const ownerInitial = ownerName ? ownerName.charAt(0).toUpperCase() : null;

  return (
    <Card
      onClick={onClick}
      className={`cursor-pointer hover:shadow-md transition-all p-2 bg-card ${
        flagged ? "border-amber-300 dark:border-amber-500/40" : ""
      }`}
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate">{c.firma}</p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <span className={`text-[9px] font-medium px-1 py-0 rounded border ${prioConf.color}`}>
              {prioConf.label}
            </span>
            {eventStart && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-purple-600 dark:text-purple-400">
                <PartyPopper className="h-2 w-2" />
                {eventStart.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })}
              </span>
            )}
            {daysSince !== null && daysSince > 7 && (
              <span className={`text-[9px] tabular-nums ${anomaly.stale ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground"}`}>
                {daysSince}d
              </span>
            )}
          </div>
        </div>
        {ownerInitial && (
          <span
            className="w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center shrink-0"
            title={ownerName ?? ""}
          >
            {ownerInitial}
          </span>
        )}
      </div>
      {flagged && (
        <div className="flex items-center gap-0.5 mt-1">
          {anomaly.hotIdle && <Flame className="h-2.5 w-2.5 text-orange-500" data-tooltip="Hot + offen" />}
          {anomaly.eventSoon && <PartyPopper className="h-2.5 w-2.5 text-purple-500" data-tooltip="Event <14d, noch nicht Operations" />}
          {anomaly.stale && <AlertTriangle className="h-2.5 w-2.5 text-red-500" data-tooltip="Stale >14d" />}
          {anomaly.forgotten && <Calendar className="h-2.5 w-2.5 text-gray-500" data-tooltip="Vergessen — nie kontaktiert" />}
        </div>
      )}
    </Card>
  );
}
