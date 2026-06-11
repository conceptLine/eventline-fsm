/**
 * Notification-Auto-Cleanup — laeuft taeglich um 03:00 via Vercel Cron.
 *
 * Regeln:
 *   - Gelesene Notifications die aelter als 30 Tage sind -> DELETE
 *   - Ungelesene Notifications die aelter als 90 Tage sind -> DELETE
 *     (Sonst sammelt sich Schrott von Usern die ihre Glocke nie oeffnen.)
 *
 * Authorization wie andere Crons: Bearer CRON_SECRET.
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
  const now = Date.now();
  const cutoffRead = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cutoffUnread = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [readRes, unreadRes] = await Promise.all([
    supabase.from("notifications").delete({ count: "exact" })
      .eq("is_read", true).lt("created_at", cutoffRead),
    supabase.from("notifications").delete({ count: "exact" })
      .eq("is_read", false).lt("created_at", cutoffUnread),
  ]);

  if (readRes.error) logError("cron.notification-cleanup.read", readRes.error);
  if (unreadRes.error) logError("cron.notification-cleanup.unread", unreadRes.error);

  return NextResponse.json({
    success: true,
    deleted_read: readRes.count ?? 0,
    deleted_unread: unreadRes.count ?? 0,
  });
}
