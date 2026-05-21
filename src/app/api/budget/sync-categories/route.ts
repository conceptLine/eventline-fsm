// POST /api/budget/sync-categories
//
// Manueller Trigger fuer den Bexio-Konten-Sync. Holt alle aktiven Konten
// aus Bexio und legt fehlende budget_categories an. Idempotent — kann
// jederzeit gefahrlos erneut gerufen werden.
//
// Permission: budget:edit + trusted device (sensible Operation, kann
// Kategorien massenhaft erzeugen).

import { NextResponse } from "next/server";
import { requireTrustedDevice } from "@/lib/api-auth";
import { syncBexioAccountsToBudgetCategories } from "@/lib/bexio";

export async function POST() {
  const auth = await requireTrustedDevice("budget:edit");
  if (auth.error) return auth.error;

  try {
    const result = await syncBexioAccountsToBudgetCategories();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
