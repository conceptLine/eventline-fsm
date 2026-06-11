/**
 * POST /api/notifications/unsubscribe — entfernt eine PushSubscription
 * fuer den aktuellen User (per endpoint identifiziert).
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.endpoint) {
    return NextResponse.json({ success: false, error: "endpoint required" }, { status: 400 });
  }

  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", body.endpoint);
  return NextResponse.json({ success: true });
}
