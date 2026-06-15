// Generiert Beispiel-Dateien (Timesheet.xlsx + Lohnabrechnung.pdf) mit
// Fake-Daten — zum Vorzeigen wie der echte Export aussieht.
//
// Run: node scripts/generate-samples.mjs
// Output: examples/timesheet_sample.xlsx + examples/lohnabrechnung_sample.pdf

import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";

const OUT_DIR = path.join(process.cwd(), "examples");
fs.mkdirSync(OUT_DIR, { recursive: true });

const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAY_LABELS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const CHF = (n) => n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Fake-Mitarbeiter
const employees = [
  { name: "Max Muster", role: "Techniker", email: "max@beispiel.ch", wage: 28.50, birthdate: "1995-06-15" },
  { name: "Anna Beispiel", role: "Eventleitung", email: "anna@beispiel.ch", wage: 35.00, birthdate: "1988-03-22" },
  { name: "Tim Lehrling", role: "Lernender", email: "tim@beispiel.ch", wage: 18.20, birthdate: "2008-11-04" },
];

// Fake-Period: März 2026 (mit 31 Tagen, hat Karfreitag/Ostermontag im April aber Märzdaten reichen)
const YEAR = 2026;
const MONTH = 3; // März
const FROM = `${YEAR}-${String(MONTH).padStart(2, "0")}-01`;
const TO = `${YEAR}-${String(MONTH).padStart(2, "0")}-31`;

