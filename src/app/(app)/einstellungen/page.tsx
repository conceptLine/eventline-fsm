"use client";

/**
 * Einstellungen-Page — Tabs: Team, Rollen, Aktivitaet (admin-only),
 * Integrationen. Backup-Tab raus: nightly Backup laeuft vom Ugreen-NAS
 * gepullt.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Plug, Users, Shield, Activity, Building2 } from "lucide-react";
import { IntegrationenTab } from "@/components/einstellungen/integrationen-tab";
import { TeamTab } from "@/components/einstellungen/team-tab";
import { RollenTab } from "@/components/einstellungen/rollen-tab";
import { AktivitaetTab } from "@/components/einstellungen/aktivitaet-tab";
import { PartnerTab } from "@/components/einstellungen/partner-tab";
import { BuildInfoBadge } from "@/components/einstellungen/build-info-badge";

type Tab = "integrationen" | "team" | "rollen" | "aktivitaet" | "partner";

export default function EinstellungenPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab") as Tab | null;
  // Default = "team" weil das der erste sichtbare Tab fuer Admin ist
  // (Reihenfolge: Team → Rollen → Integrationen). Fuer Non-Admin wird
  // unten via useEffect auf "integrationen" umgeleitet sobald der
  // Admin-Status geladen ist.
  const [tab, setTab] = useState<Tab>(urlTab && ["integrationen", "team", "rollen", "aktivitaet", "partner"].includes(urlTab) ? urlTab : "team");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // Tab-Wechsel: state = sofortige UI-Quelle, URL parallel updaten via
  // History-API damit Hard-Reload den gleichen Tab zeigt. Wir umgehen
  // den Next-Router (router.replace mit Query-Only-Update triggerte in
  // Next 16 weder re-render noch URL-Update zuverlaessig). History.API
  // ist garantiert synchron + ohne Navigation.
  function selectTab(t: Tab) {
    setTab(t);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", t);
      window.history.replaceState({}, "", url.toString());
    }
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsAdmin(false);
        return;
      }
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      const admin = profile?.role === "admin";
      setIsAdmin(admin);
      // Non-Admin auf einem Admin-only-Tab → auf integrationen umlenken,
      // sonst sieht er einen leeren Tab.
      if (!admin && (tab === "team" || tab === "rollen" || tab === "aktivitaet" || tab === "partner")) {
        selectTab("integrationen");
      }
    })();
  }, [supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    ...(isAdmin ? [
      { key: "team" as Tab, label: "Team", icon: <Users className="h-4 w-4" /> },
      { key: "partner" as Tab, label: "Partner", icon: <Building2 className="h-4 w-4" /> },
      { key: "rollen" as Tab, label: "Rollen", icon: <Shield className="h-4 w-4" /> },
      { key: "aktivitaet" as Tab, label: "Aktivität", icon: <Activity className="h-4 w-4" /> },
    ] : []),
    { key: "integrationen", label: "Integrationen", icon: <Plug className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header — gleiche Struktur wie /auftraege etc. (h1 + Subtitle-Spacer
          fuer konsistente Hoehe app-weit). Rechts oben das Build-Info-
          Fun-Fact-Widget (Version, LOC, Wort-Count). */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Einstellungen</h1>
          <p className="text-sm text-muted-foreground mt-1" aria-hidden="true">&nbsp;</p>
        </div>
        <BuildInfoBadge />
      </div>

      {/* Tab-Bar im selben kasten-Toggle-Stil wie Filter-Buttons in /auftraege,
          /todos, /kunden — kein eigenes Pill-Container-Pattern. */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => selectTab(t.key)}
            className={tab === t.key ? "kasten-active" : "kasten-toggle-off"}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "integrationen" && <IntegrationenTab />}

      {tab === "team" && isAdmin && <TeamTab />}

      {tab === "partner" && isAdmin && <PartnerTab />}

      {tab === "rollen" && isAdmin && <RollenTab />}

      {tab === "aktivitaet" && isAdmin && <AktivitaetTab />}
    </div>
  );
}
