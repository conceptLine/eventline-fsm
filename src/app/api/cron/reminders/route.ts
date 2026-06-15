import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { logError } from "@/lib/log";
import { localDateIso } from "@/lib/swiss-time";

export async function GET(request: Request) {
  // Cron-Secret HARD-PFLICHT — wenn die ENV-Var fehlt, ist der Endpoint
  // sonst oeffentlich (jeder kann Reminders-Mails an alle Mitarbeiter
  // triggern). Vercel-Cron schickt den Header automatisch; ohne Secret
  // gibts auch lokal keinen Bypass mehr (vorher pruefte er auf
  // VERCEL_URL.includes("localhost") was auf Vercel nie greift, also
  // toter Code, und ohne CRON_SECRET liess er einfach durch).
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET fehlt in der Server-Config" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Notifications-Cleanup: alles aelter als 90 Tage wird geloescht damit
  // die Tabelle bei mehrjaehriger Nutzung nicht ungebremst waechst (vor
  // allem die Stempel-Reminder-Notifications die alle 30min entstehen).
  //
  // Batched in 5000er-Chunks: ein einziges DELETE auf 100k+ Zeilen kann
  // das pg_replication-WAL ueberlaufen lassen oder Locks fuer mehrere
  // Sekunden halten. Loop mit early-exit wenn weniger als BATCH_SIZE
  // geloescht wurden (= keine weiteren Kandidaten mehr).
  const cleanupCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const BATCH_SIZE = 5000;
  let deletedNotifications = 0;
  for (let i = 0; i < 200; i++) { // safety-cap: max 1M rows pro Cron-Run
    const { data: batch } = await supabase
      .from("notifications")
      .select("id")
      .lt("created_at", cleanupCutoff)
      .limit(BATCH_SIZE);
    if (!batch || batch.length === 0) break;
    const ids = batch.map((r) => r.id);
    const { count } = await supabase
      .from("notifications")
      .delete({ count: "exact" })
      .in("id", ids);
    deletedNotifications += count ?? 0;
    if (batch.length < BATCH_SIZE) break;
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({
      success: true,
      message: "Kein RESEND_API_KEY — nur Cleanup gemacht",
      cleanup: deletedNotifications ?? 0,
    });
  }

  const resend = new Resend(resendKey);

  // Morgen im Europe/Zurich-Kalender — Cron laeuft UTC, ohne Konvert
  // wuerde "morgen" zwischen 22:00-00:00 UTC schon der uebernaechste
  // ZRH-Tag sein.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowStr = localDateIso(tomorrow);

  // Todos finden die morgen fällig sind, noch offen, und jemandem zugewiesen
  const { data: todos } = await supabase
    .from("todos")
    .select("*, assignee:profiles!assigned_to(full_name, email)")
    .eq("status", "offen")
    .eq("due_date", tomorrowStr)
    .not("assigned_to", "is", null);

  if (!todos || todos.length === 0) {
    return NextResponse.json({ success: true, message: "Keine Erinnerungen zu senden", count: 0, cleanup: deletedNotifications ?? 0 });
  }

  const sent: string[] = [];
  const failed: string[] = [];

  type TodoWithAssignee = typeof todos[number] & {
    assignee: { full_name: string; email: string } | null;
  };
  for (const todo of todos as TodoWithAssignee[]) {
    const assignee = todo.assignee;
    if (!assignee?.email) continue;

    const formattedDate = new Date(todo.due_date + "T12:00:00Z").toLocaleDateString("de-CH", {
      timeZone: "Europe/Zurich", weekday: "long", day: "numeric", month: "long", year: "numeric",
    });

    try {
      await resend.emails.send({
        from: "EVENTLINE FSM <noreply@eventline-basel.com>",
        to: assignee.email,
        subject: `Erinnerung: ${todo.title} – fällig morgen`,
        html: `
          <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto">
            <div style="background:#1a1a1a;padding:20px 24px;border-radius:12px 12px 0 0">
              <h2 style="color:white;margin:0;font-size:16px">EVENTLINE GmbH</h2>
            </div>
            <div style="background:white;padding:24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
              <p style="margin:0 0 12px">Hallo ${assignee.full_name},</p>
              <p style="margin:0 0 16px">Du hast eine Aufgabe die <strong>morgen fällig</strong> ist:</p>
              <div style="background:#f5f5f5;padding:16px;border-radius:8px;border-left:4px solid #ef4444;margin:0 0 16px">
                <p style="margin:0 0 4px;font-weight:600;font-size:16px">${todo.title}</p>
                <p style="margin:0 0 4px;color:#666">Fällig: ${formattedDate}</p>
                ${todo.description ? `<p style="margin:8px 0 0;color:#666;font-size:14px">${todo.description}</p>` : ""}
              </div>
              <p style="margin:0 0 8px;color:#999;font-size:13px">
                Öffne die App um die Aufgabe zu bearbeiten.
              </p>
              <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
              <p style="margin:0;color:#bbb;font-size:11px">EVENTLINE GmbH · St. Jakobs-Strasse 200 · CH-4052 Basel</p>
            </div>
          </div>
        `,
      });
      sent.push(`${assignee.full_name}: ${todo.title}`);
    } catch (e) {
      logError("cron.reminders.mail", e, { recipient: assignee.email, todoId: todo.id });
      failed.push(assignee.email);
    }
  }

  return NextResponse.json({
    success: true,
    count: sent.length,
    sent,
    failed,
    cleanup: deletedNotifications ?? 0,
  });
}
