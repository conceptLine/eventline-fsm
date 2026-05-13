"use client";

/**
 * Vermietentwurf-Bearbeiten — Schwester zu /auftraege/[id]/bearbeiten.
 * Felder identisch zur Erstell-Page (neu/page.tsx); hier wird per ID
 * geladen und via UPDATE gespeichert statt INSERT.
 *
 * Pflichtfelder identisch: Titel, Kunde, Location, Veranstaltungstyp,
 * Personen, Start- + Enddatum.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/searchable-select";
import { EVENT_TYPES } from "@/lib/constants";
import type { Customer, Location } from "@/types";
import { Save } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import Link from "next/link";
import { toast } from "sonner";
import { TOAST } from "@/lib/messages";
import { JobNumber } from "@/components/job-number";
import { toDbDate } from "@/lib/format";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function dateToISODate(d: string | null): string {
  if (!d) return "";
  return d.slice(0, 10);
}

export default function VermietentwurfBearbeitenPage() {
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const jobId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jobNumber, setJobNumber] = useState<number | null>(null);
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [locations, setLocations] = useState<Location[] | null>(null);

  const [form, setForm] = useState({
    customer_id: "",
    location_id: "",
    title: "",
    event_type: "",
    guest_count: "",
    start_date: "",
    end_date: "",
    description: "",
    extended_services: "",
  });
  const [eventTypeCustom, setEventTypeCustom] = useState(false);

  useEffect(() => {
    async function load() {
      const [jobRes, c, l] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, job_number, title, description, customer_id, location_id, start_date, end_date, event_type, guest_count, extended_services, status")
          .eq("id", jobId)
          .single(),
        supabase.from("customers").select("id, name").eq("is_active", true).order("name"),
        supabase.from("locations").select("id, name, address_street, address_zip, address_city").eq("is_active", true).order("name"),
      ]);
      setCustomers((c.data as Customer[]) ?? []);
      setLocations((l.data as Location[]) ?? []);

      if (jobRes.error || !jobRes.data) {
        toast.error("Vermietentwurf nicht gefunden");
        router.push("/auftraege");
        return;
      }
      const j = jobRes.data;
      if (j.status !== "anfrage") {
        toast.error("Nur Vermietentwürfe können hier bearbeitet werden");
        router.push(`/auftraege/${jobId}`);
        return;
      }

      setJobNumber(j.job_number);
      const eventType = j.event_type ?? "";
      setEventTypeCustom(eventType !== "" && !EVENT_TYPES.includes(eventType));
      setForm({
        customer_id: j.customer_id ?? "",
        location_id: j.location_id ?? "",
        title: j.title ?? "",
        event_type: eventType,
        guest_count: j.guest_count != null ? String(j.guest_count) : "",
        start_date: dateToISODate(j.start_date),
        end_date: dateToISODate(j.end_date),
        description: j.description ?? "",
        extended_services: j.extended_services ?? "",
      });
      setLoading(false);
    }
    load();
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  function update<K extends keyof typeof form>(field: K, value: typeof form[K]) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { TOAST.requiredField("Titel"); return; }
    if (!form.customer_id) { TOAST.requiredField("Kunde"); return; }
    if (!form.location_id) { TOAST.requiredField("Location"); return; }
    if (!form.event_type.trim()) { TOAST.requiredField("Veranstaltungstyp"); return; }
    if (!form.guest_count.trim()) { TOAST.requiredField("Personenanzahl"); return; }
    if (!form.start_date) { TOAST.requiredField("Startdatum"); return; }
    if (!form.end_date) { TOAST.requiredField("Enddatum"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("jobs")
      .update({
        title: form.title.trim(),
        description: form.description.trim() || null,
        customer_id: form.customer_id,
        location_id: form.location_id,
        start_date: toDbDate(form.start_date),
        end_date: toDbDate(form.end_date),
        event_type: form.event_type.trim(),
        guest_count: parseInt(form.guest_count, 10),
        extended_services: form.extended_services.trim() || null,
      })
      .eq("id", jobId);
    setSaving(false);
    if (error) {
      TOAST.supabaseError(error, "Speichern fehlgeschlagen");
      return;
    }
    toast.success("Änderungen gespeichert");
    window.dispatchEvent(new Event("jobs:invalidate"));
    router.push(`/auftraege/vermietentwurf/${jobId}`);
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="h-8 w-40 rounded bg-muted animate-pulse mb-4" />
        <div className="h-96 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <BackButton fallbackHref={`/auftraege/vermietentwurf/${jobId}`} size="sm" />
        <h1 className="text-xl font-bold tracking-tight">Vermietentwurf bearbeiten</h1>
        <div className="ml-auto">
          <JobNumber number={jobNumber} />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="rounded-xl border bg-card p-5 space-y-5">
        <div className="space-y-2">
          <SectionLabel>Titel *</SectionLabel>
          <Input
            placeholder="z.B. Hochzeit Müller, Konzert Stadthalle"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <SectionLabel>Beschreibung</SectionLabel>
          <textarea
            placeholder="Was hat der Kunde angefragt?"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            rows={3}
            style={{ fieldSizing: "content" } as React.CSSProperties}
            className="w-full px-3 py-1.5 text-sm rounded-xl border bg-background resize-none transition-all hover:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring"
          />
        </div>

        <hr className="border-border/50" />

        <div className="space-y-2">
          <SectionLabel>Kunde *</SectionLabel>
          <SearchableSelect
            value={form.customer_id}
            onChange={(id) => update("customer_id", id)}
            items={(customers ?? []).map((c) => ({ id: c.id, label: c.name }))}
            placeholder="Kunde tippen…"
            required
          />
        </div>

        <div className="space-y-2">
          <SectionLabel>Location *</SectionLabel>
          <SearchableSelect
            value={form.location_id}
            onChange={(id) => update("location_id", id)}
            items={(locations ?? []).map((l) => ({
              id: l.id,
              label: l.name,
              sub: [l.address_street, l.address_zip, l.address_city].filter(Boolean).join(", "),
            }))}
            placeholder="Location auswählen…"
            required
          />
        </div>

        <hr className="border-border/50" />

        <div className="space-y-2">
          <SectionLabel>Event-Datum *</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground/70 ml-1">Start *</p>
              <Input type="date" value={form.start_date} onChange={(e) => update("start_date", e.target.value)} required />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground/70 ml-1">Ende *</p>
              <Input type="date" value={form.end_date} onChange={(e) => update("end_date", e.target.value)} min={form.start_date || undefined} required />
            </div>
          </div>
        </div>

        <hr className="border-border/50" />

        <div className="space-y-2">
          <SectionLabel>Veranstaltungstyp *</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {EVENT_TYPES.map((t) => {
              const active = !eventTypeCustom && form.event_type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setEventTypeCustom(false); update("event_type", t); }}
                  className={`px-3 py-2 rounded-xl border text-sm transition-all ${
                    active
                      ? "bg-foreground/[0.08] border-foreground/40 font-semibold"
                      : "border-border text-muted-foreground hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.10] hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => { setEventTypeCustom(true); update("event_type", ""); }}
              className={`px-3 py-2 rounded-xl border text-sm transition-all ${
                eventTypeCustom
                  ? "bg-foreground/[0.08] border-foreground/40 font-semibold"
                  : "border-border text-muted-foreground hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.10] hover:text-foreground"
              }`}
            >
              Sonstige…
            </button>
          </div>
          {eventTypeCustom && (
            <Input
              placeholder="z.B. Workshop, Generalversammlung, Vereinsfeier"
              value={form.event_type}
              onChange={(e) => update("event_type", e.target.value)}
            />
          )}
        </div>

        <div className="space-y-2">
          <SectionLabel>Personen (geplant) *</SectionLabel>
          <Input
            type="number"
            placeholder="z.B. 80"
            value={form.guest_count}
            onChange={(e) => update("guest_count", e.target.value)}
            required
            min={1}
          />
        </div>

        <div className="space-y-2">
          <SectionLabel>Zusatzleistungen</SectionLabel>
          <textarea
            placeholder="z.B. Tontechnik, Lichttechnik, Catering, Reinigung…"
            value={form.extended_services}
            onChange={(e) => update("extended_services", e.target.value)}
            rows={2}
            style={{ fieldSizing: "content" } as React.CSSProperties}
            className="w-full px-3 py-1.5 text-sm rounded-xl border bg-background resize-none transition-all hover:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Link
            href={`/auftraege/vermietentwurf/${jobId}`}
            className="kasten kasten-muted flex-1"
          >
            Abbrechen
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="kasten kasten-purple flex-1"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Speichert…" : "Speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}
