// PATCH /api/admin/roles/[slug] — Label oder Permissions aendern.
// DELETE /api/admin/roles/[slug] — Rolle loeschen.
//
// admin-Rolle ist geschuetzt: weder permissions noch slug aenderbar, nicht
// loeschbar. Sonst koennten sich Admins selbst aussperren.
// is_system-Rollen (admin, techniker) koennen nicht geloescht werden, aber
// ihre Permissions koennen angepasst werden (ausser admin).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api-auth";
import { allKnownPermissions } from "@/lib/permissions";
import { logPermissionAudit } from "@/lib/permission-audit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { slug } = await params;
  if (slug === "admin") {
    return NextResponse.json({ success: false, error: "Admin-Rolle kann nicht geaendert werden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: "Ungueltiger Body" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (typeof body.label === "string" && body.label.trim()) {
    update.label = body.label.trim();
  }
  if (Array.isArray(body.permissions)) {
    const valid = new Set(allKnownPermissions());
    update.permissions = (body.permissions as unknown[]).filter((s): s is string => typeof s === "string" && valid.has(s));
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: false, error: "Keine Aenderungen" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Vorher-Zustand fuer Audit-Diff laden.
  const { data: before } = await admin
    .from("roles")
    .select("label, permissions")
    .eq("slug", slug)
    .maybeSingle();
  const { error } = await admin.from("roles").update(update).eq("slug", slug);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await logPermissionAudit({
    actor_profile_id: auth.user.id,
    action: "role.updated",
    target_role_slug: slug,
    details: { before: before ?? null, changes: update },
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { slug } = await params;
  const admin = createAdminClient();

  // System-Rollen sind nicht loeschbar.
  const { data: role } = await admin.from("roles").select("is_system").eq("slug", slug).single();
  if (role?.is_system) {
    return NextResponse.json({ success: false, error: "System-Rolle kann nicht geloescht werden" }, { status: 403 });
  }

  // User-Check: wenn noch User auf der Rolle haengen, abbrechen.
  const { count } = await admin.from("profiles").select("*", { count: "exact", head: true }).eq("role", slug);
  if ((count ?? 0) > 0) {
    return NextResponse.json({
      success: false,
      error: `${count} Benutzer haben diese Rolle. Bitte erst zu einer anderen Rolle umziehen.`,
    }, { status: 400 });
  }

  const { data: before } = await admin
    .from("roles")
    .select("label, permissions")
    .eq("slug", slug)
    .maybeSingle();
  const { error } = await admin.from("roles").delete().eq("slug", slug);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await logPermissionAudit({
    actor_profile_id: auth.user.id,
    action: "role.deleted",
    target_role_slug: slug,
    details: { before: before ?? null },
  });
  return NextResponse.json({ success: true });
}
