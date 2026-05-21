// GET /api/trust/status
//
// Liefert dem Client ob das aktuelle Geraet vertraut ist. UI rendert
// damit den Trust-Gate (Prompt statt sensiblen Daten).
//
// Antwort: { trusted: boolean, pending: boolean, deviceName?: string }
//   • trusted=true  → Cookie matched eine approved-Zeile → freier Zugang
//   • pending=true  → Cookie matched eine pending-Zeile → "wartet auf Approval"
//   • beides false  → kein/ungueltiges Cookie → Trust-Prompt anzeigen

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, hashToken, TRUSTED_DEVICE_COOKIE } from "@/lib/api-auth";

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const cookieStore = await cookies();
  const cookie = cookieStore.get(TRUSTED_DEVICE_COOKIE);

  if (!cookie?.value) {
    return NextResponse.json({ success: true, trusted: false, pending: false });
  }

  const admin = createAdminClient();
  const tokenHash = hashToken(cookie.value);
  const { data: row } = await admin
    .from("trusted_devices")
    .select("status, device_name, expires_at, revoked_at")
    .eq("cookie_token_hash", tokenHash)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (!row || row.revoked_at) {
    return NextResponse.json({ success: true, trusted: false, pending: false });
  }
  if (row.status === "approved") {
    const expired = row.expires_at && new Date(row.expires_at) < new Date();
    return NextResponse.json({ success: true, trusted: !expired, pending: false, deviceName: row.device_name });
  }
  if (row.status === "pending") {
    return NextResponse.json({ success: true, trusted: false, pending: true, deviceName: row.device_name });
  }
  return NextResponse.json({ success: true, trusted: false, pending: false });
}
