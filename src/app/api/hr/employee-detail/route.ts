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

function toZrhDate(iso: string): Date {
  return new Date(iso); // UTC parsed; wir formatieren mit ZRH bei Bedarf
}

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

interface TimeEntryRow {
  clock_in: string;
  clock_out: string | null;
}

// Ein Time-Entry deckt Nachtstunden ab, wenn er IRGENDWIE 23:00-06:00
// (Zuerich-Lokal) ueberlappt. Wir checken stundenweise — eine Sample-
// Stunde je Stunde im Zeitraum reicht weil die Window 23-06 ist.
function entryTouchesNight(entry: TimeEntryRow): boolean {
  if (!entry.clock_out) return false;
  const start = new Date(entry.clock_in).getTime();
  const end = new Date(entry.clock_out).getTime();
  if (end <= start) return false;
  // Step in 30-min-Schritten durch den Eintrag und check ob die Stunde
  // im Nacht-Fenster (>=23 || <6) liegt.
  for (let t = start; t < end; t += 30 * 60 * 1000) {
    const h = localHour(new Date(t));
    if (h >= 23 || h < 6) return true;
  }
  // Sicherstellen dass der letzte Moment (end - 1ms) auch geprueft wird.
  const lastH = localHour(new Date(end - 1));
  return lastH >= 23 || lastH < 6;
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
    .select("clock_in, clock_out")
    .eq("user_id", profileId)
    .gte("clock_in", yearStart)
    .lt("clock_in", yearEnd)
    .order("clock_in");

  // Aggregate: Nachtarbeit + Sonntag/Feiertag (per Kalendertag dedupliziert).
  const holidays = swissHolidaysForYear(year);
  const holidayMap = new Map(holidays.map((h) => [h.date, h.name]));

  const nightDates = new Map<string, { date: string; entries: number }>();
  const sundayHolidayDates = new Map<string, { date: string; label: string }>();

  let stempel_minutes = 0;
  for (const e of (entries as TimeEntryRow[] | null) ?? []) {
    if (e.clock_out) {
      const ms = new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime();
      if (ms > 0) stempel_minutes += Math.floor(ms / 60000);
    }
    const startDate = toZrhDate(e.clock_in);
    const dateIso = localDateIso(startDate);
    // Nacht-Detection
    if (entryTouchesNight(e)) {
      const cur = nightDates.get(dateIso);
      nightDates.set(dateIso, { date: dateIso, entries: (cur?.entries ?? 0) + 1 });
    }
    // Sonntag/Feiertag
    const wd = localWeekday(startDate);
    const isSunday = wd === 0;
    const isHoliday = holidayMap.has(dateIso);
    if (isSunday || isHoliday) {
      const label = isHoliday ? (holidayMap.get(dateIso) ?? "") : "Sonntag";
      sundayHolidayDates.set(dateIso, { date: dateIso, label });
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
      const mins = Math.max(0, eh * 60 + em - sh * 60 - sm - pause);
      rapport_minutes += mins;
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
