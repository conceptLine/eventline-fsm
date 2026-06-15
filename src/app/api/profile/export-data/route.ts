// GET /api/profile/export-data — eigene Daten als JSON downloaden.
//
// Erfuellt das Auskunftsrecht aus revDSG / DSGVO als Self-Service-Export.
// Sammelt alles was wir zu auth.uid() in der DB haben (RLS-konform, daher
// User-Client statt Admin-Client — der User sieht nur was er ohnehin
// sehen darf).
//
// Output: application/json, mit content-disposition attachment.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api-auth";
import { logError } from "@/lib/log";
import { todayLocalIso } from "@/lib/swiss-time";

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const supabase = await createClient();
  const userId = auth.user.id;

  try {
    // RLS regelt was der User sehen darf — fuer Partner sind das ihre
    // eigenen Anfragen, fuer Eventline-Mitarbeitende ihre time_entries +
    // Profil. Beide kriegen IMMER ihr eigenes Profil. active_sessions
    // ist optional — wenn die Tabelle nicht existiert oder RLS blockt,
    // ignorieren wir den Fehler.
    const [profileRes, timeEntriesRes, jobsRes, ticketsRes, timeOffRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("time_entries").select("*").eq("user_id", userId),
      supabase.from("jobs").select("id, job_number, title, status, start_date, end_date, created_at").eq("created_by", userId),
      supabase.from("tickets").select("id, ticket_number, type, title, description, status, data, created_at, resolved_at, resolution_note").eq("created_by", userId),
      supabase.from("time_off").select("*").eq("user_id", userId),
    ]);
    const sessionsRes = await supabase
      .from("active_sessions")
      .select("session_id, started_at, last_seen_at, user_agent")
      .eq("user_id", userId);

    const exported = {
      schema_version: 1,
      exported_at: new Date().toISOString(),
      hinweis: "Dieser Export enthaelt alle personenbezogenen Daten die zu deinem Account in der EVENTLINE-FSM-Datenbank gespeichert sind. Aufbewahrungsfristen siehe Datenschutzerklaerung.",
      profile: profileRes.data ?? null,
      time_entries: timeEntriesRes.data ?? [],
      jobs_created_by_me: jobsRes.data ?? [],
      tickets_created_by_me: ticketsRes.data ?? [],
      time_off: timeOffRes.data ?? [],
      active_sessions: sessionsRes.error ? [] : (sessionsRes.data ?? []),
    };

    const body = JSON.stringify(exported, null, 2);
    const filename = `eventline-meine-daten-${todayLocalIso()}.json`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logError("api.profile.export-data", err, { userId });
    return NextResponse.json({ success: false, error: "Export fehlgeschlagen" }, { status: 500 });
  }
}
