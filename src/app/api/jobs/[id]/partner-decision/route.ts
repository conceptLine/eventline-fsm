import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/api-auth";
import { logError } from "@/lib/log";
import { appUrl } from "@/lib/app-url";
import { Resend } from "resend";

// POST /api/jobs/[id]/partner-decision
// Body: { decision: "accept" | "reject", message?: string }
//
// Admin-Aktion: Partner-Anfrage annehmen (-> status='offen') oder ablehnen
// (-> status='storniert' + partner_response_message als Grund).
// Audit-Trail: accepted_by/at oder rejected_by/at gesetzt.
//
// Permission: auftraege:edit (Admin/Lead haben das per Default).
//
// Benachrichtigung: E-Mail an den Partner-Ersteller (jobs.created_by →
// profiles.email). Das Partner-Portal hat keine NotificationsBell, also
// macht eine In-App-Notification dort keinen Sinn — Mail ist der
// natuerliche Touchpoint.

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

  // Auch den Ersteller-Profil-Datensatz (email + full_name) gleich
  // mitziehen damit wir die Decision-Mail ohne zweiten Round-Trip
  // versenden koennen.
  const { data: existing } = await admin
    .from("jobs")
    .select("id, status, created_by, title, start_date, end_date, creator:profiles!created_by(full_name, email)")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ success: false, error: "Anfrage nicht gefunden" }, { status: 404 });
  }
  if (existing.status !== "partner_anfrage") {
    return NextResponse.json({ success: false, error: "Anfrage ist nicht mehr im Status 'partner_anfrage'" }, { status: 400 });
  }

  const now = new Date().toISOString();
  type CreatorRel = { full_name: string; email: string | null } | { full_name: string; email: string | null }[] | null;
  const creatorRel = (existing as { creator?: CreatorRel }).creator;
  const creator = Array.isArray(creatorRel) ? creatorRel[0] ?? null : creatorRel;

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
    await sendDecisionEmail({
      decision: "accept",
      jobTitle: existing.title,
      jobStart: existing.start_date,
      jobEnd: existing.end_date,
      message: message || null,
      creatorEmail: creator?.email ?? null,
      creatorName: creator?.full_name ?? null,
      jobId: id,
    });
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
  await sendDecisionEmail({
    decision: "reject",
    jobTitle: existing.title,
    jobStart: existing.start_date,
    jobEnd: existing.end_date,
    message,
    creatorEmail: creator?.email ?? null,
    creatorName: creator?.full_name ?? null,
    jobId: id,
  });
  return NextResponse.json({ success: true });
}

interface DecisionEmailParams {
  decision: "accept" | "reject";
  jobTitle: string;
  jobStart: string | null;
  jobEnd: string | null;
  message: string | null;
  creatorEmail: string | null;
  creatorName: string | null;
  jobId: string;
}

// Best-effort Mail-Versand — schluckt eigene Errors damit die API-
// Antwort an EVENTLINE-Admin auch ohne Mail-Versand success=true bleibt
// (Statusupdate ist die wichtige Aktion; Mail ist Nebeneffekt).
async function sendDecisionEmail(p: DecisionEmailParams) {
  if (!p.creatorEmail) {
    logError("api.jobs.partner-decision.email.skip", "creator hat keine email", { jobId: p.jobId });
    return;
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    logError("api.jobs.partner-decision.email.skip", "kein RESEND_API_KEY", { jobId: p.jobId });
    return;
  }
  const link = appUrl(`/partner/anfragen/${p.jobId}`);
  const dateText = p.jobStart
    ? new Date(p.jobStart).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })
        + (p.jobEnd && p.jobEnd !== p.jobStart
            ? " – " + new Date(p.jobEnd).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })
            : "")
    : "";

  const isAccept = p.decision === "accept";
  const subject = isAccept
    ? `Anfrage bestätigt: ${p.jobTitle}`
    : `Anfrage abgelehnt: ${p.jobTitle}`;
  const headlineColor = isAccept ? "#00a86b" : "#dc2626";
  const headlineText = isAccept ? "Anfrage bestätigt" : "Anfrage abgelehnt";
  const intro = isAccept
    ? "EVENTLINE hat deine Anfrage angenommen und kümmert sich um die Umsetzung."
    : "EVENTLINE hat deine Anfrage leider abgelehnt.";
  const greeting = p.creatorName ? `Hallo ${p.creatorName},` : "Hallo,";

  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f5f5f7; padding:24px; margin:0;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; padding:32px; border:1px solid #e5e7eb;">
    <p style="font-size:11px; font-weight:600; letter-spacing:1px; text-transform:uppercase; color:${headlineColor}; margin:0 0 4px;">EVENTLINE Partner-Portal</p>
    <h1 style="margin:0 0 16px; font-size:22px; color:${headlineColor};">${headlineText}</h1>
    <p style="margin:0 0 12px; color:#111827;">${greeting}</p>
    <p style="margin:0 0 16px; color:#374151;">${intro}</p>
    <div style="background:#f9fafb; border-radius:8px; padding:16px; margin-bottom:16px;">
      <p style="margin:0 0 4px; font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px;">Anfrage</p>
      <p style="margin:0; font-weight:600; color:#111827;">${escapeHtml(p.jobTitle)}</p>
      ${dateText ? `<p style="margin:8px 0 0; font-size:13px; color:#6b7280;">${dateText}</p>` : ""}
    </div>
    ${p.message ? `
    <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:16px; margin-bottom:16px;">
      <p style="margin:0 0 4px; font-size:11px; color:#92400e; text-transform:uppercase; letter-spacing:0.5px;">${isAccept ? "Mitteilung" : "Grund"}</p>
      <p style="margin:0; color:#111827; white-space:pre-wrap;">${escapeHtml(p.message)}</p>
    </div>` : ""}
    <a href="${link}" style="display:inline-block; padding:10px 18px; background:#111827; color:#ffffff; text-decoration:none; border-radius:8px; font-weight:600;">Anfrage im Portal öffnen</a>
    <p style="margin:24px 0 0; font-size:11px; color:#9ca3af;">Diese Mail wurde automatisch versendet. Antworten an noreply@eventline-basel.com werden nicht gelesen.</p>
  </div>
</body></html>`;

  try {
    const resend = new Resend(resendKey);
    await resend.emails.send({
      from: "EVENTLINE GmbH <noreply@eventline-basel.com>",
      to: p.creatorEmail,
      subject,
      html,
    });
  } catch (e) {
    logError("api.jobs.partner-decision.email.send", e, { jobId: p.jobId, to: p.creatorEmail });
  }
}

// Simple HTML-Escape für die paar User-Strings im Template — verhindert
// dass ein Title oder Message das Layout sprengt / XSS-Injektion im Mail-
// Body landet.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
