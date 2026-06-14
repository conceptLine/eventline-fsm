/**
 * Effektive Arbeitgeber-Kosten + Abzuege pro Stunde: Override oder
 * firmenweiter Standard.
 *
 * Regel ueberall: pro-Mitarbeiter-Override gewinnt. NULL = Default aus
 * app_settings (Migrationen 152 + 153).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LohnDefaults {
  employerCostsChfPerHour: number;
  ahvIvEoPct: number;
  alvPct: number;
  nbuPct: number;
  bvgPct: number;
  ktgPct: number;
  quellensteuerPct: number;
}

const FALLBACK: LohnDefaults = {
  employerCostsChfPerHour: 0,
  ahvIvEoPct: 5.3,
  alvPct: 1.1,
  nbuPct: 1.4,
  bvgPct: 0,
  ktgPct: 0,
  quellensteuerPct: 0,
};

export function resolveEmployerCosts(
  override: number | null | undefined,
  defaultPerHour: number,
): number {
  if (override == null) return defaultPerHour;
  return Number(override);
}

/** Generische Pct-Resolver — gleicher Mechanismus fuer alle 6 Abzuege. */
export function resolvePct(
  override: number | null | undefined,
  fallback: number,
): number {
  if (override == null) return fallback;
  return Number(override);
}

export async function loadDefaultEmployerCosts(client: SupabaseClient): Promise<number> {
  const { data } = await client
    .from("app_settings")
    .select("default_employer_costs_chf_per_hour")
    .eq("id", 1)
    .maybeSingle();
  return Number(data?.default_employer_costs_chf_per_hour ?? FALLBACK.employerCostsChfPerHour);
}

/** Laedt alle Standardwerte in einem Query. Bevorzugt verwenden wenn
 *  mehrere Defaults gleichzeitig gebraucht werden (z.B. Lohnabrechnung). */
export async function loadLohnDefaults(client: SupabaseClient): Promise<LohnDefaults> {
  const { data } = await client
    .from("app_settings")
    .select(
      "default_employer_costs_chf_per_hour, default_ahv_iv_eo_pct, default_alv_pct, default_nbu_pct, default_bvg_pct, default_ktg_pct, default_quellensteuer_pct",
    )
    .eq("id", 1)
    .maybeSingle();
  return {
    employerCostsChfPerHour: Number(data?.default_employer_costs_chf_per_hour ?? FALLBACK.employerCostsChfPerHour),
    ahvIvEoPct: Number(data?.default_ahv_iv_eo_pct ?? FALLBACK.ahvIvEoPct),
    alvPct: Number(data?.default_alv_pct ?? FALLBACK.alvPct),
    nbuPct: Number(data?.default_nbu_pct ?? FALLBACK.nbuPct),
    bvgPct: Number(data?.default_bvg_pct ?? FALLBACK.bvgPct),
    ktgPct: Number(data?.default_ktg_pct ?? FALLBACK.ktgPct),
    quellensteuerPct: Number(data?.default_quellensteuer_pct ?? FALLBACK.quellensteuerPct),
  };
}
