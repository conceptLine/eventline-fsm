import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
// jsPDF wird lazy geladen — ~180KB, soll nicht beim Cold-Start der
// Route mitgeparsed werden wenn der erste Aufruf vielleicht gar nicht
// bis zum PDF-Build kommt.
import LOGO_BASE64 from "@/lib/logo-base64";
import { requireUser } from "@/lib/api-auth";

interface TimeRange {
  date: string;
  start: string;
  end: string;
  pause: number;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { id } = await params;
  // User-Client (mit Session-Cookie) statt Service-Role — damit RLS auf
  // service_reports greift und der User nur Reports sieht zu denen er
  // berechtigt ist (created_by ODER admin). Vorher konnte jeder
  // authentifizierte User per Direct-Object-Reference jeden Rapport
  // als PDF runterladen.
  const userClient = await createClient();

  const { data: report } = await userClient
    .from("service_reports")
    .select("*, job:jobs(title, job_number, customer:customers(name, address_street, address_zip, address_city), location:locations(name))")
    .eq("id", id)
    .single();

  if (!report) {
    return NextResponse.json({ error: "Rapport nicht gefunden oder keine Berechtigung" }, { status: 404 });
  }

  // Service-Role-Client wird weiter unten ggf. fuer Storage-Reads (Photos)
  // benoetigt — Storage-RLS koennte sonst den Photo-Pull blockieren obwohl
  // der User den zugehoerigen Report sehen darf.
  const supabase = createAdminClient();

  const job = report.job as any;
  const customer = job?.customer;
  const location = job?.location;
  const timeRanges: TimeRange[] = report.time_ranges || [];

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  // Logo rechts oben
  try {
    const logoWidth = 70;
    const logoHeight = logoWidth / 4.32;
    doc.addImage(LOGO_BASE64, "PNG", pageWidth - 14 - logoWidth, 12, logoWidth, logoHeight);
  } catch {}

  // Titel
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Einsatzrapport", 14, y);

  if (job?.job_number) {
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text(`INT-${job.job_number}`, 14, y + 7);
    doc.setTextColor(0);
    y += 4;
  }

  y += 10;
  doc.setDrawColor(220);
  doc.setLineWidth(0.5);
  doc.line(14, y, pageWidth - 14, y);

  // Auftragsdaten
  y += 8;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Auftrag:", 14, y);
  doc.setFont("helvetica", "normal");
  doc.text(job?.title || "-", 55, y);

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Kunde:", 14, y);
  doc.setFont("helvetica", "normal");
  doc.text(customer?.name || "-", 55, y);

  if (customer?.address_street) {
    y += 5;
    doc.text(`${customer.address_street}, ${customer.address_zip || ""} ${customer.address_city || ""}`, 55, y);
  }

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Standort:", 14, y);
  doc.setFont("helvetica", "normal");
  doc.text(location?.name || "-", 55, y);

  // Einsatzzeiten
  if (timeRanges.length > 0) {
    y += 10;
    doc.setDrawColor(220);
    doc.line(14, y, pageWidth - 14, y);

    y += 8;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Einsatzzeiten", 14, y);

    y += 7;
    // Tabellenkopf
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(120);
    doc.text("Datum", 14, y);
    doc.text("Von", 65, y);
    doc.text("Bis", 90, y);
    doc.text("Pause", 115, y);
    doc.text("Arbeitszeit", 145, y);
    doc.setTextColor(0);

    y += 2;
    doc.setDrawColor(230);
    doc.line(14, y, pageWidth - 14, y);

    let totalMin = 0;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");

    for (const tr of timeRanges) {
      y += 5;
      const dateStr = new Date(tr.date + "T12:00:00").toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
      const [sh, sm] = tr.start.split(":").map(Number);
      const [eh, em] = tr.end.split(":").map(Number);
      const workMin = (eh * 60 + em) - (sh * 60 + sm) - tr.pause;
      totalMin += Math.max(0, workMin);
      const workH = Math.floor(workMin / 60);
      const workM = workMin % 60;

      doc.text(dateStr, 14, y);
      doc.text(`${tr.start} Uhr`, 65, y);
      doc.text(`${tr.end} Uhr`, 90, y);
      doc.text(`${tr.pause} Min`, 115, y);
      doc.text(`${workH}h ${workM > 0 ? workM + "m" : ""}`.trim(), 145, y);
    }

    // Total
    y += 3;
    doc.setDrawColor(200);
    doc.line(14, y, pageWidth - 14, y);
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.text("Total", 14, y);
    const totalH = Math.floor(totalMin / 60);
    const totalM = totalMin % 60;
    doc.text(`${totalH}h ${totalM > 0 ? totalM + "m" : ""}`.trim(), 145, y);
    doc.setFont("helvetica", "normal");
  } else {
    // Fallback: nur Datum
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Datum:", 14, y);
    doc.setFont("helvetica", "normal");
    doc.text(new Date(report.report_date).toLocaleDateString("de-CH"), 55, y);
  }

