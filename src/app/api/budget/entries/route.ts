// GET  /api/budget/entries?year=2026  — alle Eintraege eines Jahres.
// POST /api/budget/entries             — upsert eines Jahres-Eintrags.
//
// Upsert-Semantik: pro (category_id, fiscal_year, period_type='year') gibt es
// max. einen Eintrag. Wenn amount_chf=0 und notes leer → Eintrag wird geloescht
// (kein Datenmuell fuer "nicht gesetzt" vs. "0 CHF" Unterschied).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrustedDevice } from "@/lib/api-auth";

export async function GET(request: Request) {
  const auth = await requireTrustedDevice("budget:view");
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const yearRaw = url.searchParams.get("year");
  const year = yearRaw ? parseInt(yearRaw, 10) : new Date().getFullYear();
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ success: false, error: "Ungueltiges Jahr" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("budget_entries")
    .select("id, category_id, fiscal_year, amount_chf, notes, updated_at")
    .eq("fiscal_year", year)
    .eq("period_type", "year");
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, entries: data ?? [], year });
}

export async function POST(request: Request) {
  const auth = await requireTrustedDevice("budget:edit");
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: "Ungueltiger Body" }, { status: 400 });

  const category_id = typeof body.category_id === "string" ? body.category_id : null;
  const fiscal_year = Number.isFinite(body.fiscal_year) ? Math.round(body.fiscal_year) : null;
  const amount_chf = Number.isFinite(body.amount_chf) ? Number(body.amount_chf) : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() : null;

  if (!category_id) return NextResponse.json({ success: false, error: "category_id fehlt" }, { status: 400 });
  if (fiscal_year === null || fiscal_year < 2000 || fiscal_year > 2100) {
    return NextResponse.json({ success: false, error: "Ungueltiges Jahr" }, { status: 400 });
  }
  if (amount_chf === null || amount_chf < 0) {
    return NextResponse.json({ success: false, error: "Ungueltiger Betrag" }, { status: 400 });
  }
  if (amount_chf > 999999999999) {
    return NextResponse.json({ success: false, error: "Betrag zu gross" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Existierenden Eintrag suchen (period_type='year').
  const { data: existing } = await admin
    .from("budget_entries")
    .select("id")
    .eq("category_id", category_id)
    .eq("fiscal_year", fiscal_year)
    .eq("period_type", "year")
    .maybeSingle();

  // Cleanup-Heuristik: wenn 0 CHF und kein Notes → Eintrag loeschen statt
  // 0-Zeile speichern. Macht die Liste in der DB aufgeraeumt.
  const isEmpty = amount_chf === 0 && !notes;

  if (existing) {
    if (isEmpty) {
      const { error } = await admin.from("budget_entries").delete().eq("id", existing.id);
      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, deleted: true });
    }
    const { data, error } = await admin
      .from("budget_entries")
      .update({ amount_chf, notes })
      .eq("id", existing.id)
      .select("id, category_id, fiscal_year, amount_chf, notes, updated_at")
      .single();
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, entry: data });
  }

  if (isEmpty) {
    // Nichts zu tun — kein Eintrag, kein Wert.
    return NextResponse.json({ success: true, noop: true });
  }

  const { data, error } = await admin
    .from("budget_entries")
    .insert({
      category_id,
      fiscal_year,
      period_type: "year",
      period_index: null,
      amount_chf,
      notes,
      created_by: auth.user.id,
    })
    .select("id, category_id, fiscal_year, amount_chf, notes, updated_at")
    .single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, entry: data });
}
