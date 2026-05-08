"use client";

/**
 * Vertrieb-Liste — Donut-Chart, Filter, Lead-Cards.
 *
 * Detail/Edit eines Leads liegt jetzt auf /vertrieb/[id] (Detail-Page).
 * Hier nur noch:
 *  - Donut + Counts
 *  - Suche + Filter
 *  - "Neuer Lead"-Flow (CategoryPicker → LeadForm-Inline → Insert → redirect)
 *  - Lead-Cards (Klick navigiert zur Detail-Page)
 *
 * Aller edit-spezifische State (Termin/Auftrag/Buchhaltung/Verbesserung/
 * Lost-Modals + Offerte-Upload + advanceStep) ist in den LeadEditor
 * geflossen. /vertrieb/page.tsx ist dadurch von 1066 Zeilen auf ~300
 * runter und hat keine Code-Duplikation mehr.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { deleteRow } from "@/lib/db-mutations";
import { TOAST } from "@/lib/messages";
import { usePermissions } from "@/lib/use-permissions";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import type { VertriebContact, VertriebStatus, VertriebPriority, VertriebKategorie } from "@/types";
import { Plus, TrendingUp, Search, Archive } from "lucide-react";
import { toast } from "sonner";
import { STATUS_OPTIONS, PRIORITY_OPTIONS, KATEGORIE_OPTIONS, emptyForm } from "./constants";
import { LeadCard } from "@/components/vertrieb/lead-card";
import { LeadForm } from "@/components/vertrieb/lead-form";
import { CategoryPicker } from "@/components/vertrieb/category-picker";
import { useConfirm } from "@/components/ui/use-confirm";
import { SearchableSelect } from "@/components/searchable-select";

type Counts = {
  total: number; offen: number; kontaktiert: number; gespraech: number;
  gewonnen: number; abgesagt: number; step_1: number; step_2: number;
  step_3: number; step_4: number;
};

export default function VertriebPage() {
  const router = useRouter();
  const supabase = createClient();
  const { can } = usePermissions();
  const { confirm, ConfirmModalElement } = useConfirm();

  // Daten
  const [contacts, setContacts] = useState<VertriebContact[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string; email: string | null; phone: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  // Suche/Filter
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<VertriebStatus | "all">("all");
  const [filterPriority, setFilterPriority] = useState<VertriebPriority | "all">("all");
  const [filterKategorie, setFilterKategorie] = useState<VertriebKategorie | "all">("all");

  // Archiv-Modus: zeigt ausschliesslich abgesagte Leads. Persistent damit
  // ein versehentlicher Reload den Modus nicht verliert. Pattern uebernommen
  // vom Operations-Archiv (auftraege/page.tsx).
  const [showArchive, setShowArchive] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("vertrieb-archive") === "true" : false,
  );
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("vertrieb-archive", String(showArchive));
  }, [showArchive]);

  // Add-Flow (Inline) — Lead-NEU bleibt hier weil's nur 3 State-Variablen sind.
  const [showForm, setShowForm] = useState(false);
  const [categoryPicked, setCategoryPicked] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [visibleBedarf, setVisibleBedarf] = useState<Set<string>>(new Set());
  const [kundenMode, setKundenMode] = useState<"neu" | "bestehend">("neu");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("realtime:vertrieb_contacts", handler);
    return () => window.removeEventListener("realtime:vertrieb_contacts", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    const [{ data }, custRes, countsRes] = await Promise.all([
      supabase.from("vertrieb_contacts").select("*").order("nr").limit(2000),
      supabase.from("customers").select("id, name, email, phone").eq("is_active", true).order("name"),
      supabase.from("vertrieb_counts").select("*").single(),
    ]);
    if (data) setContacts(data as VertriebContact[]);
    if (custRes.data) setCustomers(custRes.data);
    if (countsRes.data) setCounts(countsRes.data);
    setLoading(false);
  }

  function openNew() {
    setForm(emptyForm);
    setCategoryPicked(false);
    setKundenMode("neu");
    setSelectedCustomerId("");
    setVisibleBedarf(new Set());
    setShowForm(true);
  }

  function pickCategory(kategorie: VertriebKategorie) {
    setForm({ ...emptyForm, kategorie });
    setCategoryPicked(true);
  }

  function selectExistingCustomer(customerId: string) {
    setSelectedCustomerId(customerId);
    const c = customers.find((x) => x.id === customerId);
    if (c) setForm((f) => ({ ...f, firma: c.name, email: c.email || "", telefon: c.phone || "", create_customer: false }));
  }

  function closeForm() {
    setShowForm(false);
    setCategoryPicked(false);
  }

  /** Lead anlegen — Insert + ggf. Customer anlegen + Navigation zur Detail-Page. */
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    // Details JSON-encoden — wie bisher, aber nur fuer Insert (kein Update mehr).
    const details: Record<string, unknown> = {};
    if (form.event_start) details.event_start = form.event_start;
    if (form.event_end) details.event_end = form.event_end;
    if (form.kategorie === "verwaltung") {
      if (form.infrastruktur) details.infrastruktur = form.infrastruktur;
      if (form.ort) details.ort = form.ort;
      if (form.zielgruppe) details.zielgruppe = form.zielgruppe;
      if (form.programm) details.programm = form.programm;
      if (form.bedarf_vor_ort) details.bedarf_vor_ort = form.bedarf_vor_ort;
    } else {
      const filteredBedarf: Record<string, string> = {};
      Object.entries(form.bedarf).forEach(([k, v]) => { if (v?.trim()) filteredBedarf[k] = v; });
      if (Object.keys(filteredBedarf).length > 0) details.bedarf = filteredBedarf;
    }
    const notizenStored = (Object.keys(details).length > 0 || form.notizen)
      ? JSON.stringify({ _text: form.notizen, _details: details })
      : null;

    const payload = {
      firma: form.firma,
      branche: form.branche || null,
      ansprechperson: form.ansprechperson || null,
      position: form.position || null,
      email: form.email || null,
      telefon: form.telefon || null,
      event_typ: form.event_typ || null,
      status: form.status,
      datum_kontakt: form.datum_kontakt || null,
      notizen: notizenStored,
      prioritaet: form.prioritaet,
      kategorie: form.kategorie,
    };

    const { data: inserted, error } = await supabase.from("vertrieb_contacts").insert(payload).select("id").single();
    if (error || !inserted) { TOAST.supabaseError(error); setSaving(false); return; }

    if (form.create_customer && form.firma) {
      const { data: existing } = await supabase.from("customers").select("id").eq("name", form.firma).maybeSingle();
      if (!existing) {
        await supabase.from("customers").insert({
          name: form.firma, type: "company",
          email: form.email || null, phone: form.telefon || null,
          notes: form.ansprechperson ? `Ansprechperson: ${form.ansprechperson}${form.position ? ` (${form.position})` : ""}` : null,
        });
        toast.success("Eintrag erstellt · Kunde angelegt");
      } else {
        toast.success("Eintrag erstellt · Kunde existiert bereits");
      }
    } else {
      toast.success("Eintrag erstellt");
    }

    setShowForm(false);
    setCategoryPicked(false);
    setForm(emptyForm);
    setSaving(false);
    // Direkt zur Detail-Page des neuen Leads — User kann dort weiter editieren
    router.push(`/vertrieb/${inserted.id}`);
  }

  async function deleteContact(id: string) {
    const ok = await confirm({ title: "Lead löschen?", confirmLabel: "Löschen", variant: "red" });
    if (!ok) return;
    const result = await deleteRow("vertrieb_contacts", id);
    if (!result.ok) { toast.error("Löschen fehlgeschlagen: " + (result.error ?? "Unbekannt")); return; }
    toast.success("Eintrag gelöscht");
    load();
  }

  // No-op edit-handlers — LeadForm braucht alle Props auch im Add-Modus,
  // aber dort werden die advanceStep/lost/buchhaltung/etc-Buttons schon
  // aufgrund von editingId=null nicht gerendert.
  const noop = () => {};
  const noopAsync = async () => {};

  const filtered = contacts
    // Archiv-Trennung: Standard-View blendet 'abgesagt' aus, Archiv-View
    // zeigt ausschliesslich 'abgesagt'.
    .filter((c) => showArchive ? c.status === "abgesagt" : c.status !== "abgesagt")
    .filter((c) => filterKategorie === "all" || c.kategorie === filterKategorie)
    .filter((c) => filterStatus === "all" || c.status === filterStatus)
    .filter((c) => filterPriority === "all" || c.prioritaet === filterPriority)
    .filter((c) => {
      const q = search.toLowerCase();
      return !q || c.firma.toLowerCase().includes(q) || (c.ansprechperson || "").toLowerCase().includes(q) || (c.branche || "").toLowerCase().includes(q);
    });

  const statusCounts: Record<string, number> = counts ? {
    offen: counts.offen, kontaktiert: counts.kontaktiert, gespraech: counts.gespraech,
    gewonnen: counts.gewonnen, abgesagt: counts.abgesagt,
  } : {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{showArchive ? "Vertrieb Archiv" : "Vertrieb"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {showArchive
              ? `${statusCounts.abgesagt || 0} abgesagte Leads`
              : `${(counts?.total ?? 0) - (statusCounts.abgesagt || 0)} aktive Kontakte · ${statusCounts.gewonnen || 0} gewonnen · ${statusCounts.offen || 0} offen`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              // Beim Wechsel den Status-Filter zuruecksetzen — sonst koennte
              // ein "abgesagt"-Filter aus alter Session ins Archiv mitgehen
              // und dort leere Resultate produzieren.
              setFilterStatus("all");
              setShowArchive(!showArchive);
            }}
            className={showArchive ? "kasten-active" : "kasten-toggle-off"}
          >
            <Archive className="h-3.5 w-3.5" />
            {showArchive ? "Aktive anzeigen" : `Archiv (${statusCounts.abgesagt || 0})`}
          </button>
          {!showArchive && can("vertrieb:create") && (
            <button type="button" onClick={openNew} className="kasten kasten-red">
              <Plus className="h-3.5 w-3.5" />Lead
            </button>
          )}
        </div>
      </div>

      {/* Donut-Chart — im Archiv ausgeblendet (alle Karten haben gleichen Status). */}
      {!showArchive && counts && counts.total > 0 && <DonutChart counts={counts} />}

      {/* Suche + Filter */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Firma, Person oder Branche..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 bg-card" />
        </div>
        <div className="w-full sm:w-44">
          <SearchableSelect
            value={filterKategorie} onChange={(v) => setFilterKategorie(v as VertriebKategorie | "all")}
            items={[{ id: "all", label: "Alle Kategorien" }, ...KATEGORIE_OPTIONS.map((k) => ({ id: k.value, label: k.label }))]}
            searchable={false} clearable={false} active={filterKategorie !== "all"}
          />
        </div>
        {!showArchive && (
          <div className="w-full sm:w-44">
            <SearchableSelect
              value={filterStatus} onChange={(v) => setFilterStatus(v as VertriebStatus | "all")}
              items={[
                { id: "all", label: "Alle Status" },
                // 'abgesagt' raus — dafuer gibt's das Archiv.
                ...STATUS_OPTIONS.filter((s) => s.value !== "abgesagt").map((s) => ({ id: s.value, label: `${s.label} (${statusCounts[s.value] || 0})` })),
              ]}
              searchable={false} clearable={false} active={filterStatus !== "all"}
            />
          </div>
        )}
        <div className="w-full sm:w-44">
          <SearchableSelect
            value={filterPriority} onChange={(v) => setFilterPriority(v as VertriebPriority | "all")}
            items={[{ id: "all", label: "Alle Prioritäten" }, ...PRIORITY_OPTIONS.map((p) => ({ id: p.value, label: p.label }))]}
            searchable={false} clearable={false} active={filterPriority !== "all"}
          />
        </div>
      </div>

      {/* Add-Flow inline (CategoryPicker → LeadForm). Edit lebt auf /vertrieb/[id]. */}
      {showForm && !categoryPicked && (
        <CategoryPicker onPick={pickCategory} onClose={() => { setShowForm(false); setCategoryPicked(false); }} />
      )}
      {showForm && categoryPicked && (
        <LeadForm
          editingId={null}
          editingStep={1}
          form={form}
          setForm={setForm}
          saving={saving}
          offertePdf={null}
          uploadingOfferte={false}
          sendingBestaetigung={false}
          visibleBedarf={visibleBedarf}
          setVisibleBedarf={setVisibleBedarf}
          kundenMode={kundenMode}
          setKundenMode={setKundenMode}
          selectedCustomerId={selectedCustomerId}
          setSelectedCustomerId={setSelectedCustomerId}
          customers={customers}
          contacts={contacts}
          onSubmit={save}
          onClose={closeForm}
          onAdvanceStep={noopAsync}
          onOpenLost={noop}
          onOpenBuchhaltung={noop}
          onOpenVerbesserung={noop}
          onOpenTermin={noop}
          onDeleteTermin={noopAsync}
          onUploadOfferte={noopAsync}
          onRemoveOfferte={noopAsync}
          onSendBestaetigung={noopAsync}
          onOpenAuftrag={noop}
          onSelectExistingCustomer={selectExistingCustomer}
          currentContactWithDetails={() => null}
        />
      )}

      {/* Liste */}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Card key={i} className="animate-pulse bg-card"><CardContent className="p-4"><div className="h-5 bg-gray-200 rounded w-1/3" /></CardContent></Card>)}</div>
      ) : filtered.length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="py-16 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              {showArchive ? <Archive className="h-7 w-7 text-gray-400" /> : <TrendingUp className="h-7 w-7 text-gray-400" />}
            </div>
            <h3 className="font-semibold text-lg">{showArchive ? "Keine abgesagten Leads" : "Keine Kontakte"}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {showArchive ? "Hier landen Leads sobald sie auf 'abgesagt' gesetzt werden." : "Erstelle deinen ersten Kontakt."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <LeadCard
              key={c.id}
              contact={c}
              onClick={(c2) => router.push(`/vertrieb/${c2.id}`)}
              onDelete={deleteContact}
              canDelete={can("vertrieb:delete")}
            />
          ))}
        </div>
      )}
      {ConfirmModalElement}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Donut-Chart — eigenes Sub-Component damit die Hauptpage nicht so lang ist.
 * Logik unveraendert vom vorherigen Inline-Code.
 * -------------------------------------------------------------------------- */
