// GET /api/hr/monthly-stats?month=YYYY-MM
//
// Liefert pro Mitarbeiter die aggregierten Stunden + Kosten fuer
// den angegebenen Monat — INKLUSIVE Zuschlaegen fuer Nacht- und
// Sonntags-/Feiertagsarbeit gemaess Schweizer ArG:
//
//   - Nachtarbeit (23:00-06:00): erste 24 Einsaetze pro Kalenderjahr
//     bekommen 25% Lohnzuschlag (ArG Art. 17b). Ab Einsatz 25 nur noch
//     10% Zeitkompensation (= kein Geld → nicht in Lohnkosten).
//   - Sonntag/Feiertag-Arbeit: erste 6 Einsaetze (combined) pro Jahr
//     bekommen 50% Lohnzuschlag (ArGV 1 Art. 28). Ab 7. → Ersatzruhetage.
//
// Algorithmus:
//   1. RPC liefert basis-Stempel/Geplant/Rapport-Minuten + Comp-Daten
//   2. Zusaetzlich fetchen wir alle time_entries des Kalenderjahres
//   3. Pro Profile + Datum: ermitteln Nacht-Minuten und ob Sonntag/Feiertag
//   4. Per YTD-Reihenfolge: bestimmen ob diese Schicht noch im Limit liegt
//   5. Nur die zuschlags-berechtigten Stunden DIESES Monats kriegen Premium
//
// Permission: strikt admin-only (Trust-Device + role='admin' + RPC-Guard).

import { NextResponse } from "next/server";
import { requireTrustedDevice } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { swissHolidaysForYear } from "@/lib/swiss-holidays";

interface RpcRow {
  profile_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  stempel_minutes: number;
  geplant_minutes: number;
  rapport_minutes: number;
  hourly_wage_chf: number | null;
  employer_costs_chf_per_hour: number | null;
  ahv_iv_eo_pct: number | null;
  alv_pct: number | null;
  nbu_pct: number | null;
  bvg_pct: number | null;
  ktg_pct: number | null;
  quellensteuer_pct: number | null;
}

const ZRH_TZ = "Europe/Zurich";

function localDateIso(d: Date): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: ZRH_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d);
}
function localHour(d: Date): number {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: ZRH_TZ, hour: "2-digit", hour12: false });
  return Number(f.format(d).split(":")[0]);
}
function localWeekday(d: Date): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: ZRH_TZ, weekday: "short" });
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[f.format(d)] ?? 0;
}

/** Bucketize Minutes per local-date — eine Schicht 22:00-04:00 verteilt
 *  ihre Minuten korrekt auf 2 Datums-Buckets. Vorher wurde alles dem
 *  clock_in-Datum zugeschrieben → Sa-Nacht-Stunden bekamen keinen
 *  Sonntags-Zuschlag. */
function bucketizeEntry(
  clockIn: string,
  clockOut: string,
  perDate: Map<string, { date: string; total_minutes: number; night_minutes: number }>,
) {
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();
  if (end <= start) return;
  for (let t = start; t < end; t += 60_000) {
    const d = new Date(t);
    const date = localDateIso(d);
    let b = perDate.get(date);
    if (!b) {
      b = { date, total_minutes: 0, night_minutes: 0 };
      perDate.set(date, b);
    }
    b.total_minutes++;
    const h = localHour(d);
    if (h >= 23 || h < 6) b.night_minutes++;
  }
}

interface DayBucket {
  date: string; // YYYY-MM-DD lokal
  total_minutes: number;
  night_minutes: number;
  is_sunhol: boolean;
  in_current_month: boolean;
}

interface SurchargeResult {
  night_surcharge_chf: number;
  sunhol_surcharge_chf: number;
  total_surcharge_chf: number;
  // Diagnostics fuers UI-Tooltip
  night_eligible_minutes: number;
  sunhol_eligible_minutes: number;
  ytd_night_shifts_before_month: number;
  ytd_sunhol_shifts_before_month: number;
}

