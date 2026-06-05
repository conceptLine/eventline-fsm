"use client";

/**
 * Buero-Anwesenheit Wochen-Grid (Mo-So) auf dem Dashboard.
 *
 * Datenmodell:
 *   public.office_attendance (user_id, date) — Existence = anwesend.
 *   RLS: alle mit 'anwesenheit:view' sehen alle Eintraege; eigene Row
 *        toggeln via INSERT/DELETE.
 *
 * UI:
 *   - Header: Wochen-Label (Mo X. — So Y.) + Navigation prev/next/heute
 *   - Grid: Mitarbeiter-Spalte links + 7 Tag-Spalten (heute hervorgehoben).
 *     Zellen sind klickbare Toggles fuer die eigene Zeile, read-only fuer
 *     andere Zeilen.
 *   - Wenn ein Mitarbeiter komplett leer ist (0 Tage markiert) wird er
 *     trotzdem als Zeile angezeigt — sonst sieht man nicht wer ueberhaupt
 *     zum Buero-Team gehoert.
 *
 * Datenquelle:
 *   - profiles: alle aktiven mit anwesenheit:view (via RPC weil
 *     profiles-RLS direktes select(*) verbietet)
 *   - office_attendance: alle Rows der aktuellen Woche (RLS gefiltert)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { ChevronLeft, ChevronRight, Building2 } from "lucide-react";
import { toast } from "sonner";
import { TOAST } from "@/lib/messages";

interface AttendanceUser {
  id: string;
  full_name: string;
}

interface AttendanceRow {
  user_id: string;
  date: string; // YYYY-MM-DD
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
  const [marks, setMarks] = useState<Set<string>>(new Set()); // "user_id|YYYY-MM-DD"
  // Default: 14-Tage-Fenster ab heute. User navigiert in 7-Tage-Schritten
  // (prev/next), "Heute" springt zurueck.
  const [windowStart, setWindowStart] = useState<Date>(() => startOfToday());
  const [loading, setLoading] = useState(true);

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
        .select("user_id, date")
        .gte("date", rangeStartIso)
        .lte("date", rangeEndIso),
    ]);

    if (usersRes.data) {
      setUsers(usersRes.data as AttendanceUser[]);
    }
    if (marksRes.data) {
      const set = new Set<string>();
      for (const r of marksRes.data as AttendanceRow[]) {
        set.add(`${r.user_id}|${r.date.slice(0, 10)}`);
      }
      setMarks(set);
    }
    setLoading(false);
  }, [supabase, rangeStartIso, rangeEndIso]);

  useEffect(() => { load(); }, [load]);

  async function toggleMark(userId: string, dateIso: string) {
    if (userId !== me) return; // nur eigene Zeile toggelbar
    const key = `${userId}|${dateIso}`;
    const isMarked = marks.has(key);
    // Optimistic update
    setMarks((prev) => {
      const next = new Set(prev);
      if (isMarked) next.delete(key); else next.add(key);
      return next;
    });
    if (isMarked) {
      const { error } = await supabase
        .from("office_attendance")
        .delete()
        .eq("user_id", userId)
        .eq("date", dateIso);
      if (error) {
        // Revert
        setMarks((prev) => { const n = new Set(prev); n.add(key); return n; });
        TOAST.supabaseError(error, "Konnte nicht abgewählt werden");
      }
    } else {
      const { error } = await supabase
        .from("office_attendance")
        .insert({ user_id: userId, date: dateIso });
      if (error) {
        setMarks((prev) => { const n = new Set(prev); n.delete(key); return n; });
        TOAST.supabaseError(error, "Konnte nicht gespeichert werden");
      }
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
                        const marked = marks.has(key);
                        const isToday = iso === todayIso;
                        return (
                          <button
                            key={iso}
                            type="button"
                            onClick={() => toggleMark(u.id, iso)}
                            disabled={!isMe}
                            className={`h-8 rounded-md transition-all flex items-center justify-center text-xs font-semibold ${
                              marked
                                ? "bg-blue-500 text-white"
                                : isToday
                                  ? "bg-red-50/40 dark:bg-red-500/[0.06] border border-dashed border-red-200 dark:border-red-500/30"
                                  : "bg-foreground/[0.03] dark:bg-foreground/[0.06] border border-transparent"
                            } ${isMe ? "cursor-pointer hover:scale-[0.96] active:scale-[0.92]" : "cursor-default"}`}
                            aria-label={marked ? `${u.full_name} am ${iso} austragen` : `${u.full_name} am ${iso} eintragen`}
                            aria-pressed={marked}
                          >
                            {marked ? "✓" : ""}
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
          Klick auf eine Zelle deiner eigenen Zeile = ein/austragen. Andere Zeilen sind read-only.
        </p>
      </CardContent>
    </Card>
  );
}
