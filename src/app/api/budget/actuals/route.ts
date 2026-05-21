// GET /api/budget/actuals?year=2026
//
// Liefert das Ist (aus budget_account_snapshot) pro budget_category.
// Da jede Kategorie jetzt eine bexio_account_no direkt hat (Single-Source-of-Truth
// vom Bexio-Sync), brauchen wir keine extra Mapping-Tabelle mehr — wir
// joinen einfach budget_categories ⨝ budget_account_snapshot auf account_no.
//
// Eltern-Gruppen (z.B. "Personalaufwand (5xxx)") haben selbst keine
// bexio_account_no — ihre Summe entsteht client-side via nodeIst() aus den
// Children. Hier liefern wir nur die Leaf-Werte aus.
//
// Permission: budget:view-actuals (sensitives Aggregat) + trusted device.
// Audit-Log-Eintrag pro Call.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrustedDevice } from "@/lib/api-auth";

export async function GET(request: Request) {
  const auth = await requireTrustedDevice("budget:view-actuals");
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const yearRaw = url.searchParams.get("year");
  const year = yearRaw ? parseInt(yearRaw, 10) : new Date().getFullYear();
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ success: false, error: "Ungueltiges Jahr" }, { status: 400 });
  }

  const admin = createAdminClient();

  const [catsRes, snapshotsRes, syncMetaRes] = await Promise.all([
    admin
      .from("budget_categories")
      .select("id, bexio_account_no")
      .not("bexio_account_no", "is", null)
      .is("archived_at", null),
    admin
      .from("budget_account_snapshot")
      .select("bexio_account_no, sum_chf, last_synced_at")
      .eq("fiscal_year", year),
    admin
      .from("budget_access_log")
      .select("created_at")
      .eq("action", "sync_completed")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (catsRes.error) return NextResponse.json({ success: false, error: catsRes.error.message }, { status: 500 });
  if (snapshotsRes.error) return NextResponse.json({ success: false, error: snapshotsRes.error.message }, { status: 500 });

  // Snapshot-Summen pro Konto (Jahres-Total aus allen Monats-Zeilen).
  const sumByAccount = new Map<string, number>();
  let mostRecentSnapshotAt: string | null = null;
  for (const snap of snapshotsRes.data ?? []) {
    const key = snap.bexio_account_no as string;
    sumByAccount.set(key, (sumByAccount.get(key) ?? 0) + Number(snap.sum_chf));
    const sa = snap.last_synced_at as string | null;
    if (sa && (!mostRecentSnapshotAt || sa > mostRecentSnapshotAt)) {
      mostRecentSnapshotAt = sa;
    }
  }

  // Pro Kategorie den Wert eintragen.
  const byCategoryId: Record<string, { ist_chf: number; account_no: string }> = {};
  for (const cat of catsRes.data ?? []) {
    const accountNo = cat.bexio_account_no as string;
    byCategoryId[cat.id as string] = {
      ist_chf: sumByAccount.get(accountNo) ?? 0,
      account_no: accountNo,
    };
  }

  // Audit-Log (best-effort).
  await admin
    .from("budget_access_log")
    .insert({ user_id: auth.user.id, action: "view_ist", details: { year } });

  const lastSyncedAt = syncMetaRes.data?.[0]?.created_at ?? mostRecentSnapshotAt;

  return NextResponse.json({
    success: true,
    year,
    byCategoryId,
    lastSyncedAt,
  });
}
