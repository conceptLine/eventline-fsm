"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CUSTOMER_TYPES, JOB_STATUS } from "@/lib/constants";
import type { Customer, Job, CustomerType } from "@/types";
import {
  Save, Building2, User, Globe, Mail, Phone, MapPin, Flag,
  ClipboardList, Trash2, Archive, ArchiveRestore, StickyNote, ChevronDown, Plus,
} from "lucide-react";
import { BexioButton } from "@/components/bexio-button";
import { Loading } from "@/components/ui/spinner";
import { JobNumber } from "@/components/job-number";
import { AddressAutocomplete, type ParsedAddress } from "@/components/address-autocomplete";
import { Modal } from "@/components/ui/modal";
import { BackButton } from "@/components/ui/back-button";
import Link from "next/link";
import { toast } from "sonner";
import { TOAST } from "@/lib/messages";
import { usePermissions } from "@/lib/use-permissions";

type ActionKind = "delete" | "archive" | "unarchive";

const COUNTRY_OPTIONS = [
  { code: "CH", label: "Schweiz" },
  { code: "DE", label: "Deutschland" },
  { code: "AT", label: "Österreich" },
  { code: "FR", label: "Frankreich" },
  { code: "IT", label: "Italien" },
  { code: "LI", label: "Liechtenstein" },
];

