/**
 * POST /api/notifications/subscribe — speichert eine PushSubscription
 * fuer den aktuellen User. Idempotent: bei gleicher endpoint-URL wird
 * nur das last_used_at hochgezogen, kein neuer Eintrag.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
    return NextResponse.json({ success: false, error: "Invalid subscription payload" }, { status: 400 });
  }

  const ua = request.headers.get("user-agent") ?? null;

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({
      user_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      user_agent: ua,
      last_used_at: new Date().toISOString(),
    }, { onConflict: "user_id,endpoint" });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
