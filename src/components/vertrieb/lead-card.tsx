"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Trash2, Mail, Phone, Calendar, PartyPopper, Check, AlertTriangle } from "lucide-react";
import type { VertriebContact } from "@/types";
import { STATUS_OPTIONS, PRIORITY_OPTIONS, KATEGORIE_OPTIONS, STEPS } from "@/app/(app)/vertrieb/constants";

interface Props {
  contact: VertriebContact;
  onClick: (contact: VertriebContact) => void;
  onDelete: (id: string) => void;
  /** Wenn false: Delete-Button im Hover wird nicht gerendert. */
  canDelete?: boolean;
  /** Sales-Mitarbeiter fuer den Assignee-Toggle (Leo, Mischa).
   *  Toggle wird nur gerendert wenn die Liste nicht leer ist. */
  salesPeople?: { id: string; full_name: string }[];
  /** Click-Handler fuer den Assignee-Toggle. userId=null = Zuweisung
   *  zuruecknehmen (aktuell zugewiesener Avatar wird erneut geklickt). */
  onAssign?: (leadId: string, userId: string | null) => void;
}

export function LeadCard({ contact: c, onClick, onDelete, canDelete = true, salesPeople = [], onAssign }: Props) {
  const statusConf = STATUS_OPTIONS.find((s) => s.value === c.status)!;
  const prioConf = PRIORITY_OPTIONS.find((p) => p.value === c.prioritaet)!;
  const katConf = KATEGORIE_OPTIONS.find((o) => o.value === c.kategorie);
  const KatIcon = katConf?.icon;
  const currentStepNr = c.step || 1;
  const stepLabel = STEPS.find((s) => s.nr === currentStepNr)?.label || "";
  const isGewonnen = c.status === "gewonnen";
  const isVerloren = c.status === "abgesagt";

  // Tage seit letztem Schritt — advanceStep() setzt datum_kontakt jeweils
  // auf today, also ist das der "letzter Schritt"-Timestamp. Fuer ganz
  // frische Leads (noch nie Schritt gemacht) faellt's auf created_at zurueck,
  // damit auch lange-liegen-gelassene Neueingaenge stale werden.
  // Bei gewonnen/abgesagt ist der Prozess fertig — kein Staleness-Indikator.
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
  // Job-Nummer + Event-Datum ermitteln
  let jobNumber: number | null = null;
  let eventStart: string | null = null;
  let eventEnd: string | null = null;
  try {
    const parsed = JSON.parse(c.notizen || "{}");
    jobNumber = parsed._details?.job_number || null;
    eventStart = parsed._details?.event_start || null;
    eventEnd = parsed._details?.event_end || null;
  } catch {}

  return (
    <Card
      onClick={() => onClick(c)}
      className={`cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5 group relative ${
        isGewonnen ? "bg-green-50 border-green-200" :
        isVerloren ? "bg-red-50/60 border-red-200 opacity-70" :
        // Stale: nur Rand rot (status-red, gleicher Ton wie kasten-red-
        // Buttons), keine rote Fuellung — sonst sieht's aus wie ein
        // verlorener Lead.
        isStale ? "bg-card border-[var(--status-red)]" :
        "bg-card"
      }`}
    >
      <CardContent className="p-4">
        {/* Top row: Number, Firma, Category */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] font-mono text-muted-foreground bg-gray-100 px-1.5 py-0.5 rounded">LEAD-{String(c.nr).padStart(4, "0")}</span>
              {katConf && KatIcon && (
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md border ${katConf.color}`}>
                  <KatIcon className="h-2.5 w-2.5" />
                  {c.kategorie === "verwaltung" ? "Verwaltung" : "Event"}
                </span>
              )}
            </div>
            <h3 className="font-semibold text-[15px] leading-tight truncate">{c.firma}</h3>
            {c.branche && <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.branche}</p>}
          </div>
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
              className="icon-btn icon-btn-red opacity-0 group-hover:opacity-100"
              data-tooltip="Löschen"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Contact info */}
        {(c.ansprechperson || c.email || c.telefon) && (
          <div className="space-y-0.5 mb-3 pb-3 border-b border-gray-100">
            {c.ansprechperson && (
              <p className="text-xs text-gray-700 truncate">{c.ansprechperson}{c.position ? ` · ${c.position}` : ""}</p>
            )}
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
              {c.email && <a onClick={(e) => e.stopPropagation()} href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-blue-600 truncate max-w-[180px]"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{c.email}</span></a>}
              {c.telefon && <a onClick={(e) => e.stopPropagation()} href={`tel:${c.telefon}`} className="flex items-center gap-1 hover:text-blue-600"><Phone className="h-3 w-3" />{c.telefon}</a>}
            </div>
          </div>
        )}

        {/* Event-Datum */}
        {eventStart && (
          <div className="mb-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-xs font-medium border border-purple-100">
            <PartyPopper className="h-3.5 w-3.5 shrink-0" />
            {new Date(eventStart).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })}
            {eventEnd && eventEnd !== eventStart && ` – ${new Date(eventEnd).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })}`}
          </div>
        )}

        {/* Step progress bar */}
        {!isGewonnen && !isVerloren && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Schritt {currentStepNr}/4</span>
              <span className="text-[10px] text-gray-500">{stepLabel}</span>
            </div>
            <div className="flex gap-1">
              {STEPS.map((s) => (
                <div key={s.nr} className={`flex-1 h-1.5 rounded-full ${s.nr <= currentStepNr ? "bg-blue-500" : "bg-gray-200"}`} />
              ))}
            </div>
          </div>
        )}

        {/* Won/Lost Banner */}
        {isGewonnen && (
          <div className="mb-3 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-green-100 text-green-800 text-xs font-medium">
            <Check className="h-3.5 w-3.5" />
            Gewonnen{jobNumber ? ` · INT-${jobNumber}` : ""}
          </div>
        )}
        {isVerloren && (
          <div className="mb-3 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-red-100 text-red-800 text-xs font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            Verloren{c.verloren_grund ? `: ${c.verloren_grund}` : ""}
          </div>
        )}

        {/* Status + Priority + Assignee-Toggle. Assignee zuerst weil
            "wem gehoert der Lead" der primaere Identifier ist. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {salesPeople.length > 0 && onAssign && (
            <div className="flex items-center gap-1 mr-0.5">
              {salesPeople.map((sp) => {
                const isAssigned = c.assigned_to === sp.id;
                const initial = sp.full_name.charAt(0).toUpperCase();
                return (
                  <button
                    key={sp.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Klick auf bereits-zugewiesen = unassign (Toggle-Geste).
                      // Klick auf andere Person = wechseln. Null = unzugewiesen.
                      onAssign(c.id, isAssigned ? null : sp.id);
                    }}
                    className={`w-6 h-6 rounded-full text-[10px] font-bold transition-colors flex items-center justify-center shrink-0 ${
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
          <span className={`text-[11px] font-medium px-2 py-1 rounded-md border ${statusConf.color}`}>{statusConf.label}</span>
          <span className={`text-[11px] font-medium px-2 py-1 rounded-md border ${prioConf.color}`}>{prioConf.label}</span>
          {daysSinceStep !== null && (
            <span
              className={`ml-auto text-[10px] flex items-center gap-1 ${
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
        </div>
      </CardContent>
    </Card>
  );
}
