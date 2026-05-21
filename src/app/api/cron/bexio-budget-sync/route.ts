// Cron — Bexio-Buchungen aggregieren und in budget_account_snapshot upserten.
//
// Schedule: taeglich 3 Uhr morgens (vercel.json).
//
// Was passiert:
//   1. Pruefen: ist feature_accounting an? Sonst skip.
//   2. Aktuelles Geschaeftsjahr + Vorjahr ziehen (12+12 Monate Daten — der
//      Vergleich auf der Page geht max 2 Jahre zurueck).
//   3. listAccounts() + aggregateBookingsByMonth() in bexio.ts.
//   4. Resultat in budget_account_snapshot upserten (account_no, year, month).
//   5. Audit-Log: sync_started, sync_completed/sync_failed + Anzahl Eintraege.
//
// Datensparsamkeit: Wir speichern ausschliesslich die aggregierten Monats-
// Summen, KEINE Einzel-Buchungen. Buchungen fliessen durch Cron-Memory,
// aber landen nicht in der DB.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aggregateBookingsByMonth, ACCOUNTING_SCOPE, syncBexioAccountsToBudgetCategories } from "@/lib/bexio";
import { logError } from "@/lib/log";

export async function GET(request: Request) {
  // CRON_SECRET-Header pruefen (Pattern aus /api/cron/reminders).
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET fehlt in der Server-Config" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Vor-Check: Modul aktiv?
  const { data: conn } = await admin
    .from("bexio_connection")
    .select("scope, feature_accounting")
    .eq("id", 1)
    .maybeSingle();

  if (!conn) {
    return NextResponse.json({ skipped: true, reason: "Bexio nicht verbunden" });
  }
  if (!conn.feature_accounting) {
    return NextResponse.json({ skipped: true, reason: "feature_accounting=false" });
  }
  const grantedScopes = (conn.scope ?? "").split(/\s+/);
  if (!grantedScopes.includes(ACCOUNTING_SCOPE)) {
    return NextResponse.json({ skipped: true, reason: "Token ohne accounting-Scope" });
  }

  // Audit: Start.
  await admin.from("budget_access_log").insert({
    user_id: null,
    action: "sync_started",
    details: null,
  });

  // Zeit-Fenster: aktuelles Jahr + Vorjahr (24 Monate). Begrenzt was die
  // Page maximal zurueckblicken kann — frueher braucht keiner.
  const now = new Date();
  const fromYear = now.getFullYear() - 1;
  const from = `${fromYear}-01-01`;
  const to = `${now.getFullYear()}-12-31`;

  try {
    // Zuerst Kontenrahmen-Sync (idempotent) — neue Konten landen als
    // budget_categories. Nichts wird geloescht, nur dazugefuegt.
    const catSync = await syncBexioAccountsToBudgetCategories();

    const agg = await aggregateBookingsByMonth({ from, to });

    // Upsert in budget_account_snapshot. Pro Konto pro Monat ein Eintrag.
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

    if (rows.length > 0) {
      const { error: upErr } = await admin
        .from("budget_account_snapshot")
        .upsert(rows, { onConflict: "bexio_account_no,fiscal_year,fiscal_month" });
      if (upErr) throw new Error(`Snapshot-Upsert fehlgeschlagen: ${upErr.message}`);
    }

    await admin.from("budget_access_log").insert({
      user_id: null,
      action: "sync_completed",
      details: { rows: rows.length, from, to, catSync },
    });

    return NextResponse.json({ success: true, rows: rows.length, from, to, catSync });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    logError("cron.bexio-budget-sync", err);
    await admin.from("budget_access_log").insert({
      user_id: null,
      action: "sync_failed",
      details: { message: msg },
    });
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
