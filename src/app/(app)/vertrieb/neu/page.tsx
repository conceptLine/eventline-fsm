"use client";

/**
 * /vertrieb/neu — schlanker Lead-Anlege-Workflow.
 *
 * Layout: eine zentrierte Card, klare Hierarchie:
 *   1. Kategorie-Pick (2 Buttons oben)
 *   2. Pflicht- und Kontakt-Felder
 *   3. Mehr-Details-Aufklappbereich (Branche, Event-Datum,
 *      Verwaltungs-/Bedarf-Sektion je nach Kategorie)
 *   4. Notizen
 *   5. Submit-Bar
 *
 * Default-Werte: status='offen', prioritaet='mittel', datum_kontakt=heute.
 * Werden im Detail-Editor spaeter angepasst.
 *
 * Submit:
 *   - Pflicht: Kategorie + Firma
 *   - INSERT vertrieb_contacts + optional INSERT customers
 *   - Navigation: /vertrieb?lead=<id> (oeffnet direkt den Detail-Bereich
 *     in der Haupt-Cockpit-Page).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TOAST } from "@/lib/messages";
import { BackButton } from "@/components/ui/back-button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Building2, PartyPopper, Plus, ChevronDown, ChevronUp, Check } from "lucide-react";
import { toast } from "sonner";
import { BEDARF_BEREICHE } from "@/app/(app)/vertrieb/constants";
import type { VertriebKategorie } from "@/types";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface Draft {
  kategorie: VertriebKategorie | null;
  firma: string;
  ansprechperson: string;
  position: string;
  email: string;
  telefon: string;
  branche: string;
  event_typ: string;
  event_start: string;
  event_end: string;
  // Verwaltung-spezifisch
  infrastruktur: string;
  ort: string;
  zielgruppe: string;
  programm: string;
  bedarf_vor_ort: string;
  // Veranstaltung-spezifisch
  bedarf: Record<string, string>;
  notizen: string;
  // Kontakt-Anbindung
  existing_customer_id: string;
  create_customer: boolean;
}

const EMPTY_DRAFT: Draft = {
  kategorie: null,
  firma: "", ansprechperson: "", position: "", email: "", telefon: "",
  branche: "", event_typ: "", event_start: "", event_end: "",
  infrastruktur: "", ort: "", zielgruppe: "", programm: "", bedarf_vor_ort: "",
  bedarf: {},
  notizen: "",
  existing_customer_id: "",
  create_customer: true,
};

export default function NeuerLeadPage() {
  const router = useRouter();
  const supabase = createClient();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, email, phone")
        .eq("is_active", true)
        .order("name");
      if (data) setCustomers(data as Customer[]);
    })();
  }, [supabase]);

  function pickCategory(k: VertriebKategorie) {
    setDraft((d) => ({ ...d, kategorie: k }));
  }

  function pickExistingCustomer(id: string) {
    if (!id) {
      setDraft((d) => ({ ...d, existing_customer_id: "", create_customer: true }));
      return;
    }
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    setDraft((d) => ({
      ...d,
      existing_customer_id: id,
      firma: c.name,
      email: c.email || d.email,
      telefon: c.phone || d.telefon,
      create_customer: false,
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!draft.kategorie) {
      toast.error("Kategorie wählen");
      return;
    }
    if (!draft.firma.trim()) {
      toast.error("Firma ist Pflicht");
      return;
    }
    setSaving(true);

    // Details als JSON in notizen — selbes Format wie bisher.
    const details: Record<string, unknown> = {};
    if (draft.event_start) details.event_start = draft.event_start;
    if (draft.event_end) details.event_end = draft.event_end;
    if (draft.kategorie === "verwaltung") {
      if (draft.infrastruktur) details.infrastruktur = draft.infrastruktur;
      if (draft.ort) details.ort = draft.ort;
      if (draft.zielgruppe) details.zielgruppe = draft.zielgruppe;
      if (draft.programm) details.programm = draft.programm;
      if (draft.bedarf_vor_ort) details.bedarf_vor_ort = draft.bedarf_vor_ort;
    } else {
      const filteredBedarf: Record<string, string> = {};
      Object.entries(draft.bedarf).forEach(([k, v]) => { if (v?.trim()) filteredBedarf[k] = v; });
      if (Object.keys(filteredBedarf).length > 0) details.bedarf = filteredBedarf;
    }
    const notizenStored = (Object.keys(details).length > 0 || draft.notizen)
      ? JSON.stringify({ _text: draft.notizen, _details: details })
      : null;

    // Default-Werte fuer Status/Prio/datum_kontakt — User passt im Detail-
    // Editor an, wenn anders gewuenscht.
    const todayIso = new Date().toISOString().slice(0, 10);

    const { data: inserted, error } = await supabase
      .from("vertrieb_contacts")
      .insert({
        firma: draft.firma.trim(),
        branche: draft.branche.trim() || null,
        ansprechperson: draft.ansprechperson.trim() || null,
        position: draft.position.trim() || null,
        email: draft.email.trim() || null,
        telefon: draft.telefon.trim() || null,
        event_typ: draft.event_typ.trim() || null,
        status: "offen",
        prioritaet: "mittel",
        kategorie: draft.kategorie,
        datum_kontakt: todayIso,
        notizen: notizenStored,
      })
      .select("id")
      .single();
    if (error || !inserted) { TOAST.supabaseError(error); setSaving(false); return; }

    if (draft.create_customer && draft.firma.trim()) {
      const { data: existing } = await supabase.from("customers").select("id").eq("name", draft.firma.trim()).maybeSingle();
      if (!existing) {
        await supabase.from("customers").insert({
          name: draft.firma.trim(), type: "company",
          email: draft.email.trim() || null,
          phone: draft.telefon.trim() || null,
          notes: draft.ansprechperson.trim()
            ? `Ansprechperson: ${draft.ansprechperson.trim()}${draft.position.trim() ? ` (${draft.position.trim()})` : ""}`
            : null,
        });
        toast.success("Lead erstellt · Kunde angelegt");
      } else {
        toast.success("Lead erstellt · Kunde existiert bereits");
      }
    } else {
      toast.success("Lead erstellt");
    }

    setSaving(false);
    router.push(`/vertrieb?lead=${inserted.id}`);
  }

  const isEvent = draft.kategorie === "veranstaltung";
  const isVerwaltung = draft.kategorie === "verwaltung";

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <BackButton fallbackHref="/vertrieb" size="sm" />
        <span className="font-mono text-xl font-semibold text-muted-foreground">LEAD-NEU</span>
      </div>

      <form onSubmit={save} className="space-y-3">
        {/* === Kategorie === */}
        <Card className="bg-card">
          <CardContent className="p-4">
            <SectionLabel>Kategorie *</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <CategoryButton
                active={isEvent}
                onClick={() => pickCategory("veranstaltung")}
                icon={<PartyPopper className="h-5 w-5" />}
                label="Veranstaltung"
                sub="Sommerfest, Jahresanlass, Event"
              />
              <CategoryButton
                active={isVerwaltung}
                onClick={() => pickCategory("verwaltung")}
                icon={<Building2 className="h-5 w-5" />}
                label="Verwaltung"
                sub="Verwaltung, Immobilien, WEG"
              />
            </div>
          </CardContent>
        </Card>

        {/* === Pflicht + Kontakt === */}
        <Card className="bg-card">
          <CardContent className="p-4 space-y-3">
            {/* Bestandskunde-Auswahl als Quick-Picker */}
            {customers.length > 0 && (
              <div>
                <SectionLabel>Bestandskunde übernehmen?</SectionLabel>
                <select
                  value={draft.existing_customer_id}
                  onChange={(e) => pickExistingCustomer(e.target.value)}
                  className="w-full h-9 px-3 text-sm rounded-lg border border-border bg-background"
                >
                  <option value="">— Neuer Kontakt —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            <Field label="Firma *" required>
              <Input value={draft.firma} onChange={(e) => setDraft({ ...draft, firma: e.target.value })} placeholder="Firmenname" autoFocus />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Ansprechperson">
                <Input value={draft.ansprechperson} onChange={(e) => setDraft({ ...draft, ansprechperson: e.target.value })} placeholder="Vor- und Nachname" />
              </Field>
              <Field label="Position">
                <Input value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} placeholder="z.B. Geschäftsführer" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="E-Mail">
                <Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="mail@firma.ch" />
              </Field>
              <Field label="Telefon">
                <Input type="tel" value={draft.telefon} onChange={(e) => setDraft({ ...draft, telefon: e.target.value })} placeholder="079…" />
              </Field>
            </div>

            {!draft.existing_customer_id && draft.firma && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer pt-1">
                <input
                  type="checkbox" className="h-3.5 w-3.5"
                  checked={draft.create_customer}
                  onChange={(e) => setDraft({ ...draft, create_customer: e.target.checked })}
                />
                Kontakt zusätzlich als Kunden anlegen ({draft.firma})
              </label>
            )}
          </CardContent>
        </Card>

        {/* === Mehr Details (Aufklapp) === */}
        <Card className="bg-card">
          <CardContent className="p-4">
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="w-full flex items-center justify-between text-sm font-medium text-foreground"
            >
              <span>Mehr Details</span>
              {showMore ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showMore && (
              <div className="space-y-3 pt-3 mt-3 border-t border-border/60">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Branche">
                    <Input value={draft.branche} onChange={(e) => setDraft({ ...draft, branche: e.target.value })} />
                  </Field>
                  {isEvent && (
                    <Field label="Event-Typ">
                      <Input value={draft.event_typ} onChange={(e) => setDraft({ ...draft, event_typ: e.target.value })} placeholder="Hochzeit, Konzert…" />
                    </Field>
                  )}
                </div>

                {isEvent && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Event-Datum Start">
                      <Input type="date" value={draft.event_start} onChange={(e) => setDraft({ ...draft, event_start: e.target.value })} />
                    </Field>
                    <Field label="Event-Datum Ende">
                      <Input type="date" value={draft.event_end} onChange={(e) => setDraft({ ...draft, event_end: e.target.value })} />
                    </Field>
                  </div>
                )}

                {isVerwaltung && (
                  <>
                    <Field label="Ort">
                      <Input value={draft.ort} onChange={(e) => setDraft({ ...draft, ort: e.target.value })} placeholder="Adresse oder Bezeichnung" />
                    </Field>
                    <Field label="Gegebene Infrastruktur">
                      <Textarea value={draft.infrastruktur} onChange={(v) => setDraft({ ...draft, infrastruktur: v })} placeholder="Saal, Technik, Parkplätze…" />
                    </Field>
                    <Field label="Zielgruppe">
                      <Input value={draft.zielgruppe} onChange={(e) => setDraft({ ...draft, zielgruppe: e.target.value })} placeholder="Wer wird erreicht?" />
                    </Field>
                    <Field label="Programm">
                      <Textarea value={draft.programm} onChange={(v) => setDraft({ ...draft, programm: v })} placeholder="Geplantes Programm / Ablauf…" />
                    </Field>
                    <Field label="Bedarf vor Ort">
                      <Textarea value={draft.bedarf_vor_ort} onChange={(v) => setDraft({ ...draft, bedarf_vor_ort: v })} placeholder="Was muss zusätzlich beschafft werden?" />
                    </Field>
                  </>
                )}

                {isEvent && (
                  <div>
                    <SectionLabel>Bedarf</SectionLabel>
                    <div className="grid grid-cols-2 gap-2">
                      {BEDARF_BEREICHE.map((b) => (
                        <BedarfChip
                          key={b.key}
                          label={b.label}
                          value={draft.bedarf[b.key] || ""}
                          onChange={(v) => setDraft({ ...draft, bedarf: { ...draft.bedarf, [b.key]: v } })}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* === Notizen === */}
        <Card className="bg-card">
          <CardContent className="p-4">
            <Field label="Notizen">
              <Textarea
                value={draft.notizen}
                onChange={(v) => setDraft({ ...draft, notizen: v })}
                placeholder={isVerwaltung
                  ? "Wie ist die aktuelle Situation? Was sind die Herausforderungen?"
                  : "Was ist sonst noch wichtig?"}
                rows={isVerwaltung ? 6 : 3}
              />
            </Field>
          </CardContent>
        </Card>

        {/* === Submit === */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.push("/vertrieb")}
            className="kasten kasten-muted flex-1"
            disabled={saving}
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={saving || !draft.kategorie || !draft.firma.trim()}
            className="kasten kasten-red flex-1"
          >
            {saving ? <>Speichern…</> : <><Plus className="h-3.5 w-3.5" />Lead erstellen</>}
          </button>
        </div>
      </form>
    </div>
  );
}

// =====================================================
// Sub-Komponenten
// =====================================================

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
      {children}
    </p>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{ fieldSizing: "content" } as React.CSSProperties}
      className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring/40"
    />
  );
}

function CategoryButton({ active, onClick, icon, label, sub }: {
  active: boolean; onClick: () => void;
  icon: React.ReactNode; label: string; sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-3 rounded-lg border-2 text-left transition-colors ${
        active
          ? "border-red-500 bg-red-500/10"
          : "border-border bg-card hover:border-foreground/30"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className={active ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>
          {icon}
        </div>
        {active && <Check className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />}
      </div>
      <p className={`text-sm font-semibold ${active ? "text-red-700 dark:text-red-300" : ""}`}>{label}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
    </button>
  );
}

function BedarfChip({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [expanded, setExpanded] = useState(!!value);
  const filled = value.trim().length > 0;
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`w-full px-2.5 py-1.5 rounded-md text-xs font-medium text-left transition-colors flex items-center justify-between ${
          filled
            ? "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/40"
            : "bg-muted text-foreground hover:bg-muted/70"
        }`}
      >
        <span>{label}{filled && " ✓"}</span>
        <span className="text-[10px]">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Details zu ${label}…`}
          className="mt-1 w-full px-2 py-1 text-xs rounded border border-border bg-background"
        />
      )}
    </div>
  );
}
