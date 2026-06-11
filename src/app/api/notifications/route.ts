import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api-auth";
import { notifySystem } from "@/lib/notification-service";

// POST: Notification fuer einen oder mehrere User anlegen.
//
// Admin-only: Phishing-Schutz. Nur Admins koennen via dieser Route
// In-App-Notifications mit beliebigem Title/Link an User schicken.
//
// Geht durch den NotificationService — damit werden auch hier
// user_notification_settings.channels respektiert (User der den
// 'system'-Typ ausgeschaltet hat bekommt keine).
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { userIds, title, message, link } = await request.json();

  if (!userIds || !title) {
    return NextResponse.json({ success: false, error: "userIds und title sind erforderlich" }, { status: 400 });
  }

  const ids = Array.isArray(userIds) ? userIds : [userIds];
  await notifySystem(createAdminClient(), {
    recipients: ids,
    title,
    message: message || null,
    link: link || null,
  });

  return NextResponse.json({ success: true });
}
