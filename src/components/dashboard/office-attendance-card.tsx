"use client";

/**
 * Buero-Anwesenheit 14-Tage-Grid auf dem Dashboard.
 *
 * Datenmodell:
 *   public.office_attendance (user_id, date, start_hour, end_hour) —
 *   Existence = anwesend. start_hour/end_hour sind 0..23 / 1..24 (immer
 *   auf volle Stunden gerundet).
 *   RLS: alle mit 'anwesenheit:view' sehen alle Eintraege; eigene Rows
 *        INSERT/UPDATE/DELETE.
 *
 * UI:
 *   - Header: Datums-Range + Navigation prev/next/heute (7-Tage-Schritte)
 *   - Grid: Mitarbeiter-Spalte links + 14 Tag-Spalten (heute hervorgehoben).
 *     Klick auf eine eigene Zelle oeffnet das TimeRangeModal mit Von/Bis-
 *     Dropdowns. Andere Zellen sind read-only.
 *   - Wenn ein Mitarbeiter komplett leer ist (0 Tage markiert) wird er
 *     trotzdem als Zeile angezeigt — sonst sieht man nicht wer ueberhaupt
 *     zum Buero-Team gehoert.
 *
 * Datenquelle:
 *   - profiles: alle aktiven mit anwesenheit:view (via RPC weil
 *     profiles-RLS direktes select(*) verbietet)
 *   - office_attendance: alle Rows der aktuellen Range (RLS gefiltert)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";
import { ChevronLeft, ChevronRight, Building2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TOAST } from "@/lib/messages";

interface AttendanceUser {
  id: string;
  full_name: string;
}

interface AttendanceRow {
  user_id: string;
  date: string; // YYYY-MM-DD
  start_hour: number | null;
  end_hour: number | null;
}

interface MarkValue {
  start: number | null;
  end: number | null;
}

// Wochentag-Labels, indexiert nach JS-getDay() (So=0, Mo=1, …, Sa=6).
const WEEKDAY_LABEL_BY_DOW = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

// Fixe Fenster-Groesse fuer den Grid — immer 14 Tage ab Startdatum.
const WINDOW_DAYS = 14;
// Schritt-Weite bei prev/next-Navigation. 7 Tage = eine Woche vor/zurueck.
const NAV_STEP_DAYS = 7;

// Lokales Datum als YYYY-MM-DD ohne Timezone-Drift. toISOString() konvertiert
// in UTC und rollt in CET/CEST nach Mitternacht den Tag zurueck.
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfToday(): Date {
  const out = new Date();
  out.setHours(0, 0, 0, 0);
  return out;
}

export function OfficeAttendanceCard() {
  const supabase = createClient();
  const [me, setMe] = useState<string | null>(null);
  const [users, setUsers] = useState<AttendanceUser[]>([]);
  // Map "user_id|YYYY-MM-DD" -> {start, end}. Existence = anwesend.
  // start/end koennen null sein (Legacy-Rows ohne Zeit nach Migration 125).
  const [marks, setMarks] = useState<Map<string, MarkValue>>(new Map());
  // Default: 14-Tage-Fenster ab heute. User navigiert in 7-Tage-Schritten
  // (prev/next), "Heute" springt zurueck.
  const [windowStart, setWindowStart] = useState<Date>(() => startOfToday());
  const [loading, setLoading] = useState(true);
  // Aktuell offene Zelle (eigene Zeile + Tag) fuer das Zeit-Edit-Modal.
  const [editingDate, setEditingDate] = useState<string | null>(null);

  // 14-Tage-Array ab windowStart.
  const days = useMemo(() => {
    return Array.from({ length: WINDOW_DAYS }, (_, i) => {
      const d = new Date(windowStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [windowStart]);

  const rangeStartIso = ymdLocal(windowStart);
  const rangeEndIso = ymdLocal(days[WINDOW_DAYS - 1]);
  const todayIso = ymdLocal(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setMe(user.id);

    // get_anwesenheit_users() liefert id+full_name aller User mit
    // anwesenheit:view-Permission. Eigene RPC weil profiles-RLS direkten
    // SELECT auf andere User-Rows verbietet.
    const [usersRes, marksRes] = await Promise.all([
      supabase.rpc("get_anwesenheit_users"),
      supabase
        .from("office_attendance")
        .select("user_id, date, start_hour, end_hour")
        .gte("date", rangeStartIso)
        .lte("date", rangeEndIso),
    ]);

    if (usersRes.data) {
      setUsers(usersRes.data as AttendanceUser[]);
    }
    if (marksRes.data) {
      const map = new Map<string, MarkValue>();
      for (const r of marksRes.data as AttendanceRow[]) {
        map.set(`${r.user_id}|${r.date.slice(0, 10)}`, {
          start: r.start_hour,
          end: r.end_hour,
        });
      }
      setMarks(map);
    }
    setLoading(false);
  }, [supabase, rangeStartIso, rangeEndIso]);

  useEffect(() => { load(); }, [load]);

  // Aufruf vom Modal: speichert oder loescht die Anwesenheit fuer
  // (me, dateIso). start/end als full hours (0..23 / 1..24). Optimistic
  // update mit Revert bei DB-Fehler.
  async function saveAttendance(dateIso: string, start: number, end: number) {
    if (!me) return;
    const key = `${me}|${dateIso}`;
    const prev = marks.get(key) ?? null;
    setMarks((m) => { const next = new Map(m); next.set(key, { start, end }); return next; });
    // Upsert via DELETE+INSERT um RLS-Pfade nicht zu komplizieren — der
    // composite-PK (user_id, date) garantiert dass es 1 Row gibt.
    const { error } = await supabase
      .from("office_attendance")
      .upsert({ user_id: me, date: dateIso, start_hour: start, end_hour: end },
              { onConflict: "user_id,date" });
    if (error) {
      // Revert
      setMarks((m) => {
        const next = new Map(m);
        if (prev) next.set(key, prev); else next.delete(key);
        return next;
      });
      TOAST.supabaseError(error, "Konnte nicht gespeichert werden");
    }
  }

  async function deleteAttendance(dateIso: string) {
    if (!me) return;
    const key = `${me}|${dateIso}`;
    const prev = marks.get(key);
    setMarks((m) => { const next = new Map(m); next.delete(key); return next; });
    const { error } = await supabase
      .from("office_attendance")
      .delete()
      .eq("user_id", me)
      .eq("date", dateIso);
    if (error) {
      setMarks((m) => { const next = new Map(m); if (prev) next.set(key, prev); return next; });
      TOAST.supabaseError(error, "Konnte nicht entfernt werden");
    }
  }

  function navWindow(direction: -1 | 1) {
    const next = new Date(windowStart);
    next.setDate(next.getDate() + direction * NAV_STEP_DAYS);
    setWindowStart(next);
  }
  function goToday() {
    setWindowStart(startOfToday());
  }

  const lastDay = days[WINDOW_DAYS - 1];
  const yearSuffix = lastDay.getFullYear() !== windowStart.getFullYear() ? ` ${lastDay.getFullYear()}` : "";
  const rangeLabel = `${windowStart.getDate()}.${windowStart.getMonth() + 1}. – ${lastDay.getDate()}.${lastDay.getMonth() + 1}.${yearSuffix}`;

  // Mitarbeiter sortieren: ich selber zuerst, dann alphabetisch — sodass
  // der User seine eigene Toggle-Zeile sofort findet.
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      if (a.id === me) return -1;
      if (b.id === me) return 1;
      return a.full_name.localeCompare(b.full_name, "de");
    });
  }, [users, me]);

  return (
    <Card className="bg-card">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h2 className="font-semibold text-sm">Büro-Anwesenheit</h2>
            <span className="text-[11px] text-muted-foreground">{rangeLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => navWindow(-1)} className="p-1.5 rounded-md hover:bg-foreground/5 dark:hover:bg-foreground/10 transition-colors" aria-label="7 Tage zurück">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={goToday} className="px-2 py-1 text-[11px] font-medium rounded-md hover:bg-foreground/5 dark:hover:bg-foreground/10 transition-colors">
              Heute
            </button>
            <button type="button" onClick={() => navWindow(1)} className="p-1.5 rounded-md hover:bg-foreground/5 dark:hover:bg-foreground/10 transition-colors" aria-label="7 Tage vor">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="h-32 rounded-lg bg-muted animate-pulse" />
        ) : sortedUsers.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Keine berechtigten Mitarbeiter — füge die Permission &quot;anwesenheit:view&quot; einer Rolle hinzu.
          </p>
        ) : (
          <div className="overflow-x-auto">
            {/* Min-Breite fuer 14 Tage: Mitarbeiter-Spalte (140) + 14 × 36px
                + Gaps = ~800px. Auf Desktop passt es in den Card-Body, auf
                Mobile scrollt horizontal. */}
            <div className="min-w-[820px]">
              {/* Header-Zeile: leere Mitarbeiter-Spalte + 14 Tag-Spalten.
                  Wochentag wird per Datum berechnet (Window kann mitten in
                  der Woche starten). */}
              <div className="grid gap-1" style={{ gridTemplateColumns: "minmax(110px, 140px) repeat(14, minmax(0, 1fr))" }}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold py-1.5">
                  Mitarbeiter
                </div>
                {days.map((d) => {
                  const iso = ymdLocal(d);
                  const isToday = iso === todayIso;
                  const dow = d.getDay();
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <div
                      key={iso}
                      className={`text-center py-1.5 rounded-md ${
                        isToday
                          ? "bg-red-50 dark:bg-red-500/15"
                          : ""
                      }`}
                    >
                      <div className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? "text-red-600 dark:text-red-300" : isWeekend ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                        {WEEKDAY_LABEL_BY_DOW[dow]}
                      </div>
                      <div className={`text-sm font-bold tabular-nums ${isToday ? "text-red-600 dark:text-red-300" : ""}`}>
                        {d.getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Daten-Zeilen pro User */}
              <div className="mt-1 space-y-0.5">
                {sortedUsers.map((u) => {
                  const isMe = u.id === me;
                  return (
                    <div
                      key={u.id}
                      className="grid gap-1 items-center"
                      style={{ gridTemplateColumns: "minmax(110px, 140px) repeat(14, minmax(0, 1fr))" }}
                    >
                      <div className={`text-sm truncate py-1 ${isMe ? "font-semibold" : "font-medium"}`}>
                        {u.full_name}
                        {isMe && <span className="text-[10px] text-muted-foreground font-normal ml-1">(Du)</span>}
                      </div>
                      {days.map((d) => {
                        const iso = ymdLocal(d);
                        const key = `${u.id}|${iso}`;
                        const mark = marks.get(key);
                        const marked = !!mark;
                        const isToday = iso === todayIso;
                        const hasTimes = mark && mark.start != null && mark.end != null;
                        // Display: "9-17" wenn Zeiten gesetzt, sonst ✓ (Legacy
                        // ohne Zeiten), sonst leer.
                        const display = hasTimes
                          ? `${mark!.start}-${mark!.end}`
                          : marked
                            ? "✓"
                            : "";
                        return (
                          <button
                            key={iso}
                            type="button"
                            onClick={() => { if (isMe) setEditingDate(iso); }}
                            disabled={!isMe}
                            className={`h-8 rounded-md transition-all flex items-center justify-center text-[10px] font-semibold tabular-nums ${
                              marked
                                ? "bg-blue-500 text-white"
                                : isToday
                                  ? "bg-red-50/40 dark:bg-red-500/[0.06] border border-dashed border-red-200 dark:border-red-500/30"
                                  : "bg-foreground/[0.03] dark:bg-foreground/[0.06] border border-transparent"
                            } ${isMe ? "cursor-pointer hover:scale-[0.96] active:scale-[0.92]" : "cursor-default"}`}
                            aria-label={marked ? `${u.full_name} am ${iso} bearbeiten` : `${u.full_name} am ${iso} eintragen`}
                            aria-pressed={marked}
                          >
                            {display}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/70 mt-3">
          Klick auf eine Zelle deiner eigenen Zeile = Zeit eintragen. Andere Zeilen sind read-only.
        </p>
      </CardContent>

      {editingDate && me && (
        <TimeRangeModal
          dateIso={editingDate}
          current={marks.get(`${me}|${editingDate}`) ?? null}
          onClose={() => setEditingDate(null)}
          onSave={async (start, end) => {
            await saveAttendance(editingDate, start, end);
            setEditingDate(null);
          }}
          onDelete={async () => {
            await deleteAttendance(editingDate);
            setEditingDate(null);
          }}
        />
      )}
    </Card>
  );
}

// =====================================================================
// TimeRangeModal — Von/Bis-Eingabe auf volle Stunden (0..23 / 1..24)
// =====================================================================

const HOUR_OPTIONS_START = Array.from({ length: 24 }, (_, h) => h);     // 0..23
const HOUR_OPTIONS_END = Array.from({ length: 24 }, (_, h) => h + 1);   // 1..24

interface TimeRangeModalProps {
  dateIso: string;
  current: MarkValue | null;
  onClose: () => void;
  onSave: (start: number, end: number) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

function TimeRangeModal({ dateIso, current, onClose, onSave, onDelete }: TimeRangeModalProps) {
  // Default-Werte: bestehende Werte falls vorhanden, sonst Bueroalltag 9-17.
  const [start, setStart] = useState<number>(current?.start ?? 9);
  const [end, setEnd] = useState<number>(current?.end ?? 17);
  const [saving, setSaving] = useState(false);

  const dateLabel = (() => {
    const [y, m, d] = dateIso.split("-").map(Number);
    const date = new Date(y, m - 1, d, 12);
    return date.toLocaleDateString("de-CH", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  })();

  const valid = end > start;

  async function handleSave() {
    if (!valid || saving) return;
    setSaving(true);
    try { await onSave(start, end); } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (saving) return;
    setSaving(true);
    try { await onDelete(); } finally { setSaving(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Anwesenheit"
      icon={<Building2 className="h-5 w-5 text-blue-500" />}
      size="sm"
      closable={!saving}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">{dateLabel}</p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground/70 ml-1">Von</p>
            <select
              value={start}
              onChange={(e) => setStart(parseInt(e.target.value))}
              className="w-full h-9 px-3 text-sm rounded-xl border border-border bg-card"
            >
              {HOUR_OPTIONS_START.map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground/70 ml-1">Bis</p>
            <select
              value={end}
              onChange={(e) => setEnd(parseInt(e.target.value))}
              className="w-full h-9 px-3 text-sm rounded-xl border border-border bg-card"
            >
              {HOUR_OPTIONS_END.map((h) => (
                <option key={h} value={h} disabled={h <= start}>
                  {String(h % 24).padStart(2, "0")}:00{h === 24 ? " (Mitternacht)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!valid && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Bis-Zeit muss nach Von-Zeit liegen.
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          {current && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="kasten kasten-red"
              aria-label="Anwesenheit löschen"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Entfernen
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} disabled={saving} className="kasten kasten-muted">
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!valid || saving}
            className="kasten kasten-red"
          >
            {saving ? "Speichert…" : "Speichern"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
