"use client";

/**
 * Partner-Tab in /einstellungen — admin-only.
 *
 * Listet alle Partner-User (role='partner'), zeigt zugewiesene Location
 * pro Zeile, erlaubt Anlegen neuer Partner via Modal (Email + Name +
 * Location). Backend: /api/admin/partner-users. Setzt role='partner' +
 * partner_location_id + sendet Setup-Mail.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Plus, Building2, KeyRound, UserX, UserCheck } from "lucide-react";
import { toast } from "sonner";

interface PartnerProfileRow {
  id: string;
  full_name: string;
  email: string | null;
  is_active: boolean;
  partner_location_id: string | null;
  location_name: string | null;
}

interface LocationOption {
  id: string;
  name: string;
}

export function PartnerTab() {
  const supabase = createClient();
  const [profiles, setProfiles] = useState<PartnerProfileRow[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ email: "", full_name: "", partner_location_id: "" });
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [profRes, locRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, is_active, partner_location_id, location:locations!profiles_partner_location_id_fkey(name)")
        .eq("role", "partner")
        .order("full_name"),
      supabase.from("locations").select("id, name").eq("is_active", true).order("name"),
    ]);
    const rows: PartnerProfileRow[] = ((profRes.data as unknown as Array<{
      id: string; full_name: string; is_active: boolean; partner_location_id: string | null;
      location: { name: string } | { name: string }[] | null;
    }>) ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: null, // hole separat via RPC oder lass weg — Listen-View braucht's nicht zwingend
      is_active: p.is_active,
      partner_location_id: p.partner_location_id,
      location_name: Array.isArray(p.location) ? p.location[0]?.name ?? null : p.location?.name ?? null,
    }));
    setProfiles(rows);
    setLocations((locRes.data as LocationOption[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.email.trim() || !createForm.full_name.trim() || !createForm.partner_location_id) {
      toast.error("Alle Felder sind Pflicht");
      return;
    }
    setCreating(true);
    const res = await fetch("/api/admin/partner-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createForm),
    });
    const json = await res.json();
    setCreating(false);
    if (!json.success) {
      toast.error(json.error ?? "Anlegen fehlgeschlagen");
      return;
    }
    toast.success("Partner-User angelegt — Setup-Mail wurde versendet");
    setShowCreate(false);
    setCreateForm({ email: "", full_name: "", partner_location_id: "" });
    load();
  }

  async function toggleActive(p: PartnerProfileRow) {
    setBusyId(p.id);
    const res = await fetch(`/api/admin/users/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !p.is_active }),
    });
    const json = await res.json();
    setBusyId(null);
    if (!json.success) {
      toast.error(json.error ?? "Status-Wechsel fehlgeschlagen");
      return;
    }
    toast.success(p.is_active ? "Partner deaktiviert" : "Partner reaktiviert");
    load();
  }

  async function resetPassword(p: PartnerProfileRow) {
    setBusyId(p.id);
    const res = await fetch(`/api/admin/users/${p.id}/reset-password`, {
      method: "POST",
    });
    const json = await res.json();
    setBusyId(null);
    if (!json.success) {
      toast.error(json.error ?? "Reset-Mail fehlgeschlagen");
      return;
    }
    toast.success("Reset-Mail versendet");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Partner-Benutzer</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Location-Partner mit Zugang zum Partner-Portal. Pro Partner eine Location.
          </p>
        </div>
        <button type="button" onClick={() => setShowCreate(true)} className="kasten kasten-red">
          <Plus className="h-3.5 w-3.5" />
          Neuer Partner
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <Card key={i} className="animate-pulse bg-card"><CardContent className="p-4 h-14" /></Card>)}
        </div>
      ) : profiles.length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="py-12 text-center">
            <Building2 className="h-7 w-7 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Noch keine Partner-Benutzer.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => (
            <Card key={p.id} className={`bg-card ${!p.is_active ? "opacity-60" : ""}`}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{p.full_name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Building2 className="h-3 w-3 shrink-0" />
                    {p.location_name ?? "Keine Location zugewiesen"}
                    {!p.is_active && <span className="ml-2 text-red-600">· deaktiviert</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => resetPassword(p)}
                    disabled={busyId === p.id}
                    className="kasten kasten-muted"
                    data-tooltip="Passwort zurücksetzen"
                    aria-label="Passwort zurücksetzen"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActive(p)}
                    disabled={busyId === p.id}
                    className={`kasten ${p.is_active ? "kasten-red" : "kasten-green"}`}
                    data-tooltip={p.is_active ? "Deaktivieren" : "Aktivieren"}
                    aria-label={p.is_active ? "Deaktivieren" : "Aktivieren"}
                  >
                    {p.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Neuer Partner-Benutzer" closable={!creating}>
        <form onSubmit={handleCreate} className="space-y-3">
          <div>
            <label className="text-xs font-medium">E-Mail *</label>
            <Input
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              placeholder="partner@firma.ch"
              className="mt-1"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium">Voller Name *</label>
            <Input
              value={createForm.full_name}
              onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
              placeholder="Vorname Nachname"
              className="mt-1"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium">Location *</label>
            <select
              value={createForm.partner_location_id}
              onChange={(e) => setCreateForm({ ...createForm, partner_location_id: e.target.value })}
              required
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="">Auswählen…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Der Partner sieht im Portal nur diese eine Location.
            </p>
          </div>
          <div className="flex gap-2 pt-2 border-t border-border">
            <button type="button" onClick={() => setShowCreate(false)} disabled={creating} className="kasten kasten-muted flex-1">
              Abbrechen
            </button>
            <button type="submit" disabled={creating} className="kasten kasten-red flex-1">
              {creating ? "Speichere…" : "Anlegen + Setup-Mail"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
