// POST /api/onboarding/mein-konto-intro/mark-visited
// Setzt first_visited_at sobald der User die Mein-Konto-Seite oeffnet.
// Damit verschwindet der Sidebar-Badge (= "neu, noch nicht angeschaut").
// Idempotent: kein-op wenn bereits gesetzt.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ mein_konto_first_visited_at: new Date().toISOString() })
    .eq("id", auth.user.id)
    .is("mein_konto_first_visited_at", null);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
