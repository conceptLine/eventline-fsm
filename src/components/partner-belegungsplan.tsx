"use client";

/**
 * Partner-Belegungsplan: klassischer Monats-Kalender (7×5/6) mit farbig
 * markierten Buchungs-Tagen, darunter eine Liste der naechsten Buchungen.
 *
 * Daten kommen aus /api/belegungsplan (gefiltert auf die Partner-Location).
 * Eintraege sind klickbar: eigene Anfragen → /partner/anfragen/[id],
 * fremde Vermietungen → kleines Modal mit Read-Only-Details.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Modal } from "@/components/ui/modal";

type BookingKind = "entwurf" | "partner_anfrage" | "bestaetigt" | "storniert" | "vermietung";

interface Booking {
  id: string;
  kind: BookingKind;
  title: string;
  customerName: string | null;
  isOwn: boolean;
  status: string;
  start: Date;
  end: Date;
}

interface ApiBooking {
  id: string;
  job_number: number | null;
  title: string | null;
  status: string;
  was_anfrage: boolean | null;
  start_date: string;
  end_date: string | null;
  location_id: string;
  customer_name: string | null;
  visible: boolean;
  is_own: boolean;
}

const DAY_MS = 86400000;
const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTH_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isInRange(day: Date, start: Date, end: Date): boolean {
  const d = startOfDay(day).getTime();
  return d >= startOfDay(start).getTime() && d <= startOfDay(end).getTime();
}

function kindFromBooking(b: ApiBooking): BookingKind | null {
  // Eigene Anfrage des Partners → nach Workflow-Status faerben.
  if (b.is_own) {
    if (b.status === "partner_entwurf") return "entwurf";
    if (b.status === "partner_anfrage") return "partner_anfrage";
    if (b.status === "storniert") return "storniert";
    // status in (offen, abgeschlossen) → EVENTLINE hat angenommen.
    return "bestaetigt";
  }
  // Fremd = EVENTLINE-Eintrag an der Location. Nur als Vermietung
  // anzeigen wenn EVENTLINE den Job auch als Vermietung gefuehrt hat
  // (was_anfrage=true ODER Vermietentwurf-Status). Reine Eventline-eigene
  // Aufträge (Wartung/Einrichten/Übergabe ohne Vermietungs-Tag) sind fuer
  // den Partner irrelevant und werden NICHT angezeigt — null = skip.
  if (b.was_anfrage === true || b.status === "anfrage" || b.status === "entwurf") {
    return "vermietung";
  }
  return null;
}

const KIND_STYLE: Record<BookingKind, { dot: string; bg: string; text: string; border: string; label: string }> = {
  entwurf:         { dot: "bg-gray-400 dark:bg-gray-500", bg: "bg-foreground/[0.05] dark:bg-foreground/10", text: "text-muted-foreground", border: "border-foreground/15 dark:border-foreground/20", label: "Entwurf" },
  partner_anfrage: { dot: "bg-amber-500",  bg: "bg-amber-50 dark:bg-amber-500/15",   text: "text-amber-800 dark:text-amber-300",     border: "border-amber-200 dark:border-amber-500/30",     label: "Deine offene Anfrage" },
  bestaetigt:      { dot: "bg-green-500",  bg: "bg-green-50 dark:bg-green-500/15",   text: "text-green-800 dark:text-green-300",     border: "border-green-200 dark:border-green-500/30",     label: "Bestätigt" },
  storniert:       { dot: "bg-red-500",    bg: "bg-red-50 dark:bg-red-500/15",       text: "text-red-800 dark:text-red-300",         border: "border-red-200 dark:border-red-500/30",         label: "Abgelehnt" },
  vermietung:      { dot: "bg-blue-500",   bg: "bg-blue-50 dark:bg-blue-500/15",     text: "text-blue-800 dark:text-blue-300",       border: "border-blue-200 dark:border-blue-500/30",       label: "Vermietung (EVENTLINE)" },
};

interface Props {
  locationId: string;
}

export function PartnerBelegungsplan({ locationId }: Props) {
  const supabase = createClient();
  const [anchor, setAnchor] = useState<Date>(() => {
    const d = startOfDay(new Date());
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  // job_id → Namen der zugewiesenen EVENTLINE-Techniker. Wird nach den
  // Bookings nachgeladen (eigene Anfragen + per RLS sichtbare Termine).
  const [assigneesByJobId, setAssigneesByJobId] = useState<Map<string, string[]>>(new Map());
  // Foreign-Vermietung-Detail-Modal — eigene Anfragen gehen ueber Link
  // auf die /partner/anfragen/[id]-Page, Vermietungen (kein Partner-Owner)
  // haben keine eigene Detail-Page → leichtes Modal mit Title/Datum/Kunde.
  const [vermietungDetail, setVermietungDetail] = useState<Booking | null>(null);

  // Visible Range: Start = erster Montag der Kalenderwoche des Monats-Ersten,
  // End = letzter Sonntag der Kalenderwoche des Monats-Letzten. So gibt's
  // immer ein vollstaendiges Wochen-Grid.
  const gridStart = useMemo(() => {
    const d = new Date(anchor);
    const dow = (d.getDay() + 6) % 7; // Mo=0
    d.setDate(d.getDate() - dow);
    return d;
  }, [anchor]);

  const gridEnd = useMemo(() => {
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const dow = (last.getDay() + 6) % 7;
    last.setDate(last.getDate() + (6 - dow));
    return last;
  }, [anchor]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const startIso = gridStart.toISOString();
      const endIso = new Date(gridEnd.getTime() + DAY_MS).toISOString();
      const r = await fetch(`/api/belegungsplan?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`);
      const j = r.ok ? await r.json() : { bookings: [] };
      const all: Booking[] = [];
      for (const b of (j.bookings ?? []) as ApiBooking[]) {
        if (!b.start_date || !b.location_id) continue;
        if (b.location_id !== locationId) continue;
        // Fremde stornierte Jobs raus (Location ist effektiv frei). Eigene
        // stornierte = abgelehnte Anfragen → behalten, damit der Partner
        // sieht "diesen Tag hatte ich angefragt, wurde abgelehnt".
        if (b.status === "storniert" && !b.is_own) continue;
        const kind = kindFromBooking(b);
        if (kind === null) continue; // fremde Nicht-Vermietungen ausblenden
        all.push({
          id: b.id,
          kind,
          title: b.title ?? (b.is_own ? "Anfrage" : "Vermietung"),
          customerName: b.customer_name,
          isOwn: b.is_own,
          status: b.status,
          start: startOfDay(new Date(b.start_date)),
          end: startOfDay(new Date(b.end_date ?? b.start_date)),
        });
      }
      setBookings(all);
      setLoading(false);

      // Termin-Assignees nachladen — fuer die Liste unten zeigen wir
      // pro Buchung wer von EVENTLINE zugewiesen ist. Nur eigene Anfragen
      // brauchen die Info (Vermietungen sind fremde Buchungen).
      const ownIds = all.filter((b) => b.isOwn).map((b) => b.id);
      if (ownIds.length === 0) {
        setAssigneesByJobId(new Map());
        return;
      }
      const [apptsRes, usersRes] = await Promise.all([
        supabase.from("job_appointments").select("job_id, assigned_to").in("job_id", ownIds),
        // SECURITY DEFINER: Partner darf profiles nicht direkt lesen (siehe
        // 053_profile_rls_tighten), aber get_assignable_users() bypasst RLS
        // mit den noetigen Public-Feldern (id, full_name).
        supabase.rpc("get_assignable_users"),
      ]);
      const nameById = new Map<string, string>();
      for (const u of (usersRes.data as { id: string; full_name: string }[] | null) ?? []) {
        nameById.set(u.id, u.full_name);
      }
      const m = new Map<string, string[]>();
      for (const a of (apptsRes.data as { job_id: string; assigned_to: string | null }[] | null) ?? []) {
        if (!a.assigned_to) continue;
        const name = nameById.get(a.assigned_to);
        if (!name) continue;
        const arr = m.get(a.job_id) ?? [];
        if (!arr.includes(name)) arr.push(name);
        m.set(a.job_id, arr);
      }
      setAssigneesByJobId(m);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridStart, gridEnd, locationId]);

  const days = useMemo(() => {
    const arr: Date[] = [];
    for (let t = gridStart.getTime(); t <= gridEnd.getTime(); t += DAY_MS) {
      arr.push(new Date(t));
    }
    return arr;
  }, [gridStart, gridEnd]);

  // Buchungen pro Tag — fuer den Kalender-Cell-Look.
  function bookingsOn(day: Date): Booking[] {
    return bookings.filter((b) => isInRange(day, b.start, b.end));
  }

  const today = startOfDay(new Date());
  const monthLabel = `${MONTH_LONG[anchor.getMonth()]} ${anchor.getFullYear()}`;

  // Liste-Ansicht: alle Buchungen die VOLLSTAENDIG ODER PARTIELL im
  // sichtbaren Monatsraster liegen, sortiert nach Start aufsteigend.
  const visibleBookings = useMemo(() => {
    return [...bookings].sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [bookings]);

  function prev() {
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));
  }
  function next() {
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
  }
  function jumpToToday() {
    const t = startOfDay(new Date());
    setAnchor(new Date(t.getFullYear(), t.getMonth(), 1));
  }

  return (
    <div className="space-y-4">
      {/* Header — Monat-Nav, Heute-Button, Legende */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={prev} className="kasten kasten-muted" aria-label="Vorheriger Monat">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={jumpToToday} className="kasten kasten-muted">
            Heute
          </button>
          <button type="button" onClick={next} className="kasten kasten-muted" aria-label="Nächster Monat">
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-semibold ml-3">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
          {(["entwurf", "partner_anfrage", "bestaetigt", "storniert", "vermietung"] as const).map((k) => {
            const s = KIND_STYLE[k];
            return (
              <div key={k} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
                <span>{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Kalender-Grid */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="grid grid-cols-7 border-b bg-foreground/[0.02] dark:bg-foreground/[0.04]">
          {WEEKDAY_SHORT.map((wd) => (
            <div key={wd} className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">
              {wd}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-fr">
          {days.map((day, i) => {
            const isCurrentMonth = day.getMonth() === anchor.getMonth();
            const isToday = sameDay(day, today);
            const dayBookings = bookingsOn(day);
            return (
              <div
                key={i}
                className={`min-h-[72px] p-1.5 border-b border-r border-foreground/10 dark:border-foreground/15 last:border-r-0 ${
                  isCurrentMonth ? "" : "bg-foreground/[0.02] dark:bg-foreground/[0.04]"
                }`}
              >
                <div className={`text-[11px] font-semibold mb-1 ${
                  isToday
                    ? "inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white"
                    : isCurrentMonth ? "text-foreground" : "text-muted-foreground/60"
                }`}>
                  {day.getDate()}
                </div>
                <div className="space-y-0.5">
                  {dayBookings.slice(0, 3).map((b) => {
                    const s = KIND_STYLE[b.kind];
                    // "Continuation"-Erkennung: ist der Vortag schon Teil
                    // dieser Buchung? Dann nur Block, ohne Titel wiederholen.
                    const prevDay = new Date(day.getTime() - DAY_MS);
                    const isContinuation = isInRange(prevDay, b.start, b.end);
                    const cls = `block w-full text-left text-[10px] font-medium px-1.5 py-0.5 rounded truncate ${s.bg} ${s.text} ${s.border} border hover:opacity-80 transition-opacity cursor-pointer`;
                    const label = isContinuation ? "↪" : b.title;
                    const titleAttr = `${b.title} (${b.start.toLocaleDateString("de-CH")}${b.end.getTime() !== b.start.getTime() ? ` – ${b.end.toLocaleDateString("de-CH")}` : ""})`;
                    return b.isOwn ? (
                      <Link key={b.id} href={`/partner/anfragen/${b.id}`} className={cls} title={titleAttr}>
                        {label}
                      </Link>
                    ) : (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setVermietungDetail(b)}
                        className={cls}
                        title={titleAttr}
                      >
                        {label}
                      </button>
                    );
                  })}
                  {dayBookings.length > 3 && (
                    <div className="text-[9px] text-muted-foreground">+{dayBookings.length - 3}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {loading && (
          <div className="p-3 text-center text-xs text-muted-foreground border-t">Lade…</div>
        )}
      </div>

      {/* Modal: Read-Only-Details fuer fremde Vermietungen (EVENTLINE-
          Eintraege an der Location — Partner hat keine eigene Detail-Page
          dafuer, kleines Info-Modal reicht). */}
      <Modal
        open={!!vermietungDetail}
        onClose={() => setVermietungDetail(null)}
        title="Vermietung"
        size="md"
      >
        {vermietungDetail && (() => {
          const b = vermietungDetail;
          const dateLabel = b.start.getTime() === b.end.getTime()
            ? b.start.toLocaleDateString("de-CH", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
            : `${b.start.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })} – ${b.end.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}`;
          return (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Titel</p>
                <p className="font-medium">{b.title}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Datum</p>
                <p>{dateLabel}</p>
              </div>
              {b.customerName && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Kunde</p>
                  <p>{b.customerName}</p>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground pt-1 border-t border-border">
                Diese Vermietung wurde von EVENTLINE eingetragen. Fragen oder Änderungen direkt bei EVENTLINE.
              </p>
            </div>
          );
        })()}
      </Modal>

      {/* Liste der Buchungen im sichtbaren Monat */}
      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          Buchungen im sichtbaren Zeitraum
          <span className="text-xs font-normal text-muted-foreground">({visibleBookings.length})</span>
        </h3>
        {visibleBookings.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            Keine Buchungen in diesem Monat.
          </div>
        ) : (
          <div className="space-y-1.5">
            {visibleBookings.map((b) => {
              const s = KIND_STYLE[b.kind];
              const dateLabel = b.start.getTime() === b.end.getTime()
                ? b.start.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })
                : `${b.start.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" })} – ${b.end.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}`;
              const cls = `flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border ${s.bg} ${s.text} ${s.border} hover:opacity-90 transition-opacity cursor-pointer text-left w-full`;
              const assignees = assigneesByJobId.get(b.id) ?? [];
              const inner = (
                <>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{b.title}</p>
                      <p className="text-[11px] opacity-80">
                        {dateLabel}
                        {assignees.length > 0 && (
                          <>
                            <span className="opacity-50"> · </span>
                            <span>Zugewiesen: {assignees.join(", ")}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium uppercase tracking-wider opacity-70 shrink-0">
                    {s.label}
                  </span>
                </>
              );
              return b.isOwn ? (
                <Link key={b.id} href={`/partner/anfragen/${b.id}`} className={cls}>
                  {inner}
                </Link>
              ) : (
                <button key={b.id} type="button" onClick={() => setVermietungDetail(b)} className={cls}>
                  {inner}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
