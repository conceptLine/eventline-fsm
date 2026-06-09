"use client";

/**
 * /vertrieb/neu — neuer Lead in eigener Page (analog /auftraege/neu).
 *
 * Workflow:
 *  1. Wenn kategorie noch nicht gepickt: CategoryPicker zentriert anzeigen.
 *  2. Nach Pick: LeadForm in Card.
 *  3. Submit -> INSERT in vertrieb_contacts + ggf. customer-Anlage -> redirect
 *     zur Detail-Page.
 *
 * Vorher war das ein Inline-Form direkt in /vertrieb/page.tsx, was die Liste
 * verdraengte und keinen klaren Zurueck-Pfad hatte. Jetzt dedizierte Route
 * mit BackButton.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TOAST } from "@/lib/messages";
import { BackButton } from "@/components/ui/back-button";
import { CategoryPicker } from "@/components/vertrieb/category-picker";
import { LeadForm } from "@/components/vertrieb/lead-form";
import { emptyForm } from "@/app/(app)/vertrieb/constants";
import type { VertriebContact, VertriebKategorie } from "@/types";
import { toast } from "sonner";

export default function NeuerLeadPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState(emptyForm);
  const [categoryPicked, setCategoryPicked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<{ id: string; name: string; email: string | null; phone: string | null }[]>([]);
  const [contacts, setContacts] = useState<VertriebContact[]>([]);
  const [visibleBedarf, setVisibleBedarf] = useState<Set<string>>(new Set());
  const [kundenMode, setKundenMode] = useState<"neu" | "bestehend">("neu");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  useEffect(() => {
    (async () => {
      const [custRes, contactsRes] = await Promise.all([
        supabase.from("customers").select("id, name, email, phone").eq("is_active", true).order("name"),
        supabase.from("vertrieb_contacts").select("*").limit(2000),
      ]);
      if (custRes.data) setCustomers(custRes.data);
      if (contactsRes.data) setContacts(contactsRes.data as VertriebContact[]);
    })();
  }, [supabase]);

  function pickCategory(kategorie: VertriebKategorie) {
    setForm({ ...emptyForm, kategorie });
    setCategoryPicked(true);
  }

  function selectExistingCustomer(customerId: string) {
    setSelectedCustomerId(customerId);
    const c = customers.find((x) => x.id === customerId);
    if (c) setForm((f) => ({ ...f, firma: c.name, email: c.email || "", telefon: c.phone || "", create_customer: false }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    // Details JSON-encoden — gleiche Logik wie zuvor in der Inline-Form.
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

    const { data: inserted, error } = await supabase
      .from("vertrieb_contacts")
      .insert(payload)
      .select("id")
      .single();
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

    setSaving(false);
    router.push(`/vertrieb/${inserted.id}`);
  }

  const noop = () => {};
  const noopAsync = async () => {};

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <BackButton fallbackHref="/vertrieb" size="sm" />
        <span className="font-mono text-xl font-semibold text-muted-foreground">LEAD-NEU</span>
      </div>

      {!categoryPicked ? (
        <CategoryPicker onPick={pickCategory} onClose={() => router.push("/vertrieb")} />
      ) : (
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
          onClose={() => router.push("/vertrieb")}
          onAdvanceStep={noopAsync}
          onMarkRecontacted={noopAsync}
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
    </div>
  );
}
