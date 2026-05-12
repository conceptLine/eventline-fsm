"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Trash2, Calendar, PartyPopper, Check, AlertTriangle } from "lucide-react";
import type { VertriebContact } from "@/types";
import { STATUS_OPTIONS, PRIORITY_OPTIONS, KATEGORIE_OPTIONS, STEPS } from "@/app/(app)/vertrieb/constants";

interface Props {
  contact: VertriebContact;
  onClick: (contact: VertriebContact) => void;
  onDelete: (id: string) => void;
  /** Wenn false: Delete-Button im Hover wird nicht gerendert. */
  canDelete?: boolean;
  /** Sales-Mitarbeiter fuer den Assignee-Toggle (Leo, Mischa). */
  salesPeople?: { id: string; full_name: string }[];
  onAssign?: (leadId: string, userId: string | null) => void;
}

// Kompakte 2-Zeilen-Card. Kontakt-Block (Email/Tel) raus — der ist auf
// der Detail-Page sowieso da, auf der Liste hat sie kaum jemand direkt
// angeklickt. Step+Status+Prio+Event-Datum+Assignees alle in einer
// zweiten dichten Zeile. Card schrumpft damit von ~200px auf ~70px,
// 2-3x mehr Leads gleichzeitig sichtbar.
export function LeadCard({ contact: c, onClick, onDelete, canDelete = true, salesPeople = [], onAssign }: Props) {
  const statusConf = STATUS_OPTIONS.find((s) => s.value === c.status)!;
  const prioConf = PRIORITY_OPTIONS.find((p) => p.value === c.prioritaet)!;
  const katConf = KATEGORIE_OPTIONS.find((o) => o.value === c.kategorie);
  const KatIcon = katConf?.icon;
  const currentStepNr = c.step || 1;
  const isGewonnen = c.status === "gewonnen";
  const isVerloren = c.status === "abgesagt";

  const daysSinceStep: number | null = (() => {
    if (isGewonnen || isVerloren) return null;
    let then: number;
    if (c.datum_kontakt) {
      const [y, m, d] = c.datum_kontakt.split("-").map(Number);
      then = new Date(y, m - 1, d, 12).getTime();
    } else if (c.created_at) {
      then = new Date(c.created_at).getTime();
    } else {
      return null;
    }
    return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
  })();
  const isStale = daysSinceStep !== null && daysSinceStep > 7;

  let jobNumber: number | null = null;
  let eventStart: string | null = null;
  let eventEnd: string | null = null;
  try {
    const parsed = JSON.parse(c.notizen || "{}");
    jobNumber = parsed._details?.job_number || null;
    eventStart = parsed._details?.event_start || null;
    eventEnd = parsed._details?.event_end || null;
  } catch {}

  const eventDateText = eventStart
    ? (() => {
        const fmt = (s: string) => new Date(s).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" });
        return eventEnd && eventEnd !== eventStart ? `${fmt(eventStart)} – ${fmt(eventEnd)}` : fmt(eventStart);
      })()
    : null;

  return (
    <Card
      onClick={() => onClick(c)}
      className={`cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5 group relative ${
        isGewonnen ? "bg-green-50 border-green-200 dark:bg-green-500/10 dark:border-green-500/30" :
        isVerloren ? "bg-red-50/60 border-red-200 opacity-70 dark:bg-red-500/10 dark:border-red-500/30" :
        isStale ? "bg-card border-[var(--status-red)]" :
        "bg-card"
      }`}
    >
      <CardContent className="p-2.5">
        {/* Zeile 1: Identitaet — Nr, Kategorie, Firma+Branche, Tage, Delete */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono text-muted-foreground bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
            LEAD-{String(c.nr).padStart(4, "0")}
          </span>
          {katConf && KatIcon && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md border shrink-0 ${katConf.color}`}>
              <KatIcon className="h-2.5 w-2.5" />
              {c.kategorie === "verwaltung" ? "Verwaltung" : "Event"}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm truncate">{c.firma}</h3>
          </div>
          {daysSinceStep !== null && (
            <span
              className={`text-[10px] flex items-center gap-1 shrink-0 ${
                isStale
                  ? "font-bold text-red-600 dark:text-red-400"
                  : "font-medium text-muted-foreground"
              }`}
              title={c.datum_kontakt
                ? `Letzter Schritt am ${(() => { const [y,m,d] = c.datum_kontakt!.split("-").map(Number); return new Date(y, m-1, d, 12).toLocaleDateString("de-CH"); })()}`
                : `Lead angelegt am ${new Date(c.created_at).toLocaleDateString("de-CH")}`}
            >
              <Calendar className="h-2.5 w-2.5" />
              {daysSinceStep === 0 ? "heute"
                : daysSinceStep === 1 ? "vor 1 Tag"
                : `vor ${daysSinceStep} Tagen`}
            </span>
          )}
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
              className="icon-btn icon-btn-red opacity-0 group-hover:opacity-100 shrink-0"
              data-tooltip="Löschen"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Zeile 2: Status-Information — Step-Bar, Status, Prio, Event-Datum, Assignees */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {/* Step-Bar (nur aktive Leads) */}
          {!isGewonnen && !isVerloren && (
            <div className="flex gap-0.5 shrink-0" data-tooltip={`Schritt ${currentStepNr}/4`}>
              {STEPS.map((s) => (
                <div
                  key={s.nr}
                  className={`w-4 h-1.5 rounded-full ${s.nr <= currentStepNr ? "bg-blue-500" : "bg-foreground/10 dark:bg-foreground/20"}`}
                />
              ))}
            </div>
          )}

          {/* Won/Lost-Badge inline statt eigene Banner-Zeile */}
          {isGewonnen && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-green-100 text-green-800 border border-green-200 dark:bg-green-500/20 dark:text-green-300 dark:border-green-500/30">
              <Check className="h-3 w-3" />
              Gewonnen{jobNumber ? ` · INT-${jobNumber}` : ""}
            </span>
          )}
          {isVerloren && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-red-100 text-red-800 border border-red-200 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/30 truncate max-w-[260px]">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">Verloren{c.verloren_grund ? `: ${c.verloren_grund}` : ""}</span>
            </span>
          )}

          {/* Status + Prio nur fuer aktive Leads — won/lost sagt's bereits */}
          {!isGewonnen && !isVerloren && (
            <>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${statusConf.color}`}>
                {statusConf.label}
              </span>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${prioConf.color}`}>
                {prioConf.label}
              </span>
            </>
          )}

          {/* Event-Datum als kompakter inline-Chip */}
          {eventDateText && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-md bg-purple-50 dark:bg-purple-500/10 border border-purple-100 dark:border-purple-500/20">
              <PartyPopper className="h-3 w-3 shrink-0" />
              {eventDateText}
            </span>
          )}

          {/* Assignee-Toggles rechtsbuendig */}
          {salesPeople.length > 0 && onAssign && (
            <div className="ml-auto flex items-center gap-1 shrink-0">
              {salesPeople.map((sp) => {
                const isAssigned = c.assigned_to === sp.id;
                const initial = sp.full_name.charAt(0).toUpperCase();
                return (
                  <button
                    key={sp.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssign(c.id, isAssigned ? null : sp.id);
                    }}
                    className={`w-5 h-5 rounded-full text-[9px] font-bold transition-colors flex items-center justify-center shrink-0 ${
                      isAssigned
                        ? "bg-red-500 text-white"
                        : "bg-foreground/10 dark:bg-foreground/15 text-foreground/60 dark:text-foreground/70"
                    }`}
                    title={isAssigned
                      ? `${sp.full_name} ist zugewiesen — klick zum Entfernen`
                      : `${sp.full_name} zuweisen`}
                    aria-label={isAssigned ? `${sp.full_name} entfernen` : `${sp.full_name} zuweisen`}
                    aria-pressed={isAssigned}
                  >
                    {initial}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
