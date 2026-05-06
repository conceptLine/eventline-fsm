import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { logError } from "@/lib/log";

/**
 * Refresh der materialized views fuer Dashboard/Operations-Counts.
 * Vercel-Cron triggert /1 Minute (siehe vercel.json) — die Counts sind
 * dann maximal ~60s alt, was fuer Operations-Übersichten egal ist und
 * die DB massiv entlastet bei groesseren Datenmengen.
 *
 * Refresh-Funktion ist SECURITY DEFINER und auf service_role gegrantet
 * (Migration 087).
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET fehlt" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("refresh_dashboard_counts");
  if (error) {
    logError("cron.refresh-counts", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
