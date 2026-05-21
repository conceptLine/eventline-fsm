// GET /api/trust/confirm?token=...
//
// Zielseite des Bestaetigungs-Links aus der Admin-Mailbox. Wir hashen den
// Token, finden die zugehoerige pending-Zeile, markieren sie als approved
// und leiten auf eine Bestaetigungs-Seite weiter. Single-Use — confirm_token
// wird nach dem Approve auf NULL gesetzt.
//
// KEINE Auth-Pruefung — der Token IST die Authentifizierung (wer auch
// immer ihn aus der Admin-Mailbox holt). Daher 256-Bit-Random.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return redirectToResult(request, "missing");
  }

  const tokenHash = hashToken(token);
  const admin = createAdminClient();

  // Pending-Zeile mit diesem Confirm-Hash finden.
  const { data: row, error } = await admin
    .from("trusted_devices")
    .select("id, user_id, device_name, status, expires_at")
    .eq("confirm_token_hash", tokenHash)
    .maybeSingle();

  if (error || !row) {
    return redirectToResult(request, "invalid");
  }

  if (row.status === "approved") {
    return redirectToResult(request, "already", row.device_name);
  }

  if (row.status === "revoked") {
    return redirectToResult(request, "revoked", row.device_name);
  }

  // Profil + Email des klickenden Users (= idR admin@eventline-basel.com via
  // Cookie nicht verfuegbar, da Email-Link aus dem Browser ohne Auth-Session
  // geklickt werden kann). Wir loggen nur generischen Wert.
  const approvedBy = "admin-mailbox";

  const { error: updErr } = await admin
    .from("trusted_devices")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by_email: approvedBy,
      // Token verbrennen — kein zweites Approve moeglich.
      confirm_token_hash: null,
    })
    .eq("id", row.id);

  if (updErr) {
    return redirectToResult(request, "error");
  }

  return redirectToResult(request, "ok", row.device_name);
}

function redirectToResult(request: NextRequest, status: string, deviceName?: string) {
  const url = new URL("/trust/result", request.url);
  url.searchParams.set("status", status);
  if (deviceName) url.searchParams.set("device", deviceName);
  return NextResponse.redirect(url, { status: 302 });
}