  // Trennlinie
  y += 8;
  doc.setDrawColor(220);
  doc.line(14, y, pageWidth - 14, y);

  // Arbeitsbeschreibung
  y += 8;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Ausgeführte Arbeiten", 14, y);
  y += 6;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const workLines = doc.splitTextToSize(report.work_description || "-", pageWidth - 28);
  doc.text(workLines, 14, y);
  y += workLines.length * 5 + 4;

  // Material
  if (report.equipment_used) {
    y += 4;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Eingesetztes Material", 14, y);
    y += 6;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const equipLines = doc.splitTextToSize(report.equipment_used, pageWidth - 28);
    doc.text(equipLines, 14, y);
    y += equipLines.length * 5 + 4;
  }

  // Probleme
  if (report.issues) {
    y += 4;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Probleme / Bemerkungen", 14, y);
    y += 6;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const issueLines = doc.splitTextToSize(report.issues, pageWidth - 28);
    doc.text(issueLines, 14, y);
    y += issueLines.length * 5 + 4;
  }

  // Unterschriften
  y = Math.max(y + 10, 220);
  doc.setDrawColor(220);
  doc.line(14, y, pageWidth - 14, y);

  y += 8;
  doc.setFontSize(10);

  doc.setFont("helvetica", "bold");
  doc.text("Service-Techniker:", 14, y);
  doc.setFont("helvetica", "normal");
  doc.text(report.technician_name || "-", 14, y + 5);
  doc.setDrawColor(180);
  doc.line(14, y + 20, 90, y + 20);
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text("Unterschrift Techniker", 14, y + 24);

  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.text("Kunde / Auftraggeber:", 110, y);
  doc.setFont("helvetica", "normal");
  doc.text(report.client_name || "-", 110, y + 5);
  doc.line(110, y + 20, pageWidth - 14, y + 20);
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text("Unterschrift Kunde", 110, y + 24);

  // Footer
  doc.setTextColor(150);
  doc.setFontSize(7);
  doc.text(
    "EVENTLINE GmbH · St. Jakobs-Strasse 200 · CH-4052 Basel · Tel: 055 556 62 61 · www.eventline-basel.com",
    pageWidth / 2,
    285,
    { align: "center" }
  );

  // Signature images
  if (report.technician_signature_url) {
    try {
      const { data } = await supabase.storage.from("documents").download(report.technician_signature_url);
      if (data) {
        const buffer = Buffer.from(await data.arrayBuffer());
        const base64 = buffer.toString("base64");
        doc.addImage(`data:image/png;base64,${base64}`, "PNG", 14, y + 8, 60, 10);
      }
    } catch {}
  }

  if (report.signature_url) {
    try {
      const { data } = await supabase.storage.from("documents").download(report.signature_url);
      if (data) {
        const buffer = Buffer.from(await data.arrayBuffer());
        const base64 = buffer.toString("base64");
        doc.addImage(`data:image/png;base64,${base64}`, "PNG", 110, y + 8, 60, 10);
      }
    } catch {}
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Rapport_${job?.job_number || id}.pdf"`,
    },
  });
}
