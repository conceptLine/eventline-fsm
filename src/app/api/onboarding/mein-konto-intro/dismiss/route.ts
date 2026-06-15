// POST /api/onboarding/mein-konto-intro/dismiss
// User hat das Welcome-Modal weggeklickt — wird kuenftig nicht mehr gezeigt.
// Idempotent: bei erneutem Call passiert nichts.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ mein_konto_intro_dismissed_at: new Date().toISOString() })
    .eq("id", auth.user.id)
    .is("mein_konto_intro_dismissed_at", null);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