function DonutChart({ counts }: { counts: Counts }) {
  const segments = [
    { label: "Schritt 1: Offen", count: counts.step_1, color: "var(--status-gray)" },
    { label: "Schritt 2: Kontaktiert", count: counts.step_2, color: "var(--status-blue)" },
    { label: "Schritt 3: Finalisierung", count: counts.step_3, color: "var(--status-orange)" },
    { label: "Schritt 4: Operations", count: counts.step_4, color: "var(--status-emerald)" },
    { label: "Gewonnen", count: counts.gewonnen, color: "var(--status-green)" },
    { label: "Verloren", count: counts.abgesagt, color: "var(--status-red)" },
  ].filter((s) => s.count > 0);

  const total = segments.reduce((sum, s) => sum + s.count, 0);
  const radius = 72;
  const ringWidth = 18;
  const outerR = radius + ringWidth / 2;
  const innerR = radius - ringWidth / 2;
  const ringDiff = outerR - innerR;
  const outlineWidth = 2;
  const svgPad = Math.ceil(outlineWidth / 2) + 1;
  const cx = outerR + svgPad;
  const cy = outerR + svgPad;
  const svgSize = outerR * 2 + svgPad * 2;
  const gapAngle = segments.length > 1 ? 0.08 : 0;
  let cumulativeGapMid = -Math.PI / 2;

  return (
    <Card className="bg-card">
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row items-start gap-6">
          <div className="relative shrink-0">
            <svg width={svgSize} height={svgSize}>
              <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="currentColor" strokeWidth={1} className="text-foreground/[0.08]" />
              <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="currentColor" strokeWidth={1} className="text-foreground/[0.08]" />
              {segments.length === 1 ? (
                <>
                  <circle cx={cx} cy={cy} r={outerR} fill="none" stroke={segments[0].color} strokeWidth={outlineWidth} />
                  <circle cx={cx} cy={cy} r={innerR} fill="none" stroke={segments[0].color} strokeWidth={outlineWidth} />
                </>
              ) : (
                segments.map((s, i) => {
                  const portion = s.count / total;
                  const segAngle = portion * 2 * Math.PI - gapAngle;
                  const gapMidPrev = cumulativeGapMid;
                  const startA = gapMidPrev + gapAngle / 2;
                  const endA = startA + segAngle;
                  const gapMidNext = endA + gapAngle / 2;
                  cumulativeGapMid = gapMidNext;
                  const ox1 = cx + outerR * Math.cos(startA);
                  const oy1 = cy + outerR * Math.sin(startA);
                  const ox2 = cx + outerR * Math.cos(endA);
                  const oy2 = cy + outerR * Math.sin(endA);
                  const ix1u = ox1 - ringDiff * Math.cos(gapMidPrev);
                  const iy1u = oy1 - ringDiff * Math.sin(gapMidPrev);
                  const innerStartAngle = Math.atan2(iy1u - cy, ix1u - cx);
                  const ix1 = cx + innerR * Math.cos(innerStartAngle);
                  const iy1 = cy + innerR * Math.sin(innerStartAngle);
                  const ix2u = ox2 - ringDiff * Math.cos(gapMidNext);
                  const iy2u = oy2 - ringDiff * Math.sin(gapMidNext);
                  const innerEndAngle = Math.atan2(iy2u - cy, ix2u - cx);
                  const ix2 = cx + innerR * Math.cos(innerEndAngle);
                  const iy2 = cy + innerR * Math.sin(innerEndAngle);
                  const largeArc = segAngle > Math.PI ? 1 : 0;
                  const d = `M ${ox1} ${oy1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
                  return <path key={i} d={d} fill={s.color} stroke={s.color} strokeWidth={outlineWidth} strokeLinejoin="round" className="donut-segment" />;
                })
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[34px] font-bold leading-none tracking-tight">{total}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Leads</span>
            </div>
          </div>

          <div className="flex-1 w-full space-y-2.5">
            {segments.map((s) => {
              const pct = total > 0 ? (s.count / total) * 100 : 0;
              return (
                <div key={s.label} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">{s.label}</span>
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        <strong className="text-foreground">{s.count}</strong> · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-[2px] rounded-full bg-foreground/[0.05] overflow-hidden mt-1.5">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
