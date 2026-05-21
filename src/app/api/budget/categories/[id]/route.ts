// PATCH  /api/budget/categories/[id]  — name/sort_order/parent_id aendern.
// DELETE /api/budget/categories/[id]  — soft-delete (archived_at setzen).
//                                      Mit ?hard=1 wird hart geloescht
//                                      (nur erlaubt wenn keine entries dranhaengen
//                                      und keine Sub-Kategorien existieren).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrustedDevice } from "@/lib/api-auth";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTrustedDevice("budget:edit");
  if (auth.error) return auth.error;

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: "Ungueltiger Body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ success: false, error: "Name ist Pflicht" }, { status: 400 });
    if (name.length > 80) return NextResponse.json({ success: false, error: "Name max. 80 Zeichen" }, { status: 400 });
    patch.name = name;
  }
  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    patch.sort_order = Math.round(body.sort_order);
  }
  if (body.parent_id === null || typeof body.parent_id === "string") {
    if (body.parent_id === id) {
      return NextResponse.json({ success: false, error: "Kategorie kann nicht Elternteil von sich selbst sein" }, { status: 400 });
    }
    patch.parent_id = body.parent_id;
  }
  if (body.archived_at === null) patch.archived_at = null;
  if (typeof body.archived_at === "string") patch.archived_at = body.archived_at;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ success: false, error: "Keine Aenderungen" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("budget_categories")
    .update(patch)
    .eq("id", id)
    .select("id, parent_id, name, sort_order, archived_at, auto_source")
    .single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, category: data });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTrustedDevice("budget:edit");
  if (auth.error) return auth.error;

  const { id } = await ctx.params;
  const url = new URL(request.url);
  const hard = url.searchParams.get("hard") === "1";

  const admin = createAdminClient();

  if (hard) {
    // Hart loeschen nur wenn keine Kinder + keine Entries dranhaengen.
    const [{ count: kidsCount }, { count: entriesCount }] = await Promise.all([
      admin.from("budget_categories").select("id", { count: "exact", head: true }).eq("parent_id", id),
      admin.from("budget_entries").select("id", { count: "exact", head: true }).eq("category_id", id),
    ]);
    if ((kidsCount ?? 0) > 0) {
      return NextResponse.json({ success: false, error: "Kategorie hat Sub-Kategorien" }, { status: 400 });
    }
    if ((entriesCount ?? 0) > 0) {
      return NextResponse.json({ success: false, error: "Kategorie hat bereits Budget-Eintraege" }, { status: 400 });
    }
    const { error } = await admin.from("budget_categories").delete().eq("id", id);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // Soft-Delete: archivieren.
  const { error } = await admin
    .from("budget_categories")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
