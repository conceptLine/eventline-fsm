// GET /api/admin/roles — alle Rollen.
// POST /api/admin/roles — neue Rolle anlegen.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api-auth";
import { allKnownPermissions } from "@/lib/permissions";
import { logPermissionAudit } from "@/lib/permission-audit";

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data, error } = await admin.from("roles").select("*").order("is_system", { ascending: false }).order("label");
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, roles: data });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: "Ungueltiger Body" }, { status: 400 });

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ success: false, error: "Label ist Pflicht" }, { status: 400 });

  // Slug aus Label generieren — lowercase, ascii, dashes.
  const slug = label
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug || slug === "admin" || slug === "techniker") {
    return NextResponse.json({ success: false, error: "Reservierter oder ungueltiger Name" }, { status: 400 });
  }

  // Permissions validieren — nur bekannte module:action-Strings erlaubt.
  const valid = new Set(allKnownPermissions());
  const permissions = Array.isArray(body.permissions)
    ? (body.permissions as unknown[]).filter((s): s is string => typeof s === "string" && valid.has(s))
    : [];

  const admin = createAdminClient();
  const { error } = await admin.from("roles").insert({
    slug,
    label,
    permissions,
    is_system: false,
  });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ success: false, error: "Eine Rolle mit diesem Namen existiert bereits" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  await logPermissionAudit({
    actor_profile_id: auth.user.id,
    action: "role.created",
    target_role_slug: slug,
    details: { label, permissions },
  });
  return NextResponse.json({ success: true, slug });
}
