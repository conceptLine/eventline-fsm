// GET /api/cron/vertrieb-wiedervorlage
//
// Laeuft per Vercel-Cron alle 15 Minuten und prueft welche Vertriebs-
// Leads aktuell faellige Wiedervorlagen haben. Pro fälligem Lead +
// zugewiesenem Mitarbeiter eine Bell-Notification + Push.
//
// Idempotenz: wir setzen nach dem Senden wiedervorlage_snoozed=false
// (egal ob vorher true war) UND speichern den Sende-Zeitpunkt nicht
// separat — stattdessen wird die Notification nur EINMAL pro Reminder
// gesendet, indem wir das wiedervorlage_am-Feld nach dem Senden auf
// NULL setzen. Der Lead bleibt visuell markiert (orange/rot) bis der
// User in der UI 'Erledigt' klickt oder einen neuen Reminder setzt.
//
// Hm — das wuerde aber die Anzeige weg-droppen. Besser:
// dedicated Spalte 'wiedervorlage_notified_at' damit wir wissen ob
// die Notification schon raus ist. So bleibt das Datum sichtbar.
//
// Migration 170 fuegt diese Spalte hinzu.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyVertriebWiedervorlage } from "@/lib/notification-service";
import { logError } from "@/lib/log";

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET fehlt" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // Alle Leads mit aktivem, faelligem Reminder die noch nicht benachrichtigt
  // wurden. Nur assigned Leads — niemand bekommt Pushes fuer Leads die noch
  // im Pool liegen.
  const { data: dueLeads, error } = await admin
    .from("vertrieb_contacts")
    .select("id, nr, firma, assigned_to, wiedervorlage_am, wiedervorlage_note")
    .lte("wiedervorlage_am", nowIso)
    .is("wiedervorlage_notified_at", null)
    .not("assigned_to", "is", null)
    .not("wiedervorlage_am", "is", null);
  if (error) {
    logError("cron.vertrieb-wiedervorlage.select", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  const leads = dueLeads ?? [];
  if (leads.length === 0) {
    return NextResponse.json({ success: true, sent: 0 });
  }

  let sent = 0;
  for (const lead of leads as Array<{
    id: string; nr: number; firma: string; assigned_to: string;
    wiedervorlage_am: string; wiedervorlage_note: string | null;
  }>) {
    try {
      await notifyVertriebWiedervorlage(admin, {
        recipients: [lead.assigned_to],
        leadId: lead.id,
        leadNr: lead.nr,
        firma: lead.firma,
        note: lead.wiedervorlage_note,
      });
      // Notified-Stempel setzen + snoozed auto-aufheben (Lead taucht
      // wieder in der aktiven Liste auf).
      await admin
        .from("vertrieb_contacts")
        .update({ wiedervorlage_notified_at: nowIso, wiedervorlage_snoozed: false })
        .eq("id", lead.id);
      sent++;
    } catch (e) {
      logError("cron.vertrieb-wiedervorlage.deliver", e, { leadId: lead.id });
    }
  }

  return NextResponse.json({ success: true, sent, candidates: leads.length });
}
