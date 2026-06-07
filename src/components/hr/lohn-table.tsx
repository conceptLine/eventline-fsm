"use client";

/**
 * Lohntabelle — Admin/HR-View pro Eventline-Mitarbeiter:
 *   Brutto-Stundenlohn  ·  Arbeitgeber-Anteil  ·  Vollkosten/h
 *
 * Quelle: /api/hr/compensation (RLS via lohn:manage, Admin laeuft durch).
 * Vorher als eigene Seite /hr/lohn gelebt — jetzt eingebettet im HR-
 * Hub unter Tab "Löhne", weil Lohn-Verwaltung Teil des HR-Bereichs ist
 * (statt eigener Sub-Route die nochmal vom Hub aus angeklickt werden muss).
 *
 * Edit-Flow: Click "Bearbeiten" → Modal → Save schliesst die alte
 * Lohnzeile (effective_to) und legt eine neue an. So bleibt die Historie
 * sauber fuer rueckwirkende Aggregationen.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Wallet, Pencil } from "lucide-react";
import { toast } from "sonner";
import { TOAST } from "@/lib/messages";

interface EmployeeRow {
  profile_id: string;
  full_name: string;
  role: string;
  email: string;
  compensation: {
    id: string;
    hourly_wage_chf: number;
    employer_costs_chf_per_hour: number;
    effective_from: string;
    notes: string | null;
  } | null;
}

const CHF = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function LohnTable() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit-Modal
  const [editTarget, setEditTarget] = useState<EmployeeRow | null>(null);
  const [editWage, setEditWage] = useState("");
  const [editEmployer, setEditEmployer] = useState("");
  const [editFrom, setEditFrom] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/hr/compensation");
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || "Mitarbeiter konnten nicht geladen werden");
      setLoading(false);
      return;
    }
    setEmployees(json.employees as EmployeeRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(emp: EmployeeRow) {
    setEditTarget(emp);
    setEditWage(emp.compensation ? String(emp.compensation.hourly_wage_chf) : "");
    setEditEmployer(emp.compensation ? String(emp.compensation.employer_costs_chf_per_hour) : "");
    setEditFrom(emp.compensation?.effective_from ?? new Date().toISOString().slice(0, 10));
    setEditNotes(emp.compensation?.notes ?? "");
  }

  function closeEdit() {
    if (saving) return;
    setEditTarget(null);
  }

  async function handleSave() {
    if (!editTarget) return;
    const wage = parseFloat(editWage.replace(",", "."));
    const employer = parseFloat(editEmployer.replace(",", ".")) || 0;
    if (!Number.isFinite(wage) || wage < 0) {
      TOAST.requiredField("Stundenlohn");
      return;
    }
    if (!editFrom) {
      TOAST.requiredField("Gültig ab");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/hr/compensation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: editTarget.profile_id,
          hourly_wage_chf: wage,
          employer_costs_chf_per_hour: employer,
          effective_from: editFrom,
          notes: editNotes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error || "Speichern fehlgeschlagen");
        return;
      }
      toast.success("Gespeichert");
      setEditTarget(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Lohntabelle</h2>
        <p className="text-xs text-muted-foreground">
          Pro Mitarbeiter Brutto-Stundenlohn + Arbeitgeber-Anteil.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Lade ...</div>
          ) : employees.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Keine Mitarbeiter.</div>
          ) : (
            <div className="divide-y">
              <div className="hidden md:flex items-center gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <div className="flex-1">Mitarbeiter</div>
                <div className="w-28 text-right">Brutto / h</div>
                <div className="w-28 text-right">Arbeitgeber / h</div>
                <div className="w-28 text-right">Vollkosten / h</div>
                <div className="w-24 text-right">Gültig ab</div>
                <div className="w-10" />
              </div>
              {employees.map((emp) => (
                <LohnRow key={emp.profile_id} emp={emp} onEdit={() => openEdit(emp)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit-Modal */}
      <Modal
        open={!!editTarget}
        onClose={closeEdit}
        title={editTarget ? `${editTarget.full_name} — Lohn` : ""}
        icon={<Wallet className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
        size="md"
        closable={!saving}
      >
        {editTarget && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Brutto-Stundenlohn (CHF)</label>
              <Input
                type="text"
                inputMode="decimal"
                value={editWage}
                onChange={(e) => setEditWage(e.target.value)}
                placeholder="z.B. 22.50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Arbeitgeber-Anteil pro Stunde (CHF)
              </label>
              <Input
                type="text"
                inputMode="decimal"
                value={editEmployer}
                onChange={(e) => setEditEmployer(e.target.value)}
                placeholder="z.B. 5.54"
              />
              <p className="text-[11px] text-muted-foreground">
                AHV/BVG/UVG/FAK + ggf. Spesen-Pauschale. Der Mitarbeiter sieht diesen Wert nicht.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Gültig ab</label>
              <Input type="date" value={editFrom} onChange={(e) => setEditFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Notiz (optional)</label>
              <Input
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="z.B. 'Anpassung BVG ab 2026'"
                maxLength={200}
              />
            </div>
            <VollkostenPreview wage={editWage} employer={editEmployer} />
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={closeEdit} disabled={saving} className="kasten kasten-muted flex-1">
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !editWage.trim() || !editFrom}
                className="kasten kasten-green flex-1"
              >
                {saving ? "Speichere ..." : "Speichern"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function LohnRow({ emp, onEdit }: { emp: EmployeeRow; onEdit: () => void }) {
  const [hover, setHover] = useState(false);
  const c = emp.compensation;
  const vollkosten = c ? c.hourly_wage_chf + c.employer_costs_chf_per_hour : null;

  return (
    <div
      className="flex flex-col md:flex-row md:items-center gap-2 py-3 px-4 transition-colors"
      style={hover ? { backgroundColor: "var(--muted)" } : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{emp.full_name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {emp.role} · {emp.email}
        </div>
      </div>
      <div className="w-28 text-right text-sm tabular-nums">
        {c ? `CHF ${CHF.format(c.hourly_wage_chf)}` : <span className="text-muted-foreground">–</span>}
      </div>
      <div className="w-28 text-right text-sm tabular-nums text-muted-foreground">
        {c ? `CHF ${CHF.format(c.employer_costs_chf_per_hour)}` : "–"}
      </div>
      <div className="w-28 text-right text-sm tabular-nums font-semibold">
        {vollkosten !== null ? `CHF ${CHF.format(vollkosten)}` : <span className="font-normal text-muted-foreground">–</span>}
      </div>
      <div className="w-24 text-right text-xs text-muted-foreground tabular-nums">
        {c ? new Date(c.effective_from + "T00:00:00").toLocaleDateString("de-CH") : "–"}
      </div>
      <div className="w-10 flex justify-end">
        <button
          type="button"
          onClick={onEdit}
          className="p-1 rounded hover:bg-foreground/10 text-muted-foreground"
          data-tooltip={c ? "Bearbeiten" : "Lohn anlegen"}
          data-tooltip-align="end"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function VollkostenPreview({ wage, employer }: { wage: string; employer: string }) {
  const w = parseFloat(wage.replace(",", "."));
  const e = parseFloat(employer.replace(",", ".")) || 0;
  if (!Number.isFinite(w) || w < 0) return null;
  const vollkosten = w + e;
  return (
    <div className="flex items-baseline justify-between p-3 rounded-lg bg-muted/40 text-sm">
      <span className="text-muted-foreground">Vollkosten / h</span>
      <span className="font-semibold tabular-nums">CHF {CHF.format(vollkosten)}</span>
    </div>
  );
}
