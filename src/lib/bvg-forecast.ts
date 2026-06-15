/**
 * BVG-Eintrittsschwellen-Forecast.
 *
 * Berechnet pro Mitarbeiter pro Monat das voraussichtliche Brutto-
 * Einkommen aus GEPLANTEN job_appointments. Wichtig fuer die
 * BVG-Pflicht-Vermeidung: Schweiz-BVG-Eintrittsschwelle ist ein
 * Monatsbetrag (Default 1890 CHF, konfigurierbar in app_settings).
 *
 * Lohn-Berechnung:
 *   reg = Stunden im Normalzeit-Fenster x Stundenlohn
 *   night_premium = Nachtstunden x Stundenlohn x 0.25 (ArG 17b)
 *   sunhol_premium = Sonntag/Feiertag-Stunden x Stundenlohn x 0.5 (ArGV 28)
 *   total = reg + night_premium + sunhol_premium
 *
 * Stacking: Nacht UND Sonntag/Feiertag werden BEIDE addiert (Beispiel
 * Schicht Sa 23:00 -> So 06:00, das ist Nacht + Sonntag = 75% Zuschlag
 * auf den Sonntag-Teil der Nacht).
 *
 * DST-safe: per-Minute-Bucketize via localDateIso/localHour aus
 * swiss-time.ts (gleicher Helper wie /api/hr/monthly-stats).
 */

import { localDateIso, localHour, weekdayForDateIso } from "./swiss-time";
import { swissHolidaysForYear } from "./swiss-holidays";

export interface Appointment {
  start_time: string; // ISO timestamp (UTC)
  end_time: string | null;
}

export interface ForecastResult {
  total_minutes: number;
  regular_minutes: number;
  /** Nacht-Minuten innerhalb des ArG-Limits (= 25%-zuschlags-berechtigt). */
  night_minutes: number;
  /** Sonntag/Feiertag-Minuten innerhalb des ArG-Limits (= 50%-zuschlags-berechtigt). */
  sunhol_minutes: number;
  /** Nacht-Minuten ueber Limit (= 10% Zeitkomp gemaess ArG 17b Abs. 3). */
  night_over_limit_minutes?: number;
  /** Sonntag/Feiertag-Minuten ueber Limit (= keine Lohnzulage, dafuer Ersatzruhetag). */
  sunhol_over_limit_minutes?: number;
  /** Brutto-Schaetzung in CHF inkl. Zuschlaegen. */
  total_chf: number;
  base_chf: number;
  night_premium_chf: number;
  sunhol_premium_chf: number;
}

/** Optional: YTD-Kontext fuer Limit-aware Forecast. Wenn gesetzt, werden
 *  die ArG-Limits (24 Naechte / 6 Sonntage pro Jahr) auf die Period
 *  angewendet — bei ueberschrittenen Limits faellt der entsprechende
 *  Lohnzuschlag weg (genau wie im monthly-stats-API). Wenn nicht
 *  gesetzt -> 'naiver' Forecast wie vorher (= konservativ ueberschaetzend). */
export interface LimitContext {
  /** Bereits gezaehlte Nacht-Schicht-Tage YTD vor der Period. */
  ytdNightDaysBefore: number;
  /** Bereits gezaehlte Sonntag/Feiertag-Tage YTD vor der Period. */
  ytdSunholDaysBefore: number;
}

/** Strikter Brutto-Forecast: filtert per-minute auf das Period-Lokal-
 *  Datum. Wichtig fuer Cross-Midnight-Schichten am Monatswechsel — die
 *  Minuten gehoeren dem Datum auf dem sie tatsaechlich fallen.
 *
 *  Wenn `limits` uebergeben wird, werden 24-Naechte- + 6-Sonntage-Limits
 *  pro Jahr respektiert (wie in der echten Lohnabrechnung). Ueberschuss
 *  Schichten kriegen keinen Zuschlag mehr.
 */
