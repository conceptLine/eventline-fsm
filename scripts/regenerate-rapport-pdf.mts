// One-shot: PDF fuer einen Rapport nachgenerieren + im Storage ablegen
// + service_reports.pdf_url setzen. Fuer Faelle wo ein Rapport manuell
// (per DB-UPDATE) auf abgeschlossen gesetzt wurde und der normale
// send-invoice-Flow uebersprungen wurde.
//
// Usage:
//   npx tsx scripts/regenerate-rapport-pdf.mts <report-id>

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildRapportPdf, type RapportJobInfo, type RapportReportRow } from "../src/lib/build-rapport-pdf";

const envText = readFileSync(".env.local", "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const reportId = process.argv[2];
if (!reportId) {
  console.error("usage: npx tsx scripts/regenerate-rapport-pdf.mts <report-id>");
  process.exit(1);
}

const admin = createClient(URL, KEY, { auth: { persistSession: false } });

const { data: report, error: rErr } = await admin
  .from("service_reports")
  .select("*, job:jobs(title, job_number, customer:customers(name, address_street, address_zip, address_city), location:locations(name))")
  .eq("id", reportId)
  .single();
if (rErr || !report) {
  console.error("Report nicht gefunden:", rErr?.message);
  process.exit(1);
}

console.log(`Generiere PDF fuer Rapport ${reportId} (Job: ${(report.job as { job_number?: number } | null)?.job_number ?? "?"})`);
const pdfBuffer = await buildRapportPdf(report as RapportReportRow, (report.job as RapportJobInfo | null) ?? null, admin);

const path = `service-reports/${reportId}/rapport.pdf`;
const { error: upErr } = await admin.storage
  .from("documents")
  .upload(path, pdfBuffer, { upsert: true, contentType: "application/pdf" });
if (upErr) {
  console.error("Upload fehlgeschlagen:", upErr.message);
  process.exit(1);
}

const { error: updErr } = await admin
  .from("service_reports")
  .update({ pdf_url: path })
  .eq("id", reportId);
if (updErr) {
  console.error("pdf_url-Update fehlgeschlagen:", updErr.message);
  process.exit(1);
}

console.log(`OK -> ${path} (${pdfBuffer.length} bytes)`);
