// GET /api/hr/employee-detail?profile_id=...&year=YYYY
//
// Liefert alle Lohn-relevanten Infos zu einem Mitarbeiter fuer ein Jahr:
//   - Stammdaten (Brutto/Netto/Vollkosten + Abzuege)
//   - YTD-Stunden (Stempel/Geplant/Rapport)
//   - Nachtarbeit-Counter (Einsaetze mit Stunden 23:00-06:00) + Liste
//   - Sonntag/Feiertag-Counter (combined per ArGV 1 Art. 28) + Liste
//
// Schweizer Arbeitsgesetz Schwellen:
//   - 24 Nachteinsaetze/Jahr → 25% Lohnzuschlag (vorueb.). Danach: 10% Zeitkomp.
//   - 6 Sonntags+Feiertags-Einsaetze/Jahr → 50% Lohnzuschlag (vorueb.).
//     Danach: regelmaessig → Ersatzruhetage.
//
// Strikt admin-only (UI + RPC haben jeweils zusaetzliche Guards).

import { NextResponse } from "next/server";
import { requireTrustedDevice } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { swissHolidaysForYear } from "@/lib/swiss-holidays";

// Schweiz TZ-Offset im Sommer/Winter — für korrekte Local-Date/Hour
// Berechnung ohne Library. Date.toLocaleString mit timeZone funktioniert
// auch auf dem Server (Node hat ICU).
const ZRH_TZ = "Europe/Zurich";

function localDateIso(d: Date): string {
  // YYYY-MM-DD in Europe/Zurich
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: ZRH_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d); // en-CA → YYYY-MM-DD
}

function localHour(d: Date): number {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: ZRH_TZ, hour: "2-digit", hour12: false });
  return Number(f.format(d).split(":")[0]);
}

function localWeekday(d: Date): number {
  // 0 = Sunday … 6 = Saturday in en-US Intl
  const f = new Intl.DateTimeFormat("en-US", { timeZone: ZRH_TZ, weekday: "short" });
  const w = f.format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[w] ?? 0;
}

