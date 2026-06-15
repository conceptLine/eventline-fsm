// Firmenweite Lohn-Standardwerte. Seit Migration 156: 12 Prozent-Felder
// (6 AG-Anteil + 6 Mitarbeiter-Abzuege). Per Mitarbeiter wird via
// uses_standard_lohn-Flag all-or-nothing entschieden.
//
// GET  -> { defaults: LohnPctSet }
// POST -> Partial-Update: Body kann beliebige Felder enthalten.
//
// Permission: lohn:manage (Admin laeuft via has_permission automatisch durch).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrustedDevice } from "@/lib/api-auth";
import { loadLohnDefaults } from "@/lib/employer-costs";

export async function GET() {
  const auth = await requireTrustedDevice("lohn:manage");
  if (auth.error) return auth.error;

  const defaults = await loadLohnDefaults(createAdminClient());
  return NextResponse.json({ success: true, defaults });
}

// Mapping vom Body-Key auf den DB-Spaltennamen. Alle Felder sind Pct.
const FIELDS: Array<{ key: string; column: string }> = [
  // AN-Abzuege
  { key: "default_ahv_iv_eo_pct", column: "default_ahv_iv_eo_pct" },
  { key: "default_alv_pct", column: "default_alv_pct" },
  { key: "default_nbu_pct", column: "default_nbu_pct" },
  { key: "default_bvg_pct", column: "default_bvg_pct" },
  { key: "default_ktg_pct", column: "default_ktg_pct" },
  { key: "default_quellensteuer_pct", column: "default_quellensteuer_pct" },
  // AG-Anteil
  { key: "default_employer_ahv_pct", column: "default_employer_ahv_pct" },
  { key: "default_employer_alv_pct", column: "default_employer_alv_pct" },
  { key: "default_employer_fak_pct", column: "default_employer_fak_pct" },
  { key: "default_employer_bu_pct", column: "default_employer_bu_pct" },
  { key: "default_employer_bvg_pct", column: "default_employer_bvg_pct" },
  { key: "default_employer_verwaltung_pct", column: "default_employer_verwaltung_pct" },
];

export async function POST(request: Request) {
  const auth = await requireTrustedDevice("lohn:manage");
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ success: false, error: "Ungueltiger Body" }, { status: 400 });
  }

  const update: Record<string, number> = {};
  for (const f of FIELDS) {
    if (!(f.key in body)) continue;
    const raw = (body as Record<string, unknown>)[f.key];
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return NextResponse.json({ success: false, error: `${f.key} ungueltig (erwartet 0-100)` }, { status: 400 });
    }
    update[f.column] = value;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: false, error: "Keine Felder zum Updaten" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("app_settings").update(update).eq("id", 1);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