// Fake-Tage pro Mitarbeiter generieren
function generateDays(seed) {
  const days = [];
  for (let day = 1; day <= 31; day++) {
    const date = `${YEAR}-${String(MONTH).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dt = new Date(`${date}T12:00:00Z`);
    const wd = dt.getUTCDay();

    // Pseudo-random pattern abhaengig vom Seed + Tag
    const r = ((seed * 7 + day * 13) % 31) / 31;

    // Wochenende: nur ab und zu Eventarbeit
    if (wd === 0 || wd === 6) {
      if (r < 0.4) continue; // 60% Freizeit
    } else {
      if (r < 0.15) continue; // 15% frei
    }

    // Stempel-Minuten
    let stempel = 0;
    let night = 0;
    if (r < 0.3) {
      // Tagschicht 08:00 - 17:00 (8h)
      stempel = 8 * 60;
    } else if (r < 0.6) {
      // Standardevent 12:00 - 22:00 (10h)
      stempel = 10 * 60;
    } else if (r < 0.85) {
      // Spaetevent 16:00 - 02:00 (10h, davon 3h Nacht 23-02)
      stempel = 10 * 60;
      night = 3 * 60;
    } else {
      // Nachtevent 20:00 - 04:00 (8h, davon 5h Nacht 23-04)
      stempel = 8 * 60;
      night = 5 * 60;
    }

    // Manchmal Rapport + Geplant zusaetzlich (typischer Eventline-Flow)
    const geplant = Math.random() < 0.7 ? stempel : 0;
    const rapport = stempel > 0 ? stempel + Math.round((Math.random() - 0.5) * 30) : 0;

    days.push({ date, wd, stempel, night, geplant, rapport: Math.max(0, rapport) });
  }
  return days;
}

const employeeDays = employees.map((e, i) => ({
  ...e,
  days: generateDays(i + 1),
}));

// =============================================================
// EXCEL TIMESHEET
// =============================================================

async function buildExcel() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "EVENTLINE FSM (Beispiel)";

  // Logo einmal laden
  let logoImageId = null;
  try {
    const logoPath = path.join(process.cwd(), "public", "logo-gmbh-black.png");
    const logoBuf = fs.readFileSync(logoPath);
    logoImageId = wb.addImage({ buffer: logoBuf, extension: "png" });
  } catch {}
  function placeLogo(sheet, rightColIdx) {
    if (logoImageId == null) return;
    sheet.addImage(logoImageId, {
      tl: { col: rightColIdx - 2, row: 0 },
      ext: { width: 130, height: 30 },
    });
    sheet.getRow(1).height = 24;
  }

  // Uebersicht-Sheet
  const summary = wb.addWorksheet("Übersicht");
  summary.columns = [
    { header: "Mitarbeiter", key: "name", width: 26 },
    { header: "Rolle", key: "role", width: 14 },
    { header: "Stempel h", key: "stempel", width: 11 },
    { header: "Geplant h", key: "geplant", width: 11 },
    { header: "Rapport h", key: "rapport", width: 11 },
    { header: "Nacht h", key: "night", width: 9 },
    { header: "So/FT-Tage", key: "sunhol", width: 11 },
    { header: "Brutto CHF", key: "brutto", width: 13 },
    { header: "Netto CHF", key: "netto", width: 13 },
    { header: "Vollkosten CHF", key: "vollkosten", width: 14 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
  placeLogo(summary, 10);

  for (const emp of employeeDays) {
    let totalStempel = 0;
    let totalNight = 0;
    let totalGeplant = 0;
    let totalRapport = 0;
    let sunholDays = 0;
    let sunholMinutes = 0;

    const sheet = wb.addWorksheet(emp.name);
    sheet.columns = [
      { header: "Datum", key: "date", width: 12 },
      { header: "Wochentag", key: "wd", width: 11 },
      { header: "Sonn/Feier", key: "sunhol", width: 11 },
      { header: "Stempel-Min", key: "stempel_min", width: 12 },
      { header: "Nacht-Min", key: "night_min", width: 11 },
      { header: "Geplant-Min", key: "geplant_min", width: 12 },
      { header: "Rapport-Min", key: "rapport_min", width: 12 },
      { header: "Stempel h", key: "stempel_h", width: 10 },
      { header: "Notiz", key: "note", width: 22 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
    placeLogo(sheet, 9);

    for (const d of emp.days) {
      const isSunday = d.wd === 0;
      const isSunhol = isSunday;
      const note = isSunday ? "Sonntag" : "";
      sheet.addRow({
        date: d.date,
        wd: WEEKDAY_LABELS[d.wd],
        sunhol: isSunhol ? "JA" : "",
        stempel_min: d.stempel,
        night_min: d.night,
        geplant_min: d.geplant,
        rapport_min: d.rapport,
        stempel_h: d.stempel > 0 ? Number((d.stempel / 60).toFixed(2)) : 0,
        note,
      });
      totalStempel += d.stempel;
      totalNight += d.night;
      totalGeplant += d.geplant;
      totalRapport += d.rapport;
      if (isSunhol && d.stempel > 0) { sunholDays++; sunholMinutes += d.stempel; }
    }

    const totalsRow = sheet.addRow({
      date: "TOTAL",
      stempel_min: totalStempel,
      night_min: totalNight,
      geplant_min: totalGeplant,
      rapport_min: totalRapport,
      stempel_h: Number((totalStempel / 60).toFixed(2)),
    });
    totalsRow.font = { bold: true };
    totalsRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6F6" } };

    // Lohn-Berechnung
    const effectiveMin = totalRapport > 0 ? totalRapport : totalStempel;
    const hours = effectiveMin / 60;
    const baseLohn = hours * emp.wage;
    const nightSurcharge = (totalNight / 60) * emp.wage * 0.25;
    const sunholSurcharge = (sunholMinutes / 60) * emp.wage * 0.5;
    const brutto = baseLohn + nightSurcharge + sunholSurcharge;

    // U20-Check
    const today = new Date(`${TO}T12:00:00Z`);
    const [by, bm, bd] = emp.birthdate.split("-").map(Number);
    let age = today.getUTCFullYear() - by;
    if (today.getUTCMonth() + 1 < bm || (today.getUTCMonth() + 1 === bm && today.getUTCDate() < bd)) age--;
    const ferienPct = age < 20 ? 10.64 : 8.33;
    const grundlohnHourly = emp.wage / (1 + ferienPct / 100);
    const ferienHourly = emp.wage - grundlohnHourly;

    // Abzuege (Standardwerte)
    const deductionPct = 5.3 + 1.1 + 1.4 + 0 + 0 + 0; // AHV+ALV+NBU
    const netto = brutto * (1 - deductionPct / 100);
    // AG-Anteil (Standard 11.9%)
    const employerPct = 5.3 + 1.1 + 1.5 + 0.5 + 3.0 + 0.5;
    const vollkosten = hours * (emp.wage + emp.wage * employerPct / 100) + nightSurcharge + sunholSurcharge;

    sheet.addRow({});
    const lohnHeader = sheet.addRow({ date: "LOHN-AUFSCHLÜSSELUNG" });
    lohnHeader.font = { bold: true };
    sheet.addRow({ date: "Brutto-Stundenlohn", note: `CHF ${CHF(emp.wage)} / h` });
    sheet.addRow({ date: `  davon Ferienanteil ${ferienPct.toFixed(2)}%`, note: `CHF ${CHF(ferienHourly)} / h` });
    sheet.addRow({ date: "  davon Grundlohn", note: `CHF ${CHF(grundlohnHourly)} / h` });
    sheet.addRow({ date: "Effektive Minuten (Basis)", note: effectiveMin });
    sheet.addRow({ date: "  davon Rapport", note: totalRapport });
    sheet.addRow({ date: "  davon Stempel (Fallback)", note: totalStempel });
    sheet.addRow({ date: "Brutto-Lohnkosten", note: `CHF ${CHF(brutto)}` });
    sheet.addRow({ date: "Netto-Auszahlung", note: `CHF ${CHF(netto)}` });
    sheet.addRow({ date: "Vollkosten Arbeitgeber", note: `CHF ${CHF(vollkosten)}` });
    sheet.addRow({});
    const hinweisRow = sheet.addRow({ date: "Hinweis", note: "Beispiel-Daten — keine echten Mitarbeiter/Stunden." });
    hinweisRow.font = { italic: true, color: { argb: "FF888888" } };

    summary.addRow({
      name: emp.name,
      role: emp.role,
      stempel: Number((totalStempel / 60).toFixed(2)),
      geplant: Number((totalGeplant / 60).toFixed(2)),
      rapport: Number((totalRapport / 60).toFixed(2)),
      night: Number((totalNight / 60).toFixed(2)),
      sunhol: sunholDays,
      brutto: Number(brutto.toFixed(2)),
      netto: Number(netto.toFixed(2)),
      vollkosten: Number(vollkosten.toFixed(2)),
    });
  }

  const info = wb.addWorksheet("Info");
  info.columns = [{ key: "k", width: 18 }, { key: "v", width: 60 }];
  info.addRow({ k: "Zeitraum", v: `${FROM} bis ${TO}` });
  info.addRow({ k: "Generiert", v: new Date().toISOString().slice(0, 10) });
  info.addRow({ k: "Generiert von", v: "Beispiel-Generator (kein echter Lohn-Export)" });
  info.addRow({ k: "Quelle", v: "EVENTLINE FSM — Beispiel-Sheet mit Fake-Daten" });
  info.addRow({ k: "", v: "" });
  info.addRow({ k: "Hinweis", v: "Dieses Sheet zeigt wie der echte Export aussieht. Pro Mitarbeiter eigenes Sheet mit Tag-für-Tag-Aufschlüsselung." });

  const outPath = path.join(OUT_DIR, "timesheet_sample.xlsx");
  await wb.xlsx.writeFile(outPath);
  console.log(`[excel] geschrieben: ${outPath}`);
}

// =============================================================
// PDF LOHNABRECHNUNG (fuer einen Mitarbeiter)
// =============================================================

function buildPdf() {
  const emp = employeeDays[0]; // Max Muster
  let totalStempel = 0, totalNight = 0, totalGeplant = 0, totalRapport = 0, sunholMinutes = 0;
  let nightEligibleMin = 0;
  let nightRank = 0;
  for (const d of emp.days) {
    totalStempel += d.stempel;
    totalNight += d.night;
    totalGeplant += d.geplant;
    totalRapport += d.rapport;
    if (d.wd === 0 && d.stempel > 0) sunholMinutes += d.stempel;
    if (d.night > 0) {
      nightRank++;
      if (nightRank <= 24) nightEligibleMin += d.night;
    }
  }

  const wage = emp.wage;
  const effectiveMin = totalRapport > 0 ? totalRapport : totalStempel;
  const hours = effectiveMin / 60;

  // Ferienanteil
  const today = new Date(`${TO}T12:00:00Z`);
  const [by, bm, bd] = emp.birthdate.split("-").map(Number);
  let age = today.getUTCFullYear() - by;
  if (today.getUTCMonth() + 1 < bm || (today.getUTCMonth() + 1 === bm && today.getUTCDate() < bd)) age--;
  const ferienPct = age < 20 ? 10.64 : 8.33;
  const grundlohnHourly = wage / (1 + ferienPct / 100);
  const ferienHourly = wage - grundlohnHourly;
  const baseGrundlohn = hours * grundlohnHourly;
  const baseFerien = hours * ferienHourly;
  const baseLohn = hours * wage;
  const nightSurcharge = (nightEligibleMin / 60) * wage * 0.25;
  const sunholSurcharge = (sunholMinutes / 60) * wage * 0.5;
  const brutto = baseLohn + nightSurcharge + sunholSurcharge;

  // Abzuege (Standard)
  const pcts = { AHV_IV_EO: 5.3, ALV: 1.1, NBU: 1.4, BVG: 0, KTG: 0, Quellensteuer: 0 };
  const deductions = Object.entries(pcts).map(([k, v]) => ({ key: k, pct: v, amount: brutto * v / 100 }));
  const totalDeductionAmount = deductions.reduce((s, d) => s + d.amount, 0);
  const totalDeductionPct = Object.values(pcts).reduce((s, v) => s + v, 0);
  const netto = brutto - totalDeductionAmount;

  const employerPct = 5.3 + 1.1 + 1.5 + 0.5 + 3.0 + 0.5;
  const employer = wage * employerPct / 100;
  const vollkosten = hours * (wage + employer) + nightSurcharge + sunholSurcharge;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 18;
  const left = 20, right = 190, contentWidth = right - left;

  // Logo oben rechts
  try {
    const logoPath = path.join(process.cwd(), "public", "logo-gmbh-black.png");
    const logoBuf = fs.readFileSync(logoPath);
    const logoBase64 = `data:image/png;base64,${logoBuf.toString("base64")}`;
    const logoWidth = 45;
    const logoHeight = logoWidth / (800 / 185);
    doc.addImage(logoBase64, "PNG", right - logoWidth, y - 4, logoWidth, logoHeight);
  } catch {}

  doc.setFontSize(18); doc.setFont("helvetica", "bold");
  doc.text("EVENTLINE GmbH", left, y);
  y += 6;
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("Dornacherstrasse 192 · 4053 Basel", left, y);
  y += 10;

  doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text("Lohnabrechnung (BEISPIEL)", left, y);
  doc.setFontSize(10); doc.setFont("helvetica", "normal");
  doc.text(`${MONTH_NAMES[MONTH - 1]} ${YEAR}`, right, y, { align: "right" });
  y += 8;
  doc.setDrawColor(200); doc.line(left, y, right, y); y += 6;

  doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text("Mitarbeiter", left, y);
  doc.setFont("helvetica", "normal");
  doc.text(emp.name, left + 35, y); y += 5;
  doc.text("Rolle", left, y); doc.text(emp.role, left + 35, y); y += 5;
  doc.text("E-Mail", left, y); doc.text(emp.email, left + 35, y); y += 8;
  doc.setDrawColor(200); doc.line(left, y, right, y); y += 6;

  // Stunden
  doc.setFont("helvetica", "bold"); doc.text("Stunden", left, y); y += 5;
  doc.setFont("helvetica", "normal");
  const fmtH = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  doc.text("Gestempelt", left, y); doc.text(fmtH(totalStempel), right, y, { align: "right" }); y += 5;
  doc.text("Geplant (Termine)", left, y); doc.text(fmtH(totalGeplant), right, y, { align: "right" }); y += 5;
  doc.text("Rapportiert (Basis Abrechnung)", left, y); doc.text(fmtH(totalRapport), right, y, { align: "right" }); y += 5;
  y += 3;
  doc.setDrawColor(200); doc.line(left, y, right, y); y += 6;

  // Verguetung
  doc.setFont("helvetica", "bold"); doc.text("Vergütung", left, y); y += 5;
  doc.setFont("helvetica", "normal");
  doc.text(`Stundenlohn (brutto, inkl. Ferienanteil)`, left, y); doc.text(`CHF ${CHF(wage)} / h`, right, y, { align: "right" }); y += 5;
  doc.setTextColor(110); doc.setFontSize(9);
  doc.text(`davon Grundlohn:`, left + 5, y); doc.text(`CHF ${CHF(grundlohnHourly)} / h`, right, y, { align: "right" }); y += 4;
  doc.text(`davon Ferienanteil ${ferienPct.toFixed(2)}% (Art. 329d OR):`, left + 5, y); doc.text(`CHF ${CHF(ferienHourly)} / h`, right, y, { align: "right" }); y += 5;
  doc.setTextColor(0); doc.setFontSize(10);
  doc.text(`Grundlohn (${(effectiveMin / 60).toFixed(2)} h × CHF ${CHF(grundlohnHourly)})`, left, y); doc.text(`CHF ${CHF(baseGrundlohn)}`, right, y, { align: "right" }); y += 5;
  doc.text(`Ferienanteil (${(effectiveMin / 60).toFixed(2)} h × CHF ${CHF(ferienHourly)})`, left, y); doc.text(`+ CHF ${CHF(baseFerien)}`, right, y, { align: "right" }); y += 5;

  if (nightEligibleMin > 0) {
    doc.text(`Nachtzuschlag 25% (${(nightEligibleMin / 60).toFixed(2)} h × CHF ${CHF(wage)} × 25%)`, left, y);
    doc.text(`+ CHF ${CHF(nightSurcharge)}`, right, y, { align: "right" }); y += 5;
  }
  if (sunholMinutes > 0) {
    doc.text(`Sonntags-/Feiertagszuschlag 50% (${(sunholMinutes / 60).toFixed(2)} h × CHF ${CHF(wage)} × 50%)`, left, y);
    doc.text(`+ CHF ${CHF(sunholSurcharge)}`, right, y, { align: "right" }); y += 5;
  }
  y += 2;
  doc.setFont("helvetica", "bold");
  doc.text("Bruttolohn", left, y); doc.text(`CHF ${CHF(brutto)}`, right, y, { align: "right" });
  y += 7;

  // Abzuege
  doc.setFont("helvetica", "bold"); doc.text("Abzüge Mitarbeiter", left, y); y += 5;
  doc.setFont("helvetica", "normal");
  for (const d of deductions) {
    if (d.pct === 0) continue;
    doc.text(`${d.key} (${d.pct.toFixed(2)}%)`, left, y);
    doc.text(`- CHF ${CHF(d.amount)}`, right, y, { align: "right" });
    y += 5;
  }
  y += 2;
  doc.setFont("helvetica", "bold");
  doc.text(`Total Abzüge (${totalDeductionPct.toFixed(2)}%)`, left, y); doc.text(`- CHF ${CHF(totalDeductionAmount)}`, right, y, { align: "right" });
  y += 8;
  doc.setDrawColor(80); doc.line(left, y, right, y); y += 7;

  doc.setFontSize(13); doc.setFont("helvetica", "bold");
  doc.text("Auszahlung", left, y);
  doc.text(`CHF ${CHF(netto)}`, right, y, { align: "right" });
  y += 12;

  doc.setFontSize(8); doc.setFont("helvetica", "italic"); doc.setTextColor(120);
  const footerLines = [
    `Vollkosten Arbeitgeber: CHF ${CHF(vollkosten)} (inkl. Arbeitgeber-Anteil ${CHF(employer)}/h)`,
    "BEISPIEL-DOKUMENT — Fake-Daten, kein echter Mitarbeiter.",
    "Diese Lohnabrechnung wird im echten System automatisch aus erfassten Stunden + Lohndaten generiert.",
    "Der offizielle Lohnausweis (Formular 11) wird jährlich separat erstellt.",
  ];
  for (const line of footerLines) {
    doc.text(line, left, y, { maxWidth: contentWidth });
    y += 4;
  }

  const outPath = path.join(OUT_DIR, "lohnabrechnung_sample.pdf");
  const buf = Buffer.from(doc.output("arraybuffer"));
  fs.writeFileSync(outPath, buf);
  console.log(`[pdf]   geschrieben: ${outPath}`);
}

await buildExcel();
buildPdf();
console.log("\nBeispiel-Dateien liegen in ./examples/");
