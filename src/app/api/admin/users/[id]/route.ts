// PATCH /api/admin/users/[id] — Profil eines Users bearbeiten.
// Erlaubt sind full_name, role, is_active. Email wird nicht geaendert
// (das ist mit Auth-Layer gekoppelt — separater Flow waere noetig, wird
// bei euch selten gebraucht).
//
// is_active=false ist die "Soft-Delete"-Variante: der User kann sich nicht
// mehr einloggen, bleibt aber als Referenz auf alten Auftraegen (created_by,
// assigned_to, etc.) erhalten. Admin-Client bannt den Auth-User parallel.
//
// DELETE /api/admin/users/[id] — endgueltiges Loeschen. Nur erlaubt fuer
// bereits deaktivierte User (is_active=false), damit man niemanden
// versehentlich aus dem aktiven Betrieb loescht. FKs auf alten Auftraegen
// werden via ON DELETE SET NULL auf null gesetzt (016_protect_data),
// notifications cascadieren weg. Auth-User wird ueber die Admin-API
// geloescht — profiles cascadiert automatisch (FK on auth.users).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api-auth";
import { logError } from "@/lib/log";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: "Ungueltiger Body" }, { status: 400 });

  // Selbstschutz: Admin darf sich nicht selbst aussperren oder degradieren.
  // Ohne diesen Check kann der einzige Admin sich auf is_active=false setzen
  // (oder seine Rolle weg von 'admin' aendern) und die Firma hat keinen
  // Admin-Zugang mehr.
  if (auth.user.id === id) {
    if (body.is_active === false) {
      return NextResponse.json(
        { success: false, error: "Du kannst dich nicht selbst deaktivieren" },
        { status: 400 },
      );
    }
    if (typeof body.role === "string" && body.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Du kannst dir nicht selbst die Admin-Rolle wegnehmen" },
        { status: 400 },
      );
    }
  }

  const admin = createAdminClient();

  const update: Record<string, unknown> = {};
  if (typeof body.full_name === "string" && body.full_name.trim()) {
    update.full_name = body.full_name.trim();
  }
  if (typeof body.role === "string") {
    // Rolle muss existieren.
    const { data: roleRow } = await admin.from("roles").select("slug").eq("slug", body.role).single();
    if (!roleRow) {
      return NextResponse.json({ success: false, error: "Rolle existiert nicht" }, { status: 400 });
    }
    update.role = roleRow.slug;
  }
  if (typeof body.is_active === "boolean") {
    update.is_active = body.is_active;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: false, error: "Keine Aenderungen" }, { status: 400 });
  }

  const { error: profErr } = await admin.from("profiles").update(update).eq("id", id);
  if (profErr) {
    logError("admin.users.update.profile", profErr, { userId: id });
    return NextResponse.json({ success: false, error: "Update fehlgeschlagen" }, { status: 500 });
  }

  // Wenn is_active=false: Auth-User bannen damit Login nicht mehr geht.
  // Reaktivieren = ban_duration: "none".
  if (typeof body.is_active === "boolean") {
    const { error: banErr } = await admin.auth.admin.updateUserById(id, {
      ban_duration: body.is_active ? "none" : "876000h", // ~100 Jahre = effektiv permanent
    });
    if (banErr) {
      // Profil ist schon umgestellt — den Ban-Fehler nur zurueckmelden.
      logError("admin.users.update.ban", banErr, { userId: id });
      return NextResponse.json({ success: false, error: "Login-Sperre konnte nicht gesetzt werden" }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { success: false, error: "Server-Konfiguration unvollstaendig" },
      { status: 500 },
    );
  }

  const { id } = await params;

  // Selbstschutz: Admin darf sich nicht selbst loeschen.
  if (auth.user.id === id) {
    return NextResponse.json(
      { success: false, error: "Du kannst dich nicht selbst loeschen" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Strikt nur deaktivierte User. Wer aktiv ist, muss erst deaktiviert
  // werden — schuetzt vor versehentlichem Hard-Delete im Live-Betrieb.
  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("id, email, full_name, is_active")
    .eq("id", id)
    .maybeSingle();

  if (profErr) {
    return NextResponse.json({ success: false, error: profErr.message }, { status: 500 });
  }

  // Profil kann verwaist sein (orphan: profile geloescht / nie existiert,
  // aber auth.users-Eintrag noch da). Trotzdem Loesch-Versuch via Auth-API
  // damit der Admin auch verwaiste Auth-User beseitigen kann.
  if (profile && profile.is_active) {
    return NextResponse.json(
      { success: false, error: "Nur deaktivierte Benutzer koennen geloescht werden" },
      { status: 400 },
    );
  }

  // VORHER: Storage-Cleanup direkt im DELETE-Pfad.
  // JETZT: Admin muss zuerst /dossier aufrufen (= ZIP-Backup aller Daten
  // inkl. PDFs in personal-dossiers-Bucket archivieren). Erst dann
  // duerfen die Original-Dateien geloescht werden. Schuetzt vor
  // Datenverlust bei Hard-Delete. Frontend zwingt diesen Flow.
  // Wir entfernen die lohndokumente-Files trotzdem mit (= aufraeumen
  // nach Backup) — das Dossier hat sie ja archiviert.
  try {
    const { data: stFiles } = await admin.storage
      .from("lohndokumente")
      .list(id, { limit: 1000 });
    if (stFiles && stFiles.length > 0) {
      const allPaths: string[] = [];
      for (const entry of stFiles) {
        const { data: yearFiles } = await admin.storage
          .from("lohndokumente")
          .list(`${id}/${entry.name}`, { limit: 1000 });
        for (const f of yearFiles ?? []) {
          allPaths.push(`${id}/${entry.name}/${f.name}`);
        }
      }
      if (allPaths.length > 0) {
        const { error: rmErr } = await admin.storage.from("lohndokumente").remove(allPaths);
        if (rmErr) logError("admin.users.delete.storage", { error: rmErr.message, count: allPaths.length }, { userId: id });
      }
    }
  } catch (e) {
    logError("admin.users.delete.storage.exception", e, { userId: id });
  }

  // Auth-User loeschen. profiles cascadiert via FK ON DELETE CASCADE.
  // Falls auth.users nicht (mehr) existiert: 404 von Supabase ignorieren
  // und nur das verwaiste profile wegputzen.
  const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });

  if (!authRes.ok && authRes.status !== 404) {
    const body = await authRes.text().catch(() => "");
    logError("admin.users.delete.auth", { status: authRes.status, body }, { userId: id });
    return NextResponse.json(
      { success: false, error: `Auth-Loeschung fehlgeschlagen: ${body || authRes.status}` },
      { status: 500 },
    );
  }

  // Sicherheits-Netz: falls profile-Cascade nicht griff (z.B. weil FK
  // damals nicht angelegt wurde) — explizit nachloeschen.
  await admin.from("profiles").delete().eq("id", id);

  return NextResponse.json({ success: true });
}
