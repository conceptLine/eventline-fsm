/**
 * Notification-Wake-Snoozed — laeuft alle 5 Min via Vercel Cron.
 *
 * Notifications mit snoozed_until < now() werden:
 *   - snoozed_until = null
 *   - is_read = false (auch wenn vorher gelesen war — Snooze impliziert
 *     'will spaeter wiedersehen')
 *   - created_at hochgezogen damit sie in der Glocke wieder oben sind
 *
 * Bearer CRON_SECRET Auth wie andere Crons.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET fehlt" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { error, count } = await supabase
    .from("notifications")
    .update({ snoozed_until: null, is_read: false, created_at: now }, { count: "exact" })
    .lt("snoozed_until", now)
    .not("snoozed_until", "is", null);
  if (error) {
    logError("cron.notification-wake-snoozed", error);
    return NextResponse.json({ error: "Update fehlgeschlagen" }, { status: 500 });
  }
  return NextResponse.json({ success: true, woken: count ?? 0 });
}
