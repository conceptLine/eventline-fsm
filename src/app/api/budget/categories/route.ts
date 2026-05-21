// GET  /api/budget/categories  — alle Kategorien (inkl. archivierte).
// POST /api/budget/categories  — neue Kategorie anlegen.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrustedDevice } from "@/lib/api-auth";

export async function GET() {
  const auth = await requireTrustedDevice("budget:view");
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("budget_categories")
    .select("id, parent_id, name, sort_order, archived_at, auto_source")
    .order("parent_id", { ascending: true, nullsFirst: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, categories: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireTrustedDevice("budget:edit");
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: "Ungueltiger Body" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ success: false, error: "Name ist Pflicht" }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ success: false, error: "Name max. 80 Zeichen" }, { status: 400 });

  const parent_id = typeof body.parent_id === "string" ? body.parent_id : null;

  const admin = createAdminClient();

  // sort_order: ans Ende der Geschwister-Liste haengen.
  const siblingsQuery = admin
    .from("budget_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const { data: siblings } = parent_id === null
    ? await siblingsQuery.is("parent_id", null)
    : await siblingsQuery.eq("parent_id", parent_id);
  const maxOrder = siblings?.[0]?.sort_order ?? 0;

  const { data, error } = await admin
    .from("budget_categories")
    .insert({ name, parent_id, sort_order: maxOrder + 10 })
    .select("id, parent_id, name, sort_order, archived_at, auto_source")
    .single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, category: data });
}
