import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

// POST /api/sessions/heartbeat
//
// Wird vom Client beim App-Mount und periodisch (alle 5 min) gerufen, solange
// der User aktiv ist. Entweder updated den last_seen_at der laufenden
// Session, oder startet eine neue wenn die alte zu lange still war (>10 min).
//
// Logik:
//   1. Suche aktive Session (ended_at IS NULL) fuer den User
//   2. Wenn vorhanden + last_seen_at < 10 min alt -> update last_seen_at
//   3. Wenn vorhanden aber stale (>10 min) -> markiere als 'expired',
//      starte neue Session
//   4. Wenn keine -> starte neue Session
//
// Returnt nur { success: true } — der Client braucht die Session-ID nicht.
//
// Permission: nur eingeloggter User. RLS sorgt dafuer dass jeder nur
// seine eigenen Sessions schreiben/updaten kann.

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Nicht authentifiziert" }, { status: 401 });
  }

  // Aktiv-Check: wenn der User waehrend einer Session deaktiviert wurde,
  // sofort den Client signalisieren dass er ausgeloggt werden soll. Der
  // Client (layout.tsx) reagiert mit signOut + redirect zu /login?reason=
  // deactivated. So wirft das Deaktivieren den User innerhalb der naechsten
  // Heartbeat-Periode (max 5 min) raus, ohne dass er weiter editieren kann.
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (profile && profile.is_active === false) {
    return NextResponse.json(
      { success: false, error: "deactivated" },
      { status: 403 },
    );
  }

  const userAgent = request.headers.get("user-agent") ?? null;
  const now = Date.now();

  try {
    // 1. Aktive Session suchen
    const { data: active } = await supabase
      .from("user_sessions")
      .select("id, last_seen_at")
      .eq("user_id", user.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (active) {
      const lastSeen = new Date(active.last_seen_at).getTime();
      if (now - lastSeen <= STALE_THRESHOLD_MS) {
        // 2. Frische Session -> nur last_seen_at updaten
        await supabase
          .from("user_sessions")
          .update({ last_seen_at: new Date(now).toISOString() })
          .eq("id", active.id);
        return NextResponse.json({ success: true });
      }
      // 3. Stale -> als 'expired' markieren, neue Session anlegen
      await supabase
        .from("user_sessions")
        .update({
          ended_at: new Date(lastSeen + 60 * 1000).toISOString(),
          end_reason: "expired",
        })
        .eq("id", active.id);
    }

    // 4. Neue Session anlegen
    const { error: insertErr } = await supabase
      .from("user_sessions")
      .insert({
        user_id: user.id,
        user_agent: userAgent ? userAgent.slice(0, 500) : null,
      });
    if (insertErr) {
      logError("api.sessions.heartbeat.insert", insertErr, { userId: user.id });
      return NextResponse.json({ success: false, error: "Session-Anlage fehlgeschlagen" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    logError("api.sessions.heartbeat.exception", e, { userId: user.id });
    return NextResponse.json({ success: false, error: "Interner Fehler" }, { status: 500 });
  }
}
