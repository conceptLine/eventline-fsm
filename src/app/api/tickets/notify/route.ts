// POST /api/tickets/notify — In-App-Notification fuer Ticket-Events.
// Events:
//   "created"          → an alle Admins (neues Ticket vom Mitarbeiter)
//   "status_changed"   → an Ersteller (Admin hat erledigt/abgelehnt)
//
// Notifications gehen via zentralem NotificationService, der die
// per-User-Settings (user_notification_settings.channels) respektiert.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api-auth";
import {
  notifyTicketNew,
  notifyTicketDone,
  notifyTicketRejected,
} from "@/lib/notification-service";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body?.ticket_id || !body?.event) {
    return NextResponse.json({ success: false, error: "ticket_id + event noetig" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: ticket } = await admin
    .from("tickets")
    .select("id, type, status, title, ticket_number, created_by, creator:profiles!created_by(full_name)")
    .eq("id", body.ticket_id)
    .maybeSingle();

  if (!ticket) {
    return NextResponse.json({ success: false, error: "Ticket nicht gefunden" }, { status: 404 });
  }

  type TicketRow = {
    id: string;
    type: string;
    status: string;
    title: string;
    ticket_number: number;
    created_by: string;
    creator: { full_name: string } | { full_name: string }[] | null;
  };
  const t = ticket as unknown as TicketRow;
  const creatorName = Array.isArray(t.creator) ? t.creator[0]?.full_name : t.creator?.full_name;

  if (body.event === "created") {
    const { data: admins } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "admin")
      .eq("is_active", true);
    const adminIds = (admins ?? []).map((a) => a.id).filter((id) => id !== t.created_by);

    await notifyTicketNew(admin, {
      recipients: adminIds,
      ticketId: t.id,
      ticketNumber: t.ticket_number,
      ticketTitle: t.title,
      ticketType: t.type,
      byName: creatorName ?? "Unbekannt",
    });
    return NextResponse.json({ success: true, sent: adminIds.length });
  }

  if (body.event === "status_changed") {
    const byName = (typeof body.by_name === "string" && body.by_name.trim()) ? body.by_name.trim() : "Admin";
    if (t.status === "abgelehnt") {
      await notifyTicketRejected(admin, {
        recipients: [t.created_by],
        ticketId: t.id,
        ticketNumber: t.ticket_number,
        ticketTitle: t.title,
        reason: (typeof body.note === "string" && body.note.trim()) ? body.note.trim() : "Kein Grund angegeben",
        byName,
      });
    } else {
      await notifyTicketDone(admin, {
        recipients: [t.created_by],
        ticketId: t.id,
        ticketNumber: t.ticket_number,
        ticketTitle: t.title,
        byName,
      });
    }
    return NextResponse.json({ success: true, sent: 1 });
  }

  return NextResponse.json({ success: false, error: `Unbekanntes event: ${body.event}` }, { status: 400 });
}