export async function GET(req: Request) {
  const auth = await requireTrustedDevice("lohn:manage");
  if (auth.error) return auth.error;
  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ success: false, error: "Nur für Administratoren" }, { status: 403 });
  }

  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ success: false, error: "Ungültiger Monat (erwartet YYYY-MM)" }, { status: 400 });
  }
  const monthStart = `${month}-01`;
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_monthly_payroll_stats", { p_month_start: monthStart });
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Alle Time-Entries die LOKAL irgendeinen Anteil im Kalenderjahr haben.
  // Filter ist clock_in zwischen [Vorjahres-Dez-30, Folgejahr-Jan-2] um
  // Schichten an Jahres-Wechseln (z.B. Silvester 22:00 - 1.1. 04:00)
  // korrekt zu erfassen — die Per-Minute-Attribution sortiert sie dann
  // anhand des lokalen Datums in den richtigen Day-Bucket. UTC-Cutoffs
  // mit grosszuegigem Puffer.
  const profileIds = (data as RpcRow[]).map((r) => r.profile_id);
  const fetchStartIso = new Date(`${year - 1}-12-30T00:00:00Z`).toISOString();
  const fetchEndIso = new Date(`${year + 1}-01-02T00:00:00Z`).toISOString();
  const { data: entries } = await adminClient
    .from("time_entries")
    .select("user_id, clock_in, clock_out")
    .in("user_id", profileIds)
    .gte("clock_in", fetchStartIso)
    .lt("clock_in", fetchEndIso)
    .not("clock_out", "is", null);

  // Pro Profile + Datum aggregieren — per-Minute-Attribution
  const holidays = swissHolidaysForYear(year);
  const holidaySet = new Set(holidays.map((h) => h.date));
  const monthPrefix = `${yearStr}-${monthStr.padStart(2, "0")}-`;
  const yearPrefix = `${yearStr}-`;

  type EntryRow = { user_id: string; clock_in: string; clock_out: string };
  const perProfileDays = new Map<string, Map<string, DayBucket>>();
  for (const e of (entries as EntryRow[] | null) ?? []) {
    let byDate = perProfileDays.get(e.user_id);
    if (!byDate) { byDate = new Map(); perProfileDays.set(e.user_id, byDate); }
    // Sammele Minuten pro local-date
    const rawDates = new Map<string, { date: string; total_minutes: number; night_minutes: number }>();
    bucketizeEntry(e.clock_in, e.clock_out, rawDates);
    // In den Profile-Buckets mergen + is_sunhol/in_current_month annotieren
    for (const r of rawDates.values()) {
      // Date ausserhalb des Ziel-Kalenderjahres ignorieren (Silvester-
      // Schicht spannt 2 Jahre, hier nur das Ziel-Jahr behalten).
      if (!r.date.startsWith(yearPrefix)) continue;
      let bucket = byDate.get(r.date);
      if (!bucket) {
        // Wochentag bestimmen via Date-Konstruktor lokal — wir nehmen
        // 12:00 Mittag des Datums um DST-/Mitternacht-Edges zu vermeiden.
        const [y, m, d] = r.date.split("-").map(Number);
        const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        const wd = localWeekday(noon);
        bucket = {
          date: r.date,
          total_minutes: 0,
          night_minutes: 0,
          is_sunhol: wd === 0 || holidaySet.has(r.date),
          in_current_month: r.date.startsWith(monthPrefix),
        };
        byDate.set(r.date, bucket);
      }
      bucket.total_minutes += r.total_minutes;
      bucket.night_minutes += r.night_minutes;
    }
  }

  // Pro Mitarbeiter: Surcharge-Berechnung anhand seiner YTD-Tage. Sortiert
  // nach Datum gibt uns den Einsatz-Rang fuers Jahres-Limit (24 Naechte /
  // 6 Sonntage+Feiertage).
  function computeSurcharges(buckets: DayBucket[], hourlyWage: number): SurchargeResult {
    const sorted = [...buckets].sort((a, b) => a.date.localeCompare(b.date));
    const nightDays = sorted.filter((d) => d.night_minutes > 0);
    const sunholDays = sorted.filter((d) => d.is_sunhol && d.total_minutes > 0);

    const ytdNightBefore = nightDays.filter((d) => !d.in_current_month && d.date < monthPrefix).length;
    const ytdSunholBefore = sunholDays.filter((d) => !d.in_current_month && d.date < monthPrefix).length;

    let nightEligibleMin = 0;
    let nightRank = ytdNightBefore;
    for (const d of nightDays) {
      if (d.in_current_month) {
        nightRank++;
        if (nightRank <= 24) nightEligibleMin += d.night_minutes;
      }
    }

    let sunholEligibleMin = 0;
    let sunholRank = ytdSunholBefore;
    for (const d of sunholDays) {
      if (d.in_current_month) {
        sunholRank++;
        if (sunholRank <= 6) sunholEligibleMin += d.total_minutes;
      }
    }

    const nightSurcharge = (nightEligibleMin / 60) * hourlyWage * 0.25;
    const sunholSurcharge = (sunholEligibleMin / 60) * hourlyWage * 0.5;

    return {
      night_surcharge_chf: nightSurcharge,
      sunhol_surcharge_chf: sunholSurcharge,
      total_surcharge_chf: nightSurcharge + sunholSurcharge,
      night_eligible_minutes: nightEligibleMin,
      sunhol_eligible_minutes: sunholEligibleMin,
      ytd_night_shifts_before_month: ytdNightBefore,
      ytd_sunhol_shifts_before_month: ytdSunholBefore,
    };
  }

  const employees = (data as RpcRow[]).map((r) => {
    const effectiveMinutes = r.rapport_minutes > 0 ? r.rapport_minutes : r.stempel_minutes;
    const hours = effectiveMinutes / 60;
    const wage = r.hourly_wage_chf != null ? Number(r.hourly_wage_chf) : null;
    const employer = r.employer_costs_chf_per_hour != null ? Number(r.employer_costs_chf_per_hour) : 0;

    // Surcharges nur wenn Wage gesetzt UND in_current_month-Days vorhanden
    const buckets = Array.from(perProfileDays.get(r.profile_id)?.values() ?? []);
    const surcharges = (wage != null && buckets.length > 0)
      ? computeSurcharges(buckets, wage)
      : { night_surcharge_chf: 0, sunhol_surcharge_chf: 0, total_surcharge_chf: 0,
          night_eligible_minutes: 0, sunhol_eligible_minutes: 0,
          ytd_night_shifts_before_month: 0, ytd_sunhol_shifts_before_month: 0 };

    const baseLohnkosten = wage != null ? hours * wage : null;
    const lohnkostenWithSurcharge = baseLohnkosten != null
      ? baseLohnkosten + surcharges.total_surcharge_chf
      : null;
    const vollkosten = wage != null
      ? hours * (wage + employer) + surcharges.total_surcharge_chf
      : null;
    const totalDeductionPct = Number(r.ahv_iv_eo_pct ?? 0)
      + Number(r.alv_pct ?? 0)
      + Number(r.nbu_pct ?? 0)
      + Number(r.bvg_pct ?? 0)
      + Number(r.ktg_pct ?? 0)
      + Number(r.quellensteuer_pct ?? 0);
    const nettolohn = lohnkostenWithSurcharge != null
      ? lohnkostenWithSurcharge * (1 - totalDeductionPct / 100)
      : null;
    return {
      ...r,
      hourly_wage_chf: wage,
      employer_costs_chf_per_hour: r.employer_costs_chf_per_hour != null ? Number(r.employer_costs_chf_per_hour) : null,
      effective_basis: r.rapport_minutes > 0 ? "rapport" : "stempel",
      base_lohnkosten_chf: baseLohnkosten,
      lohnkosten_chf: lohnkostenWithSurcharge,
      vollkosten_chf: vollkosten,
      nettolohn_chf: nettolohn,
      total_deduction_pct: totalDeductionPct,
      night_surcharge_chf: surcharges.night_surcharge_chf,
      sunhol_surcharge_chf: surcharges.sunhol_surcharge_chf,
      total_surcharge_chf: surcharges.total_surcharge_chf,
      night_eligible_minutes: surcharges.night_eligible_minutes,
      sunhol_eligible_minutes: surcharges.sunhol_eligible_minutes,
      // Hinweis-Flags fuers UI: wenn YTD-Limit ueberschritten wurde
      night_over_limit: surcharges.ytd_night_shifts_before_month >= 24,
      sunhol_over_limit: surcharges.ytd_sunhol_shifts_before_month >= 6,
    };
  });

  return NextResponse.json({ success: true, month, employees });
}
