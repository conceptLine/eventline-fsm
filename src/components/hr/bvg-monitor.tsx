"use client";

/**
 * BVG-Monitor — Voraus-Schau auf Brutto-Einkommen pro Mitarbeiter pro
 * Monat aus geplanten job_appointments. Verhindert dass jemand
 * versehentlich ueber die BVG-Eintrittsschwelle rutscht.
 *
 * Status-Farben:
 *   gruen   < 70%
 *   amber   70-95%
 *   rot     >= 95% (kritisch)
 *
 * Drill-down: Klick auf Zelle oeffnet die Termin-Liste fuer Person+Monat
 * mit Aufschluesselung Basis / Nacht-Praemie / Sonntag-Praemie.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { AlertTriangle, Shield, Settings } from "lucide-react";
import { toast } from "sonner";
import { calculateForecast, monthRange, forecastStatus, type Appointment } from "@/lib/bvg-forecast";

interface Profile {
  id: string;
  full_name: string;
  hourly_wage_chf: number | null;
}

interface AppointmentRow {
  id: string;
  assigned_to: string;
  start_time: string;
  end_time: string | null;
  title: string;
  job_id: string | null;
  job_number?: number | null;
  job_title?: string | null;
}

interface MonthCell {
  start: string;
  end: string;
  label: string;
}

export function BvgMonitor() {
  const supabase = createClient();
  const [threshold, setThreshold] = useState(1890);
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState("1890");
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drillKey, setDrillKey] = useState<{ profileId: string; monthIdx: number } | null>(null);

  // Periode: aktueller Monat + naechste 2 Monate
  const months: MonthCell[] = useMemo(() => {
    const now = new Date();
    const out: MonthCell[] = [];
    for (let i = 0; i < 3; i++) {
      const y = now.getFullYear();
      const m = now.getMonth() + 1 + i;
      const realY = m > 12 ? y + Math.floor((m - 1) / 12) : y;
      const realM = ((m - 1) % 12) + 1;
      out.push(monthRange(realY, realM));
    }
    return out;
  }, []);

  useEffect(() => {
    (async () => {
      const periodStart = months[0]!.start;
      const periodEnd = months[months.length - 1]!.end;
      const [settingsRes, profilesRes, compRes, apptsRes] = await Promise.all([
        supabase.from("app_settings").select("bvg_threshold_chf").eq("id", 1).maybeSingle(),
        supabase.from("profiles")
          .select("id, full_name")
          .eq("is_active", true)
          .order("full_name"),
        supabase.from("employee_compensation")
          .select("profile_id, hourly_wage_chf, effective_from, effective_to"),
        supabase.from("job_appointments")
          .select("id, assigned_to, start_time, end_time, title, job_id, jobs(job_number, title)")
          .gte("start_time", `${periodStart}T00:00:00Z`)
          .lt("start_time", `${periodEnd}T23:59:59Z`)
          .not("assigned_to", "is", null),
      ]);
      if (settingsRes.data?.bvg_threshold_chf) {
        const v = Number(settingsRes.data.bvg_threshold_chf);
        setThreshold(v);
        setThresholdDraft(String(v));
      }
      // Profiles: aktuell gueltigen hourly_wage aus employee_compensation
      // rauspicken (latest matching effective_from).
      const today = new Date().toISOString().slice(0, 10);
      type Comp = { profile_id: string; hourly_wage_chf: number; effective_from: string; effective_to: string | null };
      const byPidLatest = new Map<string, Comp>();
      for (const c of (compRes.data ?? []) as Comp[]) {
        if (c.effective_from <= today && (!c.effective_to || c.effective_to >= today)) {
          const cur = byPidLatest.get(c.profile_id);
          if (!cur || c.effective_from > cur.effective_from) byPidLatest.set(c.profile_id, c);
        }
      }
      const wagePerProfile = new Map<string, number>();
      for (const [pid, c] of byPidLatest) wagePerProfile.set(pid, Number(c.hourly_wage_chf));
      type ProfileRow = { id: string; full_name: string };
      const profs: Profile[] = ((profilesRes.data ?? []) as ProfileRow[]).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        hourly_wage_chf: wagePerProfile.get(p.id) ?? null,
      }));
      setProfiles(profs);

      type ApptJoinRow = { id: string; assigned_to: string; start_time: string; end_time: string | null; title: string; job_id: string | null; jobs?: { job_number?: number | null; title?: string | null } | null };
      const apps: AppointmentRow[] = ((apptsRes.data ?? []) as ApptJoinRow[]).map((a) => ({
        id: a.id,
        assigned_to: a.assigned_to,
        start_time: a.start_time,
        end_time: a.end_time,
        title: a.title,
        job_id: a.job_id,
        job_number: a.jobs?.job_number ?? null,
        job_title: a.jobs?.title ?? null,
      }));
      setAppointments(apps);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveThreshold() {
    const v = Number(thresholdDraft.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) {
      toast.error("Ungueltiger Wert");
      return;
    }
    setSavingThreshold(true);
    const { error } = await supabase.from("app_settings").update({ bvg_threshold_chf: v }).eq("id", 1);
    setSavingThreshold(false);
    if (error) {
      toast.error("Speichern fehlgeschlagen: " + error.message);
      return;
    }
    setThreshold(v);
    setEditingThreshold(false);
    toast.success("Schwelle aktualisiert");
  }

  function cellForecast(profileId: string, mIdx: number) {
    const p = profiles.find((x) => x.id === profileId);
    if (!p?.hourly_wage_chf) return null;
    const m = months[mIdx]!;
    const appts: Appointment[] = appointments
      .filter((a) => a.assigned_to === profileId)
      .map((a) => ({ start_time: a.start_time, end_time: a.end_time }));
    return calculateForecast(appts, Number(p.hourly_wage_chf), m.start, m.end);
  }

  function fmtChf(v: number): string {
    return v.toLocaleString("de-CH", { maximumFractionDigits: 0 });
  }

  function statusClass(status: "ok" | "warn" | "crit"): string {
    if (status === "crit") return "bg-red-500/15 dark:bg-red-500/20 border-red-500/40 text-red-700 dark:text-red-300";
    if (status === "warn") return "bg-amber-500/15 dark:bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-300";
    return "bg-green-500/10 dark:bg-green-500/15 border-green-500/30 text-green-700 dark:text-green-300";
  }

  // Drill-down content
  const drillData = drillKey ? (() => {
    const p = profiles.find((x) => x.id === drillKey.profileId);
    const m = months[drillKey.monthIdx]!;
    if (!p?.hourly_wage_chf) return null;
    const appts = appointments.filter((a) => a.assigned_to === drillKey.profileId);
    const periodAppts = appts.filter((a) => {
      const d = a.start_time.slice(0, 10);
      return d >= m.start && d <= m.end;
    });
    const forecast = calculateForecast(
      periodAppts.map((a) => ({ start_time: a.start_time, end_time: a.end_time })),
      Number(p.hourly_wage_chf),
      m.start,
      m.end,
    );
    return { profile: p, month: m, appointments: periodAppts, forecast };
  })() : null;

  return (
    <div className="space-y-4">
      <Card className="bg-card">
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-red-500/15 text-red-600 dark:text-red-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">BVG-Eintrittsschwelle</p>
              <p className="text-xs text-muted-foreground">
                Wer pro Monat brutto mehr als <strong>{fmtChf(threshold)} CHF</strong> verdient wird BVG-pflichtig. Forecast aus geplanten Terminen inkl. Nacht-/Sonntag-Zuschlaegen.
              </p>
            </div>
          </div>
          {editingThreshold ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={thresholdDraft}
                onChange={(e) => setThresholdDraft(e.target.value)}
                className="w-28 h-9 px-3 text-sm rounded-lg border border-border bg-background"
                step="10"
                min="0"
              />
              <button type="button" onClick={saveThreshold} disabled={savingThreshold} className="kasten kasten-green text-xs">
                {savingThreshold ? "Speichert…" : "Speichern"}
              </button>
              <button type="button" onClick={() => { setEditingThreshold(false); setThresholdDraft(String(threshold)); }} className="kasten kasten-muted text-xs">Abbrechen</button>
            </div>
          ) : (
            <button type="button" onClick={() => setEditingThreshold(true)} className="kasten kasten-muted text-xs">
              <Settings className="h-3 w-3" />Anpassen
            </button>
          )}
        </CardContent>
      </Card>

      {/* Tabelle Person x Monat */}
      <Card className="bg-card">
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <p className="p-8 text-sm text-muted-foreground text-center">Lade…</p>
          ) : profiles.length === 0 ? (
            <p className="p-8 text-sm text-muted-foreground text-center">Keine Mitarbeiter mit Stundenlohn.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold sticky left-0 bg-muted/30 min-w-[180px]">Mitarbeiter</th>
                  <th className="text-right px-3 py-3 font-semibold whitespace-nowrap w-24">CHF/h</th>
                  {months.map((m) => (
                    <th key={m.start} className="text-center px-3 py-3 font-semibold min-w-[140px] capitalize">{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profiles.filter((p) => p.hourly_wage_chf && p.hourly_wage_chf > 0).map((p) => (
                  <tr key={p.id} className="border-b border-border/40 last:border-b-0">
                    <td className="px-4 py-2 sticky left-0 bg-card font-medium">{p.full_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{Number(p.hourly_wage_chf).toFixed(2)}</td>
                    {months.map((_, mIdx) => {
                      const f = cellForecast(p.id, mIdx);
                      if (!f) return <td key={mIdx} className="px-3 py-2 text-center text-muted-foreground/40">—</td>;
                      const status = forecastStatus(f.total_chf, threshold);
                      const pct = Math.min(100, Math.round((f.total_chf / threshold) * 100));
                      return (
                        <td key={mIdx} className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => setDrillKey({ profileId: p.id, monthIdx: mIdx })}
                            className={`w-full px-2 py-1.5 rounded-lg border text-left transition-colors hover:brightness-110 ${statusClass(status)}`}
                            title={`${fmtChf(f.total_chf)} / ${fmtChf(threshold)} CHF (${pct}%)`}
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-bold tabular-nums text-sm">{fmtChf(f.total_chf)}</span>
                              <span className="text-[10px] opacity-70">CHF</span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                              <div
                                className={`h-full ${
                                  status === "crit" ? "bg-red-500"
                                  : status === "warn" ? "bg-amber-500"
                                  : "bg-green-500"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <p className="text-[10px] mt-1 opacity-70 tabular-nums">{pct}% · {Math.round(f.total_minutes / 60)}h</p>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Legende */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-green-500/30 border border-green-500/50" /> &lt;70% — sicher
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-amber-500/30 border border-amber-500/50" /> 70-95% — Warnung
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-red-500/30 border border-red-500/50" /> ≥95% — kritisch (BVG-Pflicht droht)
        </span>
      </div>

      {/* Drill-down Modal */}
      <Modal
        open={drillKey !== null}
        onClose={() => setDrillKey(null)}
        title={drillData ? `${drillData.profile.full_name} — ${drillData.month.label}` : ""}
        icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
        size="lg"
      >
        {drillData && (
          <div className="space-y-3">
            {/* Aufschluesselung */}
            <Card className="bg-card">
              <CardContent className="p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Aufschluesselung</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Stunden</p>
                    <p className="font-bold tabular-nums">{(drillData.forecast.total_minutes / 60).toFixed(1)}h</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Basis</p>
                    <p className="font-bold tabular-nums">{fmtChf(drillData.forecast.base_chf)} CHF</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Nacht +25%</p>
                    <p className="font-bold tabular-nums">{fmtChf(drillData.forecast.night_premium_chf)} CHF</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">So/Feier +50%</p>
                    <p className="font-bold tabular-nums">{fmtChf(drillData.forecast.sunhol_premium_chf)} CHF</p>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-border/60 flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Brutto-Forecast</span>
                  <span className="text-lg font-bold tabular-nums">{fmtChf(drillData.forecast.total_chf)} <span className="text-xs text-muted-foreground">/ {fmtChf(threshold)} CHF</span></span>
                </div>
              </CardContent>
            </Card>

            {/* Termine-Liste */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Geplante Termine ({drillData.appointments.length})</p>
              {drillData.appointments.length === 0 ? (
                <p className="text-sm text-muted-foreground italic py-4">Keine geplanten Termine.</p>
              ) : (
                <div className="space-y-1">
                  {drillData.appointments.sort((a, b) => a.start_time.localeCompare(b.start_time)).map((a) => (
                    <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{a.title}</p>
                        <p className="text-muted-foreground">
                          {new Date(a.start_time).toLocaleString("de-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {a.end_time && ` – ${new Date(a.end_time).toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" })}`}
                          {a.job_number && <> · INT-{a.job_number}</>}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
