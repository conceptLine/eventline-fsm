// POST /api/budget/sync-categories
//
// Manueller Trigger fuer den Bexio-Sync. Macht zwei Schritte:
//   1. syncBexioAccountsToBudgetCategories — holt Konten aus Bexio,
//      legt fehlende budget_categories an.
//   2. aggregateBookingsByMonth — zieht Buchungen des aktuellen +
//      Vorjahres und upserted in budget_account_snapshot. Sonst muss
//      der User bis 3 Uhr morgens auf den Cron warten, um Ist-Werte
//      zu sehen.
//
// Permission: budget:edit + trusted device.

import { NextResponse } from "next/server";
import { requireTrustedDevice } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncBexioAccountsToBudgetCategories, aggregateBookingsByMonth } from "@/lib/bexio";

export async function POST() {
  const auth = await requireTrustedDevice("budget:edit");
  if (auth.error) return auth.error;

  const admin = createAdminClient();

  try {
    const catResult = await syncBexioAccountsToBudgetCategories();

    // Snapshot-Aggregation fuer aktuelles + Vorjahr (24 Monate).
    const now = new Date();
    const fromYear = now.getFullYear() - 1;
    const from = `${fromYear}-01-01`;
    const to = `${now.getFullYear()}-12-31`;

    const agg = await aggregateBookingsByMonth({ from, to });

    type SnapshotRow = {
      bexio_account_no: string;
      fiscal_year: number;
      fiscal_month: number;
      sum_chf: number;
      booking_count: number;
      last_synced_at: string;
    };
    const rows: SnapshotRow[] = [];
    const nowIso = new Date().toISOString();
    for (const [accountNo, byMonth] of agg.entries()) {
      for (const [monthKey, totals] of byMonth.entries()) {
        const [y, m] = monthKey.split("-").map(Number);
        if (!y || !m) continue;
        rows.push({
          bexio_account_no: accountNo,
          fiscal_year: y,
          fiscal_month: m,
          sum_chf: Number(totals.sum_chf.toFixed(2)),
          booking_count: totals.booking_count,
          last_synced_at: nowIso,
        });
      }
    }

    let snapshotRows = 0;
    if (rows.length > 0) {
      const { error: upErr } = await admin
        .from("budget_account_snapshot")
        .upsert(rows, { onConflict: "bexio_account_no,fiscal_year,fiscal_month" });
      if (upErr) {
        return NextResponse.json(
          { success: false, error: `Snapshot-Upsert: ${upErr.message}`, ...catResult },
          { status: 500 },
        );
      }
      snapshotRows = rows.length;
    }

    // Audit-Log fuer das manuelle Sync-Event.
    await admin.from("budget_access_log").insert({
      user_id: auth.user.id,
      action: "sync_completed",
      details: { source: "manual", catSync: catResult, snapshotRows, from, to },
    });

    return NextResponse.json({ success: true, ...catResult, snapshot_rows: snapshotRows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