export function calculateForecast(
  appointments: Appointment[],
  hourlyWage: number,
  periodStart: string,
  periodEnd: string,
  limits?: LimitContext,
): ForecastResult {
  const startYear = Number(periodStart.slice(0, 4));
  const endYear = Number(periodEnd.slice(0, 4));
  const holidaySet = new Set<string>();
  for (let y = startYear; y <= endYear + 1; y++) {
    for (const h of swissHolidaysForYear(y)) holidaySet.add(h.date);
  }

  // Per-Day-Buckets (chronologisch sortiert) damit wir die YTD-Rank-
  // Logik aus monthly-stats spiegeln koennen.
  interface DayBucket { date: string; total_minutes: number; night_minutes: number; is_sunhol: boolean; }
  const dayMap = new Map<string, DayBucket>();

  for (const a of appointments) {
    if (!a.end_time) continue;
    const s = new Date(a.start_time).getTime();
    const e = new Date(a.end_time).getTime();
    if (e <= s) continue;
    for (let t = s; t < e; t += 60_000) {
      const d = new Date(t);
      const date = localDateIso(d);
      if (date < periodStart || date > periodEnd) continue;
      const hour = localHour(d);
      const isNight = hour >= 23 || hour < 6;
      const wd = weekdayForDateIso(date);
      const isSunhol = wd === 0 || holidaySet.has(date);
      let b = dayMap.get(date);
      if (!b) { b = { date, total_minutes: 0, night_minutes: 0, is_sunhol: isSunhol }; dayMap.set(date, b); }
      b.total_minutes += 1;
      if (isNight) b.night_minutes += 1;
    }
  }

  let regular = 0;
  let night = 0;       // night_minutes within ArG-24-Limit (eligible for 25%)
  let sunhol = 0;      // sunhol_minutes within ArG-6-Limit (eligible for 50%)
  let nightOver = 0;   // night_minutes ueber Limit (= 10% Zeitkomp ArG 17b)
  let sunholOver = 0;  // sunhol_minutes ueber Limit (= keine zuschlagsfähigen Stunden)

  const sorted = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  let nightRank = limits?.ytdNightDaysBefore ?? 0;
  let sunholRank = limits?.ytdSunholDaysBefore ?? 0;
  for (const d of sorted) {
    regular += d.total_minutes;
    if (d.night_minutes > 0) {
      nightRank++;
      if (limits == null || nightRank <= 24) night += d.night_minutes;
      else nightOver += d.night_minutes;
    }
    if (d.is_sunhol && d.total_minutes > 0) {
      sunholRank++;
      if (limits == null || sunholRank <= 6) sunhol += d.total_minutes;
      else sunholOver += d.total_minutes;
    }
  }

  const base = (regular / 60) * hourlyWage;
  const nightPremium = (night / 60) * hourlyWage * 0.25;
  const sunholPremium = (sunhol / 60) * hourlyWage * 0.5;
  return {
    total_minutes: regular,
    regular_minutes: regular,
    night_minutes: night,
    sunhol_minutes: sunhol,
    night_over_limit_minutes: nightOver,
    sunhol_over_limit_minutes: sunholOver,
    total_chf: base + nightPremium + sunholPremium,
    base_chf: base,
    night_premium_chf: nightPremium,
    sunhol_premium_chf: sunholPremium,
  };
}

/** Helper fuer Period-Generation: gibt YYYY-MM-01 + letzter Tag des Monats. */
export function monthRange(year: number, month: number): { start: string; end: string; label: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const label = new Date(Date.UTC(year, month - 1, 12)).toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich", month: "long", year: "numeric",
  });
  return { start, end, label };
}

/** Status fuer UI-Faerbung. */
export function forecastStatus(chf: number, threshold: number): "ok" | "warn" | "crit" {
  const ratio = chf / threshold;
  if (ratio >= 0.95) return "crit";
  if (ratio >= 0.70) return "warn";
  return "ok";
}
