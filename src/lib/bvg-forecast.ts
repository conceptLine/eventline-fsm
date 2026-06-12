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
  night_minutes: number;
  sunhol_minutes: number;
  /** Brutto-Schaetzung in CHF inkl. Zuschlaegen. */
  total_chf: number;
  base_chf: number;
  night_premium_chf: number;
  sunhol_premium_chf: number;
}

/** Strikter Brutto-Forecast: filtert per-minute auf das Period-Lokal-
 *  Datum. Wichtig fuer Cross-Midnight-Schichten am Monatswechsel — die
 *  Minuten gehoeren dem Datum auf dem sie tatsaechlich fallen. */
export function calculateForecast(
  appointments: Appointment[],
  hourlyWage: number,
  periodStart: string,
  periodEnd: string,
): ForecastResult {
  const startYear = Number(periodStart.slice(0, 4));
  const endYear = Number(periodEnd.slice(0, 4));
  const holidaySet = new Set<string>();
  for (let y = startYear; y <= endYear + 1; y++) {
    for (const h of swissHolidaysForYear(y)) holidaySet.add(h.date);
  }

  let regular = 0;
  let night = 0;
  let sunhol = 0;

  for (const a of appointments) {
    if (!a.end_time) continue;
    const s = new Date(a.start_time).getTime();
    const e = new Date(a.end_time).getTime();
    if (e <= s) continue;
    for (let t = s; t < e; t += 60_000) {
      const d = new Date(t);
      const date = localDateIso(d);
      // Nur Minuten deren Lokal-Datum in der Period ist
      if (date < periodStart || date > periodEnd) continue;
      const hour = localHour(d);
      const isNight = hour >= 23 || hour < 6;
      const wd = weekdayForDateIso(date);
      const isSunhol = wd === 0 || holidaySet.has(date);
      regular++;
      if (isNight) night++;
      if (isSunhol) sunhol++;
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
