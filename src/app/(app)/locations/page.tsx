"use client";

/**
 * Vereinte Liste fuer Standorte (Verwaltungen) und Raeume (externe Reference).
 * Spiegelt das Pattern von /auftraege (Vermietentwuerfe + Auftraege in einer Liste,
 * separate Detail-Seiten). Unterscheidung der beiden Typen erfolgt sichtbar ueber
 * Icon + Badge — Standort = Verwaltung, Raum = externe Reference.
 *
 * Detail- und Edit-Routen bleiben getrennt: /standorte/[id] und /raeume/[id].
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { AddressAutocomplete, type ParsedAddress } from "@/components/address-autocomplete";
import type { Location, Room } from "@/types";
import Link from "next/link";
import {
  Plus, Search, MapPin, Users as UsersIcon, Building, DoorOpen, X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { usePermissions } from "@/lib/use-permissions";

// Map ist Leaflet + GeoJSON + Plugins — ~250kb-Chunk. Lazy laden damit der
// First-Paint nicht darauf wartet.
const LocationsSwitzerlandMap = dynamic(
  () => import("@/components/locations-switzerland-map").then((m) => m.LocationsSwitzerlandMap),
  { ssr: false, loading: () => <div className="h-[280px] rounded-xl border bg-card animate-pulse" /> },
);

// Belegungsplan unter der Karte — gleicher Daten-Kontext (alle Standorte +
// deren Buchungen) macht's hier nochmal direkt nutzbar fuer Akquise.
const BelegungsplanView = dynamic(
  () => import("@/components/belegungsplan-view").then((m) => m.BelegungsplanView),
  { ssr: false, loading: () => <div className="h-96 rounded-xl border bg-card animate-pulse" /> },
);

type OrtType = "standort" | "raum";

type OrtItem = {
  id: string;
  type: OrtType;
  name: string;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  capacity: number | null;
  technical_details: string | null;
};

type FormType = OrtType | null;

export default function OrtePage() {
  const { can } = usePermissions();
  const [items, setItems] = useState<OrtItem[]>([]);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | OrtType>("all");
  const [loading, setLoading] = useState(true);
  // Aktive Inline-Form: null=zu, "standort" oder "raum" — wir teilen Felder,
  // aber haben getrennte Inserts (Tabellen sind getrennt).
  const [showForm, setShowForm] = useState<FormType>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    address_street: "",
    address_zip: "",
    address_city: "Basel",
    capacity: "",
    technical_details: "",
  });
  const supabase = createClient();

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [locRes, roomRes] = await Promise.all([
      supabase.from("locations").select("id, name, address_street, address_zip, address_city, capacity, technical_details").eq("is_active", true).order("name"),
      supabase.from("rooms").select("id, name, address_street, address_zip, address_city, capacity, technical_details").eq("is_active", true).order("name"),
    ]);
    const merged: OrtItem[] = [
      ...((locRes.data as Location[] | null) ?? []).map((l) => ({
        id: l.id, type: "standort" as const,
        name: l.name,
        address_street: l.address_street,
        address_zip: l.address_zip,
        address_city: l.address_city,
        capacity: l.capacity,
        technical_details: l.technical_details,
      })),
      ...((roomRes.data as Room[] | null) ?? []).map((r) => ({
        id: r.id, type: "raum" as const,
        name: r.name,
        address_street: r.address_street,
        address_zip: r.address_zip,
        address_city: r.address_city,
        capacity: r.capacity,
        technical_details: r.technical_details,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name));
    setItems(merged);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!showForm) return;
    setSaving(true);
    const table = showForm === "standort" ? "locations" : "rooms";
    const payload = {
      name: form.name,
      address_street: form.address_street || null,
      address_zip: form.address_zip || null,
      address_city: form.address_city || null,
      capacity: form.capacity ? parseInt(form.capacity) : null,
      technical_details: form.technical_details || null,
    };
    const { data: inserted, error } = await supabase
      .from(table)
      .insert(payload)
      .select("id")
      .single();
    if (!error) {
      // Fire-and-forget: Geocode laeuft serverseitig via Nominatim, Coords
      // landen in latitude/longitude. Der nachfolgende loadAll() zeigt die
      // neue Zeile sofort, das Map-Refresh kommt mit dem naechsten Reload —
      // reicht weil Insert ein One-Shot-Vorgang ist.
      if (inserted?.id) {
        fetch("/api/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table, id: inserted.id }),
        }).catch(() => {});
      }
      setForm({ name: "", address_street: "", address_zip: "", address_city: "Basel", capacity: "", technical_details: "" });
      setShowForm(null);
      loadAll();
    }
    setSaving(false);
  }

  const filtered = items.filter((it) => {
    const matchesType = filterType === "all" || it.type === filterType;
    if (!matchesType) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return it.name.toLowerCase().includes(q)
      || (it.address_city ?? "").toLowerCase().includes(q)
      || (it.address_street ?? "").toLowerCase().includes(q);
  });

  const standortCount = items.filter((i) => i.type === "standort").length;
  const raumCount = items.filter((i) => i.type === "raum").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {standortCount} {standortCount === 1 ? "Verwaltung" : "Verwaltungen"} · {raumCount} {raumCount === 1 ? "Raum" : "Räume"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {can("locations:create") && (
            <>
              <button type="button" onClick={() => setShowForm(showForm === "standort" ? null : "standort")} className="kasten kasten-red">
                <Plus className="h-3.5 w-3.5" />
                Neue Verwaltung
              </button>
              <button type="button" onClick={() => setShowForm(showForm === "raum" ? null : "raum")} className="kasten kasten-blue">
                <Plus className="h-3.5 w-3.5" />
                Neuer Raum
              </button>
            </>
          )}
        </div>
      </div>

      {/* Schweizer Karte mit Punkten fuer alle Verwaltungen + Raeume.
          Auf Mobile ausgeblendet — Leaflet braucht zu viel vertikale
          Höhe und ist auf < 768px Touch-Targets eh schlecht bedienbar. */}
      <div className="hidden md:block">
        <LocationsSwitzerlandMap />
      </div>

      {/* Belegungsplan — gleiche Standorte als Matrix mit Buchungen,
          fuer Akquise-Verfuegbarkeitscheck direkt auf der Locations-Page.
          Auf Mobile ausgeblendet — Matrix scrollt horizontal und ist
          auf schmalen Screens unleserlich. */}
      <div className="hidden md:block">
        <BelegungsplanView />
      </div>

      {/* Inline Form — gleiche Felder, nur Header und Submit-Label aendern sich.
          Standort = Verwaltung (intern, mit Customer-Verknuepfung in Details).
          Raum = externe Reference (Adresse + Konditionen). */}
      {showForm && (
        <Card className="bg-card border-red-100">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <h3 className="font-semibold">
                {showForm === "standort" ? "Neue Verwaltung erfassen" : "Neuen Raum erfassen"}
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">Name *</label>
                  <Input
                    placeholder={showForm === "standort" ? "z.B. Theater BAU3" : "z.B. Volkshaus Basel"}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1.5 bg-gray-50"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Kapazität (Personen)</label>
                  <Input
                    type="number"
                    placeholder={showForm === "standort" ? "z.B. 100" : "z.B. 200"}
                    value={form.capacity}
                    onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                    className="mt-1.5 bg-gray-50"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Strasse</label>
                <div className="mt-1.5">
                  <AddressAutocomplete
                    value={form.address_street}
                    onChange={(v) => setForm({ ...form, address_street: v })}
                    onPlace={(p: ParsedAddress) => setForm((prev) => ({
                      ...prev,
                      address_street: p.street || prev.address_street,
                      address_zip: p.postcode || prev.address_zip,
                      address_city: p.city || prev.address_city,
                    }))}
                    localLocations={[]}
                    placeholder="Tippe um aus Google-Vorschlägen zu wählen — füllt PLZ + Ort automatisch"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">PLZ</label>
                  <Input
                    placeholder="4052"
                    value={form.address_zip}
                    onChange={(e) => setForm({ ...form, address_zip: e.target.value })}
                    className="mt-1.5 bg-gray-50"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium">Ort</label>
                  <Input
                    placeholder="Basel"
                    value={form.address_city}
                    onChange={(e) => setForm({ ...form, address_city: e.target.value })}
                    className="mt-1.5 bg-gray-50"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Technische Details</label>
                <textarea
                  placeholder={showForm === "standort" ? "Licht, Ton, Beamer, Strom etc." : "Bühne, Licht, Ton, Strom etc."}
                  value={form.technical_details}
                  onChange={(e) => setForm({ ...form, technical_details: e.target.value })}
                  className="mt-1.5 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-gray-50 resize-none focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                  rows={2}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowForm(null)}
                  className="kasten kasten-muted"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={!form.name || saving}
                  className={`kasten ${showForm === "standort" ? "kasten-red" : "kasten-blue"}`}
                >
                  {saving ? "Speichern…" : (showForm === "standort" ? "Verwaltung erstellen" : "Raum erstellen")}
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Such- + Filter-Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Name oder Ort suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-card border-gray-200"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "standort", "raum"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={filterType === t ? "kasten-active" : "kasten-toggle-off"}
            >
              {t === "all" ? "Alle" : t === "standort" ? "Verwaltungen" : "Räume"}
            </button>
          ))}
        </div>
        {(search || filterType !== "all") && (
          <button
            type="button"
            onClick={() => { setSearch(""); setFilterType("all"); }}
            className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground rounded-lg flex items-center gap-1.5 transition-colors"
            data-tooltip="Filter zurücksetzen"
          >
            <X className="h-3.5 w-3.5" />
            Reset
          </button>
        )}
      </div>

      {/* Liste — Karten-Grid, Standort und Raum unterscheiden sich durch Icon
          + Badge-Label rechts oben. Klick fuehrt jeweils zur richtigen Detail-Route. */}
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse bg-card">
              <CardContent className="p-5">
                <div className="h-5 bg-gray-200 rounded w-2/3 mb-3" />
                <div className="h-4 bg-gray-100 rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed bg-card">
          <CardContent className="py-16 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <Building className="h-7 w-7 text-gray-400" />
            </div>
            <h3 className="font-semibold text-gray-900 text-lg">
              {search || filterType !== "all" ? "Keine Ergebnisse" : "Noch keine Locations"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {search || filterType !== "all"
                ? "Andere Suche oder Filter zurücksetzen."
                : "Erfasse deine erste Verwaltung oder einen Raum."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((it) => {
            const detailHref = it.type === "standort" ? `/standorte/${it.id}` : `/raeume/${it.id}`;
            const Icon = it.type === "standort" ? MapPin : DoorOpen;
            return (
              <Link key={`${it.type}-${it.id}`} href={detailHref}>
                <Card className="card-hover bg-card cursor-pointer group h-full">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Icon-Pad — Hover-Rot in Dark gleich kraeftig wie in Light:
                          bg-Tint 20% statt 15%, text-red-500 statt -400. Mit !-Modifier
                          damit es das Default-text-muted-foreground sicher uebersteuert. */}
                      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 dark:bg-foreground/[0.06] text-gray-500 dark:text-muted-foreground group-hover:bg-red-50 group-hover:text-red-500 dark:group-hover:!bg-red-500/20 dark:group-hover:!text-red-500 transition-colors shrink-0">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900 dark:text-foreground truncate group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">{it.name}</h3>
                        {it.address_city && (
                          <p className="text-xs text-muted-foreground">
                            {it.address_zip} {it.address_city}
                          </p>
                        )}
                      </div>
                      <span className={`text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                        it.type === "standort"
                          ? "bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300"
                          : "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300"
                      }`}>
                        {it.type === "standort" ? "Verwaltung" : "Raum"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {it.capacity && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300">
                          <UsersIcon className="h-3 w-3" />
                          {it.capacity} Pers.
                        </span>
                      )}
                      {it.technical_details && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 dark:bg-foreground/[0.06] text-gray-600 dark:text-muted-foreground">
                          Technik
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
