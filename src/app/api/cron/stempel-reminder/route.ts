/**
 * Stempel-Reminder — laeuft alle 30 Minuten via Vercel Cron.
 *
 * Logik: fuer jeden offenen time_entry (clock_out IS NULL) der mit einem
 * Auftrag verknuepft ist, schaut wann der LETZTE job_appointment auf
 * diesem Auftrag zu Ende war. Wenn der Termin schon mehr als 2h vorbei
 * ist und wir noch nicht erinnert haben → in-app Notification.
 *
 * Der Cut-off von 2h ist Leo's Vorgabe — nicht starr 18:00, sondern
 * "termingebunden": wer um 14h einen Termin bis 16h hat, kriegt um 18h
 * den Reminder. Wer nachts arbeitet, kriegt den Reminder nachts.
 *
 * Performance: alles via Single-RPC `get_stempel_reminder_candidates(cutoff)`
 * + Bulk-INSERT. Vorher N+1 (3 Queries pro offenem Stempel) → bei 100 MA
 * mit 50 offenen Stempeln × 48 Runs/Tag waeren das 21k+ Queries; jetzt
 * 2 Queries pro Run, scaling-stabil.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { logError } from "@/lib/log";
import { notifyStempelReminderPerEntry } from "@/lib/notification-service";

export const dynamic = "force-dynamic";

interface ReminderCandidate {
  entry_id: string;
  user_id: string;
  job_id: string;
  latest_end: string;
  job_number: number | null;
  job_title: string | null;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET fehlt in der Server-Config" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  // Single-Query-RPC: liefert nur die Kandidaten die wirklich erinnert
  // werden muessen — Termin-Ende > 2h vorbei UND noch kein Reminder gesetzt.
  const { data, error } = await supabase.rpc("get_stempel_reminder_candidates", { cutoff });
  if (error) {
    logError("cron.stempel-reminder.rpc", error);
    return NextResponse.json({ error: "RPC fehlgeschlagen" }, { status: 500 });
  }

  const candidates = (data ?? []) as ReminderCandidate[];
  if (candidates.length === 0) {
    return NextResponse.json({ success: true, sent: 0 });
  }

  // Pro Kandidat ein notify-Call — der Service holt User-Settings und
  // filtert Empfaenger raus die stempel_reminder.in_app=false haben.
  // Parallel ausfuehren damit der Cron schnell bleibt.
  await Promise.all(candidates.map((c) => {
    const jobLabel = c.job_number ? `INT-${c.job_number}` : (c.job_title ?? "Auftrag");
    return notifyStempelReminderPerEntry(supabase, {
      userId: c.user_id,
      entryId: c.entry_id,
      jobLabel,
      endIso: c.latest_end,
    });
  }));

  return NextResponse.json({ success: true, sent: candidates.length });
}
