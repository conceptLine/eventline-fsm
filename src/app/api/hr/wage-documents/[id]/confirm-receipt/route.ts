// POST /api/hr/wage-documents/[id]/confirm-receipt
// Mitarbeiter bestaetigt Empfang seines Lohnausweises (Nachweis fuer
// digitale Aushaendigung). Idempotent — wenn schon bestaetigt, gibts
// einfach success zurueck mit dem bestehenden Timestamp.
//
// Nur Lohnausweise (doc_type='lohnausweis') sind bestaetigungspflichtig;
// fuer Lohnabrechnungen lehnen wir ab um die UX-Erwartung sauber zu
// halten ("Empfangsbestaetigung" ist ein Lohnausweis-Konzept).
//
// Ownership-Check in Code (nicht via RLS-User-Update-Policy) damit wir
// genau eine Spalte bewusst setzen koennen und kein Risiko eines
// versehentlich weiter-updaten anderer Felder besteht.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { id } = await params;

  const admin = createAdminClient();
  const { data: doc, error: readErr } = await admin
    .from("wage_documents")
    .select("id, profile_id, doc_type, received_confirmed_at")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ success: false, error: readErr.message }, { status: 500 });
  if (!doc) return NextResponse.json({ success: false, error: "Nicht gefunden" }, { status: 404 });
  if (doc.profile_id !== auth.user.id) {
    return NextResponse.json({ success: false, error: "Nicht erlaubt" }, { status: 403 });
  }
  if (doc.doc_type !== "lohnausweis") {
    return NextResponse.json({ success: false, error: "Nur Lohnausweise koennen bestaetigt werden" }, { status: 400 });
  }
  if (doc.received_confirmed_at) {
    return NextResponse.json({ success: true, received_confirmed_at: doc.received_confirmed_at });
  }

  const now = new Date().toISOString();
  const { error: updErr } = await admin
    .from("wage_documents")
    .update({ received_confirmed_at: now })
    .eq("id", id);
  if (updErr) return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
  return NextResponse.json({ success: true, received_confirmed_at: now });
}