export async function GET(req: Request) {
  const auth = await requireTrustedDevice("lohn:manage");
  if (auth.error) return auth.error;
  const admin = createAdminClient();
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  if (callerProfile?.role !== "admin") {
    return NextResponse.json({ success: false, error: "Nur für Administratoren" }, { status: 403 });
  }

  const url = new URL(req.url);
  const profileId = url.searchParams.get("profile_id");
  const yearParam = url.searchParams.get("year");
  if (!profileId) {
    return NextResponse.json({ success: false, error: "profile_id fehlt" }, { status: 400 });
  }
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : new Date().getFullYear();

  // Stammdaten — Profile + aktuelle Compensation
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, role, email")
    .eq("id", profileId)
    .single();
  if (!profile) {
    return NextResponse.json({ success: false, error: "Mitarbeiter nicht gefunden" }, { status: 404 });
  }
  const { data: comp } = await admin
    .from("employee_compensation")
    .select("hourly_wage_chf, employer_costs_chf_per_hour, effective_from, notes, ahv_iv_eo_pct, alv_pct, nbu_pct, bvg_pct, ktg_pct, quellensteuer_pct")
    .eq("profile_id", profileId)
    .is("effective_to", null)
    .maybeSingle();

  // Time-Entries des Jahres laden
  const yearStart = `${year}-01-01T00:00:00+01:00`;
  const yearEnd = `${year + 1}-01-01T00:00:00+01:00`;
  const { data: entries } = await admin
    .from("time_entries")
    .select("entry_number, clock_in, clock_out")
    .eq("user_id", profileId)
    .gte("clock_in", yearStart)
    .lt("clock_in", yearEnd)
    .order("clock_in");

  const localTimeHM = (d: Date) => {
    const f = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hour12: false });
    return f.format(d);
  };

  // Aggregate: per-Minute-Date-Attribution (Schichten ueber Mitternacht
  // verteilen ihre Minuten korrekt auf 2 Tage). Pro Date sammeln wir auch
  // die einzelnen Time-Entries die diesen Tag beruehrt haben, mit
  // Stempelnummer + lokalen Zeiten — fuer die UI-Aufschluesselung.
  interface EntryTouch { entry_number: number; start_local: string; end_local: string; }
  const perDate = new Map<string, { night: boolean; worked: boolean; entries: EntryTouch[] }>();
  const holidays = swissHolidaysForYear(year);
  const holidayMap = new Map(holidays.map((h) => [h.date, h.name]));

  let stempel_minutes = 0;
  type EntryRowWithNum = { entry_number: number; clock_in: string; clock_out: string | null };
  for (const e of (entries as EntryRowWithNum[] | null) ?? []) {
    if (!e.clock_out) continue;
    const start = new Date(e.clock_in).getTime();
    const end = new Date(e.clock_out).getTime();
    if (end <= start) continue;
    stempel_minutes += Math.floor((end - start) / 60000);
    // Datums die der Entry beruehrt
    const touched = new Set<string>();
    for (let t = start; t < end; t += 60_000) {
      const d = new Date(t);
      const date = localDateIso(d);
      const h = localHour(d);
      let bucket = perDate.get(date);
      if (!bucket) { bucket = { night: false, worked: true, entries: [] }; perDate.set(date, bucket); }
      bucket.worked = true;
      if (h >= 23 || h < 6) bucket.night = true;
      touched.add(date);
    }
    // Entry-Stempel zu jeder beruehrten Datums-Bucket hinzufuegen
    const startLocal = localTimeHM(new Date(start));
    const endLocal = localTimeHM(new Date(end));
    for (const date of touched) {
      perDate.get(date)!.entries.push({
        entry_number: e.entry_number,
        start_local: startLocal,
        end_local: endLocal,
      });
    }
  }

  interface DayWithEntries { date: string; label?: string; entries: EntryTouch[]; }
  const nightDates = new Map<string, DayWithEntries>();
  const sundayHolidayDates = new Map<string, DayWithEntries>();
  for (const [date, b] of perDate.entries()) {
    if (b.night) nightDates.set(date, { date, entries: b.entries });
    const [y, m, d] = date.split("-").map(Number);
    const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const wd = localWeekday(noon);
    const isSunday = wd === 0;
    const isHoliday = holidayMap.has(date);
    if (b.worked && (isSunday || isHoliday)) {
      const label = isHoliday ? (holidayMap.get(date) ?? "") : "Sonntag";
      sundayHolidayDates.set(date, { date, label, entries: b.entries });
    }
  }

  // Geplant + Rapport-Stunden YTD via separater Lookup
  const { data: appts } = await admin
    .from("job_appointments")
    .select("start_time, end_time")
    .eq("assigned_to", profileId)
    .gte("start_time", yearStart)
    .lt("start_time", yearEnd);
  let geplant_minutes = 0;
  for (const a of (appts as { start_time: string; end_time: string }[] | null) ?? []) {
    const ms = new Date(a.end_time).getTime() - new Date(a.start_time).getTime();
    if (ms > 0) geplant_minutes += Math.floor(ms / 60000);
  }

  const { data: reports } = await admin
    .from("service_reports")
    .select("time_ranges, report_date")
    .gte("report_date", `${year}-01-01`)
    .lt("report_date", `${year + 1}-01-01`)
    .eq("status", "abgeschlossen");
  let rapport_minutes = 0;
  for (const r of (reports as { time_ranges: unknown; report_date: string }[] | null) ?? []) {
    if (!Array.isArray(r.time_ranges)) continue;
    for (const range of r.time_ranges as Array<Record<string, unknown>>) {
      if (range["technician_id"] !== profileId) continue;
      const s = String(range["start"] ?? "");
      const en = String(range["end"] ?? "");
      const pause = Number(range["pause"] ?? 0) || 0;
      if (!/^\d{2}:\d{2}$/.test(s) || !/^\d{2}:\d{2}$/.test(en)) continue;
      const [sh, sm] = s.split(":").map(Number);
      const [eh, em] = en.split(":").map(Number);
      let diff = eh * 60 + em - sh * 60 - sm;
      // Mitternacht-Fix: end < start → Schicht ueber Mitternacht, +24h.
      if (diff < 0) diff += 1440;
      rapport_minutes += Math.max(0, diff - pause);
    }
  }

  const nightArr = Array.from(nightDates.values()).sort((a, b) => a.date.localeCompare(b.date));
  const sunHolArr = Array.from(sundayHolidayDates.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Zuschlags-Berechnung (informativ — Lohnkosten in der Tabelle bleibt
  // basis-Lohn, Zuschlaege rechnet der Admin manuell beim Abrechnen rein
  // oder wir bauen das in einer naechsten Iteration als opt-in).
  const wage = comp?.hourly_wage_chf ? Number(comp.hourly_wage_chf) : 0;
  // Average Nachteinsatz-Dauer (= total Stunden im Nachtfenster) — vereinfacht:
  // wir nehmen alle Stempel-Stunden des Einsatz-Tags als Approximation.
  // Genaue Stunden-Im-Fenster waere genauer; v1 als Hinweis.

  return NextResponse.json({
    success: true,
    profile: { ...profile, role: profile.role },
    year,
    compensation: comp ? {
      hourly_wage_chf: Number(comp.hourly_wage_chf),
      employer_costs_chf_per_hour: Number(comp.employer_costs_chf_per_hour),
      effective_from: comp.effective_from,
      notes: comp.notes,
      ahv_iv_eo_pct: Number(comp.ahv_iv_eo_pct),
      alv_pct: Number(comp.alv_pct),
      nbu_pct: Number(comp.nbu_pct),
      bvg_pct: Number(comp.bvg_pct),
      ktg_pct: Number(comp.ktg_pct),
      quellensteuer_pct: Number(comp.quellensteuer_pct),
    } : null,
    hours: {
      stempel_minutes,
      geplant_minutes,
      rapport_minutes,
    },
    night: {
      count: nightArr.length,
      limit: 24,
      dates: nightArr,
      surcharge_pct: 25,
      note: "Bis 24 Nachteinsätze/Jahr: 25% Lohnzuschlag. Ab 25.: 10% Zeitkompensation statt Geld (ArG Art. 17b).",
    },
    sunday_holiday: {
      count: sunHolArr.length,
      limit: 6,
      dates: sunHolArr,
      surcharge_pct: 50,
      note: "Bis 6 Sonntags+Feiertags-Einsätze/Jahr kombiniert: 50% Lohnzuschlag. Ab 7.: gilt als regelmäßig → Ersatzruhetage (ArGV 1 Art. 28).",
    },
    base_wage_for_surcharge: wage,
  });
}
