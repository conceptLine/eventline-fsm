// POST /api/admin/users/[id]/dossier — komplettes Datenpaket fuer einen
// Mitarbeiter generieren.
//
// Sammelt alle Daten die der User produziert / haette / besitzt + bundelt
// sie als ZIP in den personal-dossiers-Bucket. Returnt eine signed URL
// (1 Stunde gueltig) damit der Admin runterladen kann.
//
// Inhalt:
//   profile.json              — Stammdaten
//   compensation.json         — Lohn-Historie alle Zeilen
//   jobs.json                 — alle Jobs wo User created_by oder project_lead
//   assignments.json          — job_assignments-Eintraege
//   appointments.json         — job_appointments mit assigned_to=user
//   time_entries.json         — alle Stempel
//   service_reports.json      — alle Rapporte
//   notifications.json        — letzte ~1000 Benachrichtigungen
//   wage_documents/           — Lohnabrechnungen + Lohnausweise als PDFs
//   uploaded_documents/       — Dateien die der User hochgeladen hat
//   README.txt                — Beschreibung des Pakets + Generierungsdatum
//
// Admin-only.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import JSZip from "jszip";

const DOSSIER_BUCKET = "personal-dossiers";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id: profileId } = await params;

  const admin = createAdminClient();

  // 1. Stammdaten
  const { data: profile } = await admin.from("profiles").select("*").eq("id", profileId).maybeSingle();
  if (!profile) return NextResponse.json({ success: false, error: "Mitarbeiter nicht gefunden" }, { status: 404 });

  // 2. Compensation-Historie
  const { data: comp } = await admin
    .from("employee_compensation")
    .select("*")
    .eq("profile_id", profileId)
    .order("effective_from", { ascending: false });

  // 3. Jobs (created_by ODER project_lead_id)
  const { data: jobsCreated } = await admin
    .from("jobs")
    .select("id, job_number, title, status, start_date, end_date, created_at, created_by, project_lead_id")
    .or(`created_by.eq.${profileId},project_lead_id.eq.${profileId}`);

  // 4. Job-Assignments
  const { data: assignments } = await admin
    .from("job_assignments")
    .select("*")
    .eq("profile_id", profileId);

  // 5. Job-Appointments (zugewiesen)
  const { data: appts } = await admin
    .from("job_appointments")
    .select("*")
    .eq("assigned_to", profileId);

  // 6. Time-Entries (alle Stempel)
  const { data: stempel } = await admin
    .from("time_entries")
    .select("*")
    .eq("user_id", profileId)
    .order("clock_in", { ascending: false });

  // 7. Service-Reports
  const { data: reports } = await admin
    .from("service_reports")
    .select("*")
    .eq("created_by", profileId)
    .order("created_at", { ascending: false });

  // 8. Notifications (last 1000)
  const { data: notifs } = await admin
    .from("notifications")
    .select("*")
    .eq("user_id", profileId)
    .order("created_at", { ascending: false })
    .limit(1000);

  // 9. Wage-Documents Metadata + Files
  const { data: wageDocs } = await admin
    .from("wage_documents")
    .select("*")
    .eq("profile_id", profileId);

  // 10. Hochgeladene Documents (documents.uploaded_by)
  const { data: uploadedDocs } = await admin
    .from("documents")
    .select("*")
    .eq("uploaded_by", profileId);

  // ZIP bauen
  const zip = new JSZip();

  zip.file("README.txt",
    `Personal-Dossier fuer ${profile.full_name} (${profile.email ?? "—"})\n` +
    `Profile-ID: ${profileId}\n` +
    `Generiert am: ${new Date().toISOString()}\n` +
    `Generiert von: ${auth.user.id}\n\n` +
    `Inhalt:\n` +
    `  profile.json — Stammdaten\n` +
    `  compensation.json — Lohn-Historie (${comp?.length ?? 0} Zeilen)\n` +
    `  jobs.json — Jobs als created_by/project_lead (${jobsCreated?.length ?? 0})\n` +
    `  assignments.json — Job-Zuweisungen (${assignments?.length ?? 0})\n` +
    `  appointments.json — Termin-Zuweisungen (${appts?.length ?? 0})\n` +
    `  time_entries.json — Stempel-Eintraege (${stempel?.length ?? 0})\n` +
    `  service_reports.json — Rapporte (${reports?.length ?? 0})\n` +
    `  notifications.json — Benachrichtigungen (${notifs?.length ?? 0})\n` +
    `  wage_documents/ — Lohnabrechnungen + Lohnausweise PDFs (${wageDocs?.length ?? 0})\n` +
    `  uploaded_documents/ — Hochgeladene Dateien (${uploadedDocs?.length ?? 0})\n`
  );

  zip.file("profile.json", JSON.stringify(profile, null, 2));
  zip.file("compensation.json", JSON.stringify(comp ?? [], null, 2));
  zip.file("jobs.json", JSON.stringify(jobsCreated ?? [], null, 2));
  zip.file("assignments.json", JSON.stringify(assignments ?? [], null, 2));
  zip.file("appointments.json", JSON.stringify(appts ?? [], null, 2));
  zip.file("time_entries.json", JSON.stringify(stempel ?? [], null, 2));
  zip.file("service_reports.json", JSON.stringify(reports ?? [], null, 2));
  zip.file("notifications.json", JSON.stringify(notifs ?? [], null, 2));
  zip.file("wage_documents.json", JSON.stringify(wageDocs ?? [], null, 2));
  zip.file("uploaded_documents.json", JSON.stringify(uploadedDocs ?? [], null, 2));

  // Wage-Documents PDFs aus Storage ziehen
  if (wageDocs && wageDocs.length > 0) {
    const wageFolder = zip.folder("wage_documents")!;
    for (const doc of wageDocs) {
      const { data: blob } = await admin.storage.from("lohndokumente").download(doc.storage_path);
      if (!blob) continue;
      const buffer = Buffer.from(await blob.arrayBuffer());
      const filename = doc.doc_type === "lohnausweis"
        ? `Lohnausweis_${doc.year}.pdf`
        : `Lohnabrechnung_${doc.year}-${String(doc.period_month).padStart(2, "0")}.pdf`;
      wageFolder.file(filename, buffer);
    }
  }

  // Uploaded Documents aus Storage ziehen
  if (uploadedDocs && uploadedDocs.length > 0) {
    const uploadFolder = zip.folder("uploaded_documents")!;
    for (const doc of uploadedDocs) {
      if (!doc.storage_path) continue;
      // documents-Bucket ist anders je nach Pfad; default 'documents'
      const bucket = doc.storage_path.startsWith("partner-anfragen/") ? "documents" : "documents";
      const { data: blob } = await admin.storage.from(bucket).download(doc.storage_path);
      if (!blob) continue;
      const buffer = Buffer.from(await blob.arrayBuffer());
      // Datei-Name sicher machen (kein /, kein ..)
      const safe = (doc.name ?? `doc_${doc.id}`).replace(/[\\/:*?"<>|]/g, "_");
      uploadFolder.file(safe, buffer);
    }
  }

  // ZIP erstellen + hochladen
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = (profile.full_name ?? "user").replace(/[\\/:*?"<>|]/g, "_").substring(0, 50);
  const path = `${profileId}/dossier_${safeName}_${timestamp}.zip`;

  const { error: upErr } = await admin.storage.from(DOSSIER_BUCKET).upload(path, zipBuffer, {
    contentType: "application/zip",
    upsert: false,
  });
  if (upErr) {
    return NextResponse.json({ success: false, error: `Dossier-Upload fehlgeschlagen: ${upErr.message}` }, { status: 500 });
  }

  // Signed-URL (1 Stunde) zum Download zurueck
  const { data: signed } = await admin.storage.from(DOSSIER_BUCKET).createSignedUrl(path, 3600);

  return NextResponse.json({
    success: true,
    profile_name: profile.full_name,
    file_size: zipBuffer.length,
    download_url: signed?.signedUrl,
    storage_path: path,
    summary: {
      compensation_rows: comp?.length ?? 0,
      jobs: jobsCreated?.length ?? 0,
      assignments: assignments?.length ?? 0,
      appointments: appts?.length ?? 0,
      time_entries: stempel?.length ?? 0,
      service_reports: reports?.length ?? 0,
      notifications: notifs?.length ?? 0,
      wage_documents: wageDocs?.length ?? 0,
      uploaded_documents: uploadedDocs?.length ?? 0,
    },
  });
}