export default function KundenDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { can } = usePermissions();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  // Auftrags-Liste ist initial auf 2 Eintraege begrenzt; "Mehr anzeigen"
  // entfaltet die volle Liste. Spiegelt das "Mehr laden"-Pattern aus
  // /auftraege, nur client-seitig (Daten sind schon da).
  const [showAllJobs, setShowAllJobs] = useState(false);

  // Sortierung wie auf /auftraege, plus: stornierte Auftraege landen ans
  // absolute Ende (unabhaengig vom Datum) — sie sind nicht relevant fuer
  // "naechster Termin"-Logik. Innerhalb der nicht-stornierten:
  //   - kommende zuerst (aufsteigend, naechster oben)
  //   - vergangene danach (absteigend, neueste zuerst)
  //   - datum-loose ans Ende
  const sortedJobs = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    return [...jobs].sort((a, b) => {
      // Stornierte immer nach unten — egal ob ihr (geplantes) Datum in der
      // Zukunft liegt: die Veranstaltung findet nicht statt.
      const aCancelled = a.status === "storniert";
      const bCancelled = b.status === "storniert";
      if (aCancelled && !bCancelled) return 1;
      if (!aCancelled && bCancelled) return -1;
      // Referenz-Datum: end_date wenn vorhanden, sonst start_date — damit
      // mehrtaegige Events bis zum letzten Tag als "kommend" gelten.
      const aRef = a.end_date ? new Date(a.end_date).getTime() : a.start_date ? new Date(a.start_date).getTime() : Infinity;
      const bRef = b.end_date ? new Date(b.end_date).getTime() : b.start_date ? new Date(b.start_date).getTime() : Infinity;
      const aPast = aRef < todayMs;
      const bPast = bRef < todayMs;
      if (aPast && !bPast) return 1;
      if (!aPast && bPast) return -1;
      const aSort = a.start_date ? new Date(a.start_date).getTime() : Infinity;
      const bSort = b.start_date ? new Date(b.start_date).getTime() : Infinity;
      if (!aPast && !bPast) return aSort - bSort; // kommend: aufsteigend
      return bSort - aSort; // vergangen: absteigend
    });
  }, [jobs]);
  // Verknuepfungs-Counts entscheiden ob die Hauptaktion Hard-Delete oder
  // Archivieren ist. jobs.length koennen wir aus dem Auftraege-Join ziehen,
  // documents/locations/rental_requests holen wir separat (head:true Counts).
  const [relationTotals, setRelationTotals] = useState<number>(0);
  // ?edit=1 -> direkt im Bearbeiten-Modus (z.B. vom Bexio-Pflichtfeld-Modal)
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [form, setForm] = useState({
    name: "", type: "company" as CustomerType,
    email: "", phone: "",
    address_street: "", address_zip: "", address_city: "",
    address_country: "CH",
    notes: "",
  });

  function applyPlace(p: ParsedAddress) {
    setForm((prev) => ({
      ...prev,
      address_street: p.street || prev.address_street,
      address_zip: p.postcode || prev.address_zip,
      address_city: p.city || prev.address_city,
      address_country: p.country || prev.address_country,
    }));
  }

  useEffect(() => { loadData(); }, [id]);

  async function loadData() {
    const [custRes, jobsRes, docsRes, locsRes, rrRes] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).single(),
      supabase.from("jobs").select("*, location:locations(name)").eq("customer_id", id).neq("is_deleted", true).order("created_at", { ascending: false }),
      supabase.from("documents").select("id", { count: "exact", head: true }).eq("customer_id", id),
      supabase.from("locations").select("id", { count: "exact", head: true }).eq("customer_id", id),
      supabase.from("rental_requests").select("id", { count: "exact", head: true }).eq("customer_id", id),
    ]);
    if (custRes.data) {
      const c = custRes.data as Customer;
      setCustomer(c);
      setForm({
        name: c.name, type: c.type,
        email: c.email || "", phone: c.phone || "",
        address_street: c.address_street || "", address_zip: c.address_zip || "", address_city: c.address_city || "",
        address_country: c.address_country || "CH",
        notes: c.notes || "",
      });
    }
    const jobsList = (jobsRes.data ?? []) as unknown as Job[];
    setJobs(jobsList);
    // Auftraege werden via jobsRes.data ohne Filter gezaehlt — wir wollen
    // aktive UND geloeschte (is_deleted) als Verknuepfung sehen, da die FK
    // weiterhin existiert. Daher hier neq("is_deleted", true) entfernen waere
    // korrekt, aber: jobs.length aus dem geladenen jobsList nutzen wir nur
    // fuer die "Auftraege"-Section. Fuer can-hard-delete brauchen wir den vollen
    // Count inklusive geloeschter — separater head-count waere praeziser.
    // Pragmatisch: fuer Verknuepfungs-Check holen wir's separat:
    const { count: jobCount } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", id);
    setRelationTotals(
      (jobCount ?? 0) + (docsRes.count ?? 0) + (locsRes.count ?? 0) + (rrRes.count ?? 0),
    );
  }

  async function handleSave() {
    const { error } = await supabase.from("customers").update({
      name: form.name, type: form.type,
      email: form.email || null, phone: form.phone || null,
      address_street: form.address_street || null, address_zip: form.address_zip || null, address_city: form.address_city || null,
      address_country: form.address_country || "CH",
      notes: form.notes || null,
    }).eq("id", id);
    if (error) { TOAST.supabaseError(error); return; }
    toast.success("Kunde gespeichert");
    setEditing(false);
    loadData();
  }

  const [actionKind, setActionKind] = useState<ActionKind | null>(null);
  const [actionRunning, setActionRunning] = useState(false);

  // Hauptaktion abhaengig von zwei Fragen:
  //   1. Ist der Kunde archiviert?           -> Reaktivieren
  //   2. Hat er irgendwelche Verknuepfungen? -> Archivieren (Hard-Delete unmoeglich)
  //   3. Sonst                                -> Hard-Delete (komplett entfernen)
  const isArchived = !!customer?.archived_at;
  const canHardDelete = relationTotals === 0;
  const primaryAction: ActionKind = isArchived
    ? "unarchive"
    : canHardDelete ? "delete" : "archive";

  async function runAction() {
    if (!actionKind || actionRunning) return;
    setActionRunning(true);
    try {
      const endpoint =
        actionKind === "delete" ? "/api/customers/delete"
        : actionKind === "archive" ? "/api/customers/archive"
        : "/api/customers/unarchive";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: id }),
      });
      const json = await res.json();
      if (!json.success) {
        if (json.reason === "has-references") {
          toast.error("Kunde hat noch Verknüpfungen — bitte archivieren statt löschen.");
        } else {
          TOAST.errorOr(json.error);
        }
        setActionRunning(false);
        setActionKind(null);
        return;
      }
      const verb = actionKind === "delete" ? "gelöscht" : actionKind === "archive" ? "archiviert" : "reaktiviert";
      toast.success(`Kunde ${verb}`);
      // Bei allen drei Aktionen zurueck zur Liste — auch beim Reaktivieren.
      // Vorher blieb der User auf der Detail-Page; das war inkonsistent zu
      // archive/delete und nicht hilfreich (er sieht den frisch reaktivierten
      // Kunden in der Liste, das ist die natuerliche Bestaetigung).
      router.push("/kunden");
    } catch (e) {
      TOAST.supabaseError(e);
      setActionRunning(false);
      setActionKind(null);
    }
  }

  if (!customer) return <Loading className="py-20" label="Laden…" />;

  const typeIcon = customer.type === "company" ? <Building2 className="h-5 w-5" /> : customer.type === "individual" ? <User className="h-5 w-5" /> : <Globe className="h-5 w-5" />;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4">
        <BackButton fallbackHref="/kunden" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight truncate">{customer.name}</h1>
            {customer.bexio_nr && (
              // Bexio-Lime-Pill — selbe Farbe wie kasten-bexio Buttons fuer
              // konsistenten visuellen Bezug zu Bexio.
              <span
                className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded shrink-0 text-[rgb(132,152,0)] dark:text-[rgb(196,214,0)] bg-[rgba(196,214,0,0.12)] dark:bg-[rgba(196,214,0,0.18)]"
              >
                Nr. {customer.bexio_nr}
              </span>
            )}
            {customer.archived_at && (
              <span
                className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0"
              >
                Archiviert
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{CUSTOMER_TYPES[customer.type]}</p>
        </div>
        <div className="flex gap-2">
          {!editing && customer && (
            <BexioButton
              customerId={customer.id}
              bexioContactId={customer.bexio_contact_id}
              onLinked={() => loadData()}
            />
          )}
          {can("kunden:edit") && (
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              className={`kasten ${editing ? "kasten-muted" : "kasten-purple"}`}
            >
              {editing ? "Abbrechen" : "Bearbeiten"}
            </button>
          )}
          {(primaryAction === "delete" ? can("kunden:delete") : can("kunden:archive")) && (
            <button
              type="button"
              onClick={() => setActionKind(primaryAction)}
              className={
                primaryAction === "delete" ? "kasten kasten-red"
                : primaryAction === "archive" ? "kasten-archive"
                : "kasten kasten-green"
              }
              aria-label={
                primaryAction === "delete" ? "Löschen"
                : primaryAction === "archive" ? "Archivieren"
                : "Reaktivieren"
              }
            >
              {primaryAction === "delete" ? <Trash2 className="h-3.5 w-3.5" />
                : primaryAction === "archive" ? <Archive className="h-3.5 w-3.5" />
                : <ArchiveRestore className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Aktions-Modal — Wording wechselt je nach Aktion (delete/archive/unarchive).
          Kein Code mehr (kommt spaeter via User-Rollen). */}
      <Modal
        open={!!actionKind}
        onClose={() => !actionRunning && setActionKind(null)}
        title={
          actionKind === "delete" ? "Kunde unwiderruflich löschen?"
          : actionKind === "archive" ? "Kunde ins Archiv verschieben?"
          : actionKind === "unarchive" ? "Kunde reaktivieren?"
          : ""
        }
      >
        <p className="text-sm text-muted-foreground">
          {actionKind === "delete"
            ? `Möchtest du ${customer.name} unwiderruflich löschen? Es gibt keine Aufträge oder anderen Daten, die an diesem Kunden hängen.`
            : actionKind === "archive"
              ? `${customer.name} verschwindet aus der aktiven Liste. Bestehende Aufträge und Dokumente bleiben erhalten.`
              : `${customer.name} wird wieder als aktiver Kunde geführt.`}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setActionKind(null)}
            disabled={actionRunning}
            className="kasten kasten-muted flex-1"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={runAction}
            disabled={actionRunning}
            className={
              actionKind === "delete" ? "kasten kasten-red flex-1"
              : actionKind === "archive" ? "kasten-archive flex-1"
              : "kasten kasten-green flex-1"
            }
          >
            {actionRunning ? "Bitte warten…" :
              actionKind === "delete" ? "Endgültig löschen" :
              actionKind === "archive" ? "Archivieren" :
              "Reaktivieren"}
          </button>
        </div>
      </Modal>

      {/* Kundendaten */}
      <Card className="bg-card">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Kundendaten</CardTitle></CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5 bg-gray-50" required /></div>
                <div>
                  <Label>Typ</Label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CustomerType })} className="mt-1.5 w-full h-9 px-3 text-sm rounded-lg border border-gray-200 bg-gray-50">
                    {Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div><Label>E-Mail *</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1.5 bg-gray-50" /></div>
                <div><Label>Telefon *</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1.5 bg-gray-50" /></div>
              </div>
              <div>
                <Label>Strasse *</Label>
                <div className="mt-1.5">
                  <AddressAutocomplete
                    value={form.address_street}
                    onChange={(v) => setForm({ ...form, address_street: v })}
                    onPlace={applyPlace}
                    localLocations={[]}
                    placeholder="Tippe um aus Google-Vorschlägen zu wählen — füllt PLZ, Ort, Land automatisch"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div><Label>PLZ *</Label><Input value={form.address_zip} onChange={(e) => setForm({ ...form, address_zip: e.target.value })} className="mt-1.5 bg-gray-50" /></div>
                <div className="md:col-span-2"><Label>Ort *</Label><Input value={form.address_city} onChange={(e) => setForm({ ...form, address_city: e.target.value })} className="mt-1.5 bg-gray-50" /></div>
              </div>
              <div>
                <Label>Land</Label>
                <select
                  value={form.address_country}
                  onChange={(e) => setForm({ ...form, address_country: e.target.value })}
                  className="mt-1.5 w-full h-9 px-3 text-sm rounded-lg border border-gray-200 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                >
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div><Label>Notizen</Label><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1.5 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-gray-50 resize-none" rows={3} /></div>
              <button
                type="button"
                onClick={handleSave}
                className="kasten kasten-red"
              >
                <Save className="h-3.5 w-3.5" />Speichern
              </button>
            </div>
          ) : (
            // Lese-Ansicht: alle Felder werden immer dargestellt — leere mit
            // Platzhalter "—". So bleibt die Card-Hoehe pro Kunde konsistent
            // und keine Position springt je nach gefuellten Werten.
            <div className="space-y-3">
              <FieldRow icon={Mail} label="E-Mail">
                {customer.email ? (
                  <a href={`mailto:${customer.email}`} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{customer.email}</a>
                ) : (
                  <EmptyValue />
                )}
              </FieldRow>
              <FieldRow icon={Phone} label="Telefon">
                {customer.phone ? (
                  <a href={`tel:${customer.phone}`} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{customer.phone}</a>
                ) : (
                  <EmptyValue />
                )}
              </FieldRow>
              <FieldRow icon={MapPin} label="Adresse">
                {(customer.address_street || customer.address_zip || customer.address_city) ? (
                  <span>
                    {[customer.address_street, [customer.address_zip, customer.address_city].filter(Boolean).join(" ")]
                      .filter(Boolean).join(", ") || "—"}
                  </span>
                ) : (
                  <EmptyValue />
                )}
              </FieldRow>
              <FieldRow icon={Flag} label="Land">
                {customer.address_country ? (
                  <span>{COUNTRY_OPTIONS.find(c => c.code === customer.address_country)?.label ?? customer.address_country}</span>
                ) : (
                  <EmptyValue />
                )}
              </FieldRow>
              <FieldRow icon={StickyNote} label="Notizen" align="start">
                {customer.notes ? (
                  <span className="whitespace-pre-wrap">{customer.notes}</span>
                ) : (
                  <EmptyValue />
                )}
              </FieldRow>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Aufträge */}
      <Card className="bg-card">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><ClipboardList className="h-4 w-4" />Aufträge ({jobs.length})</CardTitle>
          {/* Direkt-Pfad: Auftrag fuer DIESEN Kunden anlegen — vorher musste
              der User zur globalen /auftraege/neu und Kunden manuell suchen. */}
          {can("auftraege:create") && (
            <Link href={`/auftraege/neu?customer_id=${id}`} className="kasten kasten-red">
              <Plus className="h-3.5 w-3.5" />
              Auftrag
            </Link>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {sortedJobs.length === 0 ? (
            <div className="py-4 text-center space-y-3">
              <p className="text-sm text-muted-foreground">Keine Aufträge für diesen Kunden.</p>
              {can("auftraege:create") && (
                <Link href={`/auftraege/neu?customer_id=${id}`} className="kasten kasten-red inline-flex">
                  <Plus className="h-3.5 w-3.5" />
                  Ersten Auftrag anlegen
                </Link>
              )}
            </div>
          ) : (
            <>
              {(showAllJobs ? sortedJobs : sortedJobs.slice(0, 2)).map((j) => (
                <Link key={j.id} href={`/auftraege/${j.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100 hover:border-gray-200 transition-colors cursor-pointer">
                    <div>
                      <div className="flex items-center gap-2">
                        <JobNumber number={j.job_number} />
                        <span className="font-medium text-sm">{j.title}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full ${JOB_STATUS[j.status].color}`}>{JOB_STATUS[j.status].label}</span>
                      </div>
                      {(j.location as unknown as { name: string })?.name && <p className="text-xs text-muted-foreground mt-0.5">{(j.location as unknown as { name: string }).name}</p>}
                    </div>
                  </div>
                </Link>
              ))}
              {sortedJobs.length > 2 && !showAllJobs && (
                <button
                  type="button"
                  onClick={() => setShowAllJobs(true)}
                  className="w-full pt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  Mehr anzeigen ({sortedJobs.length - 2})
                </button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// FieldRow + EmptyValue: kleine Helfer fuer die Kundendaten-Lese-Ansicht.
// Sorgen dafuer dass jedes Feld immer dieselbe Hoehe + Position einnimmt,
// auch wenn der Wert leer ist (Card-Layout bleibt pro Kunde konsistent).
function FieldRow({
  icon: Icon,
  label,
  children,
  align = "center",
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div className={`grid grid-cols-[auto_80px_1fr] gap-3 text-sm items-${align}`}>
      <Icon className={`h-4 w-4 text-muted-foreground/60 shrink-0 ${align === "start" ? "mt-0.5" : ""}`} />
      <span className="text-muted-foreground/80">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function EmptyValue() {
  return <span className="text-muted-foreground/40">—</span>;
}
