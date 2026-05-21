// POST /api/bexio/feature-toggle
//
// Body: { feature: "contacts" | "accounting", enabled: boolean }
//
// Schaltet einzelne Bexio-Module an/aus. WICHTIG:
//  • Anschalten von feature_accounting funktioniert NUR wenn der OAuth-Token
//    den 'accounting'-Scope hat — sonst wuerde der Cron sofort auf 403 laufen.
//    Wir lesen scope aus bexio_connection und blocken sonst.
//  • Ausschalten ist immer erlaubt — Cron skipped dann, lokaler Snapshot
//    bleibt erhalten (kann via separatem Endpoint geloescht werden).
//
// Audit: Toggle-Aktionen werden in budget_access_log mitgeschrieben.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api-auth";
import { ACCOUNTING_SCOPE } from "@/lib/bexio";

type Feature = "contacts" | "accounting";

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: "Ungueltiger Body" }, { status: 400 });

  const feature = body.feature as Feature;
  const enabled = !!body.enabled;
  if (feature !== "contacts" && feature !== "accounting") {
    return NextResponse.json({ success: false, error: "Ungueltiges Feature" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: conn, error: connErr } = await admin
    .from("bexio_connection")
    .select("scope, feature_contacts, feature_accounting")
    .eq("id", 1)
    .maybeSingle();
  if (connErr) return NextResponse.json({ success: false, error: connErr.message }, { status: 500 });
  if (!conn) {
    return NextResponse.json({ success: false, error: "Bexio ist nicht verbunden" }, { status: 400 });
  }

  // Beim Aktivieren von accounting: pruefen ob der Token den Scope hat.
  if (feature === "accounting" && enabled) {
    const grantedScopes = (conn.scope ?? "").split(/\s+/);
    if (!grantedScopes.includes(ACCOUNTING_SCOPE)) {
      return NextResponse.json(
        {
          success: false,
          error: "Bexio-Token hat keinen accounting-Scope. Bitte zuerst 'Budget-Modul aktivieren' im Bexio-Tab (loest Re-Auth aus).",
          requiresReauth: true,
        },
        { status: 400 },
      );
    }
  }

  const column = feature === "contacts" ? "feature_contacts" : "feature_accounting";
  const { error: updErr } = await admin
    .from("bexio_connection")
    .update({ [column]: enabled, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (updErr) return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });

  // Audit-Log
  await admin.from("budget_access_log").insert({
    user_id: auth.user.id,
    action: enabled ? "feature_enabled" : "feature_disabled",
    details: { feature },
  });

  return NextResponse.json({ success: true });
}
