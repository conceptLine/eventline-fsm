// POST /api/admin/partner-users — Partner-User anlegen.
// Wie /api/admin/users, aber:
//   - Rolle fix 'partner'
//   - partner_location_id ist Pflicht
//   - Reset-Mail geht an /partner/login statt /login
//
// Setup-Mail nutzt den gleichen Helper wie /api/admin/users.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api-auth";
import { logError } from "@/lib/log";
import { createAuthUser, sendSetupMail } from "@/app/api/admin/users/route";

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server-Konfiguration unvollstaendig" }, { status: 500 });
    }

    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ success: false, error: "Ungueltiger Body" }, { status: 400 });

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const full_name = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const partner_location_id = typeof body.partner_location_id === "string" ? body.partner_location_id : "";

    if (!email || !full_name) {
      return NextResponse.json({ success: false, error: "Email und Name sind Pflicht" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: "Ungueltige Email-Adresse" }, { status: 400 });
    }
    if (!partner_location_id) {
      return NextResponse.json({ success: false, error: "Location ist Pflicht" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Location muss existieren
    const { data: loc } = await admin
      .from("locations")
      .select("id, name")
      .eq("id", partner_location_id)
      .maybeSingle();
    if (!loc) {
      return NextResponse.json({ success: false, error: "Location nicht gefunden" }, { status: 400 });
    }

    // Pre-Check Email
    const { data: existing } = await admin
      .from("profiles")
      .select("id, email, is_active")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { success: false, error: `Es gibt bereits einen Benutzer mit Email ${email}` },
        { status: 400 },
      );
    }

    const created = await createAuthUser({ supabaseUrl, serviceKey, email, fullName: full_name, role: "partner" });
    if (!created.success) {
      return NextResponse.json({ success: false, error: created.error }, { status: 400 });
    }

    // partner_location_id setzen (Trigger weiss nichts davon)
    const { error: locUpdateErr } = await admin
      .from("profiles")
      .update({ partner_location_id })
      .eq("id", created.userId);
    if (locUpdateErr) {
      logError("admin.partner-users.location-update", locUpdateErr, { userId: created.userId });
      return NextResponse.json({ success: false, error: "Location konnte nicht zugewiesen werden" }, { status: 500 });
    }

    // Setup-Mail wie bei /api/admin/users (Reset-Link mit Eventline-Branding).
    // Setup-Mail nutzt denselben /passwort-reset-Flow — Partner setzt sein
    // Passwort dort und loggt sich danach auf /partner/login ein.
    await sendSetupMail({ supabaseUrl, serviceKey, email, fullName: full_name });

    return NextResponse.json({ success: true, userId: created.userId });
  } catch (e) {
    logError("admin.partner-users.exception", e);
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Interner Fehler" }, { status: 500 });
  }
}
