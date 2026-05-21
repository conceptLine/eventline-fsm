// GET /api/budget/internal-stats?year=2026
//
// Berechnet Soll-Werte fuer alle Kategorien mit auto_source='internal_labor':
//   Soll = SUM(job_appointment-Stunden im Jahr fuer eligible User) × Vollkosten/h
//
// Pro-User-Raten: jeder Mitarbeiter hat eigene hourly_wage + employer_costs
// in employee_compensation. Wir multiplizieren Termin-Stunden mit der
// Vollkosten-Rate des jeweiligen Users.
//
// Eligibility: Wir zaehlen Stunden NUR von echten Mitarbeitern.
//   • role IN ('admin','partner')                 → raus
//   • email = 'admin@eventline-basel.com'         → raus
//   • kein employee_compensation-Eintrag (NULL)   → raus

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrustedDevice } from "@/lib/api-auth";

const EXCLUDED_EMAILS = new Set(["admin@eventline-basel.com"]);
const EXCLUDED_ROLES = new Set(["admin", "partner"]);

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

  // 1. Eligible-User-Set
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, role, email");
  if (profErr) return NextResponse.json({ success: false, error: profErr.message }, { status: 500 });

  const eligibleProfileIds = new Set<string>();
  for (const p of profiles ?? []) {
    const role = (p.role as string | null) ?? "";
    const email = ((p.email as string | null) ?? "").toLowerCase();
    if (EXCLUDED_ROLES.has(role)) continue;
    if (EXCLUDED_EMAILS.has(email)) continue;
    eligibleProfileIds.add(p.id as string);
  }

  // 2. Pro-User-Vollkosten-Rate aus employee_compensation (history-aware).
  const { data: comps, error: compErr } = await admin
    .from("employee_compensation")
    .select("profile_id, hourly_wage_chf, employer_costs_chf_per_hour, effective_from, effective_to")
    .order("effective_from", { ascending: false });
  if (compErr) return NextResponse.json({ success: false, error: compErr.message }, { status: 500 });

  const compsByUser = new Map<string, Array<{ from: string; to: string | null; rate: number }>>();
  for (const c of comps ?? []) {
    const uid = c.profile_id as string;
    if (!eligibleProfileIds.has(uid)) continue;
    const rate = Number(c.hourly_wage_chf) + Number(c.employer_costs_chf_per_hour);
    if (!compsByUser.has(uid)) compsByUser.set(uid, []);
    compsByUser.get(uid)!.push({
      from: c.effective_from as string,
      to: (c.effective_to as string | null) ?? null,
      rate,
    });
  }

  /** Vollkosten-Rate fuer einen User an einem bestimmten Datum. Null wenn
   *  der User an dem Datum keinen aktiven Lohn hatte. */
  function rateAt(userId: string, dateIso: string): number | null {
    const entries = compsByUser.get(userId);
    if (!entries) return null;
    const date = dateIso.slice(0, 10);
    for (const e of entries) {
      if (date < e.from) continue;
      if (e.to && date > e.to) continue;
      return e.rate;
    }
    return null;
  }

  // 3. Auto-Source-Kategorien laden.
  const { data: autoCats, error: catErr } = await admin
    .from("budget_categories")
    .select("id, auto_source")
    .not("auto_source", "is", null)
    .is("archived_at", null);
  if (catErr) return NextResponse.json({ success: false, error: catErr.message }, { status: 500 });

  const laborCategoryIds = (autoCats ?? [])
    .filter((c) => c.auto_source === "internal_labor")
    .map((c) => c.id as string);

  if (laborCategoryIds.length === 0) {
    return NextResponse.json({ success: true, year, byCategoryId: {} });
  }

  const yearStart = `${year}-01-01T00:00:00Z`;
  const yearEnd = `${year + 1}-01-01T00:00:00Z`;

  // 4. Soll = Summe aller job_appointments × Vollkosten-Rate des Assigned-Users.
  const { data: appts, error: apptErr } = await admin
    .from("job_appointments")
    .select("start_time, end_time, assigned_to")
    .gte("start_time", yearStart)
    .lt("start_time", yearEnd);
  if (apptErr) return NextResponse.json({ success: false, error: apptErr.message }, { status: 500 });

  let sollChf = 0;
  let sollHours = 0;
  for (const a of appts ?? []) {
    const userId = a.assigned_to as string | null;
    if (!userId || !eligibleProfileIds.has(userId)) continue;
    const start = new Date(a.start_time as string).getTime();
    const end = new Date(a.end_time as string).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const hours = (end - start) / 3600000;
    const rate = rateAt(userId, a.start_time as string);
    if (rate === null) continue;
    sollHours += hours;
    sollChf += hours * rate;
  }

  const round = (n: number) => Math.round(n * 100) / 100;

  const byCategoryId: Record<string, { soll_chf: number; hours_soll: number }> = {};
  for (const catId of laborCategoryIds) {
    byCategoryId[catId] = {
      soll_chf: round(sollChf),
      hours_soll: round(sollHours),
    };
  }

  return NextResponse.json({
    success: true,
    year,
    byCategoryId,
    excluded: { roles: [...EXCLUDED_ROLES], emails: [...EXCLUDED_EMAILS] },
    eligibleCount: eligibleProfileIds.size,
  });
}
