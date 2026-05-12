import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/api-auth";
import { logError } from "@/lib/log";

// POST /api/jobs/[id]/partner-decision
// Body: { decision: "accept" | "reject", message?: string }
//
// Admin-Aktion: Partner-Anfrage annehmen (-> status='offen') oder ablehnen
// (-> status='storniert' + partner_response_message als Grund).
// Audit-Trail: accepted_by/at oder rejected_by/at gesetzt.
//
// Permission: auftraege:edit (Admin/Lead haben das per Default).

interface Body {
  decision?: unknown;
  message?: unknown;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("auftraege:edit");
  if (auth.error) return auth.error;
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as Body | null;
  const decision = body?.decision;
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (decision !== "accept" && decision !== "reject") {
    return NextResponse.json({ success: false, error: "decision muss 'accept' oder 'reject' sein" }, { status: 400 });
  }
  if (decision === "reject" && !message) {
    return NextResponse.json({ success: false, error: "Bei Ablehnung ist ein Grund Pflicht" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("jobs")
    .select("id, status, created_by, title")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ success: false, error: "Anfrage nicht gefunden" }, { status: 404 });
  }
  if (existing.status !== "partner_anfrage") {
    return NextResponse.json({ success: false, error: "Anfrage ist nicht mehr im Status 'partner_anfrage'" }, { status: 400 });
  }

  const now = new Date().toISOString();

  if (decision === "accept") {
    const { error } = await admin
      .from("jobs")
      .update({
        status: "offen",
        accepted_by: auth.user.id,
        accepted_at: now,
        partner_response_message: message || null,
      })
      .eq("id", id);
    if (error) {
      logError("api.jobs.partner-decision.accept", error, { jobId: id });
      return NextResponse.json({ success: false, error: "Annahme fehlgeschlagen" }, { status: 500 });
    }
    // Notification an den Partner-Ersteller
    if (existing.created_by) {
      await admin.from("notifications").insert({
        user_id: existing.created_by,
        title: `Anfrage angenommen: ${existing.title}`,
        message: message || "Eventline kümmert sich.",
        link: `/partner/anfragen/${id}`,
      });
    }
    return NextResponse.json({ success: true });
  }

  // reject
  const { error } = await admin
    .from("jobs")
    .update({
      status: "storniert",
      rejected_by: auth.user.id,
      rejected_at: now,
      cancelled_at: now,
      cancelled_by: auth.user.id,
      cancellation_reason: message,
      partner_response_message: message,
    })
    .eq("id", id);
  if (error) {
    logError("api.jobs.partner-decision.reject", error, { jobId: id });
    return NextResponse.json({ success: false, error: "Ablehnung fehlgeschlagen" }, { status: 500 });
  }
  if (existing.created_by) {
    await admin.from("notifications").insert({
      user_id: existing.created_by,
      title: `Anfrage abgelehnt: ${existing.title}`,
      message,
      link: `/partner/anfragen/${id}`,
    });
  }
  return NextResponse.json({ success: true });
}
