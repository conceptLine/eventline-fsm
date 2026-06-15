/**
 * Lohn-Defaults und effektive Werte pro Mitarbeiter.
 *
 * Schema seit Migration 156:
 *   - app_settings hat 12 Pct-Defaults: 6 AG-Anteil + 6 AN-Abzuege.
 *   - employee_compensation.uses_standard_lohn=true => alle Per-Spalten
 *     werden ignoriert, der Firmen-Standard greift komplett (all-or-
 *     nothing). uses_standard_lohn=false => die 12 expliziten Spalten
 *     zaehlen (NULL fallback auf 0 — UI sollte die nicht NULL lassen).
 *
 * AG-Anteil pro Stunde = Brutto * (Summe der 6 AG-Pcts) / 100.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LohnPctSet {
  // Mitarbeiter-Abzuege (% vom Brutto)
  ahvIvEoPct: number;
  alvPct: number;
  nbuPct: number;
  bvgPct: number;
  ktgPct: number;
  quellensteuerPct: number;
  // Arbeitgeber-Anteil (% vom Brutto)
  employerAhvPct: number;
  employerAlvPct: number;
  employerFakPct: number;
  employerBuPct: number;
  employerBvgPct: number;
  employerVerwaltungPct: number;
}

const FALLBACK: LohnPctSet = {
  ahvIvEoPct: 5.3,
  alvPct: 1.1,
  nbuPct: 1.4,
  bvgPct: 0,
  ktgPct: 0,
  quellensteuerPct: 0,
  employerAhvPct: 5.3,
  employerAlvPct: 1.1,
  employerFakPct: 1.5,
  employerBuPct: 0.5,
  employerBvgPct: 3.0,
  employerVerwaltungPct: 0.5,
};

/** Summe der 6 AG-Pcts (= Arbeitgeber-Anteil als % vom Brutto). */
export function sumEmployerPct(s: LohnPctSet): number {
  return s.employerAhvPct + s.employerAlvPct + s.employerFakPct
       + s.employerBuPct + s.employerBvgPct + s.employerVerwaltungPct;
}

/** Summe der 6 AN-Pcts (= Mitarbeiter-Abzuege als % vom Brutto). */
export function sumEmployeePct(s: LohnPctSet): number {
  return s.ahvIvEoPct + s.alvPct + s.nbuPct + s.bvgPct + s.ktgPct + s.quellensteuerPct;
}

/** AG-Anteil pro Stunde in CHF. */
export function employerCostsPerHour(brutto: number, agPctSum: number): number {
  return (brutto * agPctSum) / 100;
}

/** Liefert die effektiven Pcts fuer eine Compensation-Row. Bei
 *  uses_standard_lohn (oder fehlender Row): Firmen-Standard. Sonst die
 *  expliziten Spalten-Werte (NULL -> 0). */
export function effectivePcts(
  comp: PctComp | null | undefined,
  defaults: LohnPctSet,
): LohnPctSet {
  if (!comp || comp.uses_standard_lohn !== false) return defaults;
  const n = (v: unknown): number => v == null ? 0 : Number(v);
  return {
    ahvIvEoPct: n(comp.ahv_iv_eo_pct),
    alvPct: n(comp.alv_pct),
    nbuPct: n(comp.nbu_pct),
    bvgPct: n(comp.bvg_pct),
    ktgPct: n(comp.ktg_pct),
    quellensteuerPct: n(comp.quellensteuer_pct),
    employerAhvPct: n(comp.employer_ahv_pct),
    employerAlvPct: n(comp.employer_alv_pct),
    employerFakPct: n(comp.employer_fak_pct),
    employerBuPct: n(comp.employer_bu_pct),
    employerBvgPct: n(comp.employer_bvg_pct),
    employerVerwaltungPct: n(comp.employer_verwaltung_pct),
  };
}

/** Minimaler Row-Shape den effectivePcts braucht. */
export interface PctComp {
  uses_standard_lohn?: boolean | null;
  ahv_iv_eo_pct?: number | string | null;
  alv_pct?: number | string | null;
  nbu_pct?: number | string | null;
  bvg_pct?: number | string | null;
  ktg_pct?: number | string | null;
  quellensteuer_pct?: number | string | null;
  employer_ahv_pct?: number | string | null;
  employer_alv_pct?: number | string | null;
  employer_fak_pct?: number | string | null;
  employer_bu_pct?: number | string | null;
  employer_bvg_pct?: number | string | null;
  employer_verwaltung_pct?: number | string | null;
}

/** Laedt alle 12 Default-Pcts in einem Query. */
export async function loadLohnDefaults(client: SupabaseClient): Promise<LohnPctSet> {
  const { data } = await client
    .from("app_settings")
    .select("default_ahv_iv_eo_pct, default_alv_pct, default_nbu_pct, default_bvg_pct, default_ktg_pct, default_quellensteuer_pct, default_employer_ahv_pct, default_employer_alv_pct, default_employer_fak_pct, default_employer_bu_pct, default_employer_bvg_pct, default_employer_verwaltung_pct")
    .eq("id", 1)
    .maybeSingle();
  return {
    ahvIvEoPct: Number(data?.default_ahv_iv_eo_pct ?? FALLBACK.ahvIvEoPct),
    alvPct: Number(data?.default_alv_pct ?? FALLBACK.alvPct),
    nbuPct: Number(data?.default_nbu_pct ?? FALLBACK.nbuPct),
    bvgPct: Number(data?.default_bvg_pct ?? FALLBACK.bvgPct),
    ktgPct: Number(data?.default_ktg_pct ?? FALLBACK.ktgPct),
    quellensteuerPct: Number(data?.default_quellensteuer_pct ?? FALLBACK.quellensteuerPct),
    employerAhvPct: Number(data?.default_employer_ahv_pct ?? FALLBACK.employerAhvPct),
    employerAlvPct: Number(data?.default_employer_alv_pct ?? FALLBACK.employerAlvPct),
    employerFakPct: Number(data?.default_employer_fak_pct ?? FALLBACK.employerFakPct),
    employerBuPct: Number(data?.default_employer_bu_pct ?? FALLBACK.employerBuPct),
    employerBvgPct: Number(data?.default_employer_bvg_pct ?? FALLBACK.employerBvgPct),
    employerVerwaltungPct: Number(data?.default_employer_verwaltung_pct ?? FALLBACK.employerVerwaltungPct),
  };
}
