"use client";

/**
 * HR-Hub — zwei Tabs:
 *   • Operativ — Karten fuer Stempelzeiten, Tickets, Ferien (taegliche
 *                Workflows).
 *   • Löhne    — fuer Mitarbeiter: eigene Lohnausweise (Download, Future).
 *                fuer HR/Admin: Lohntabelle aller Mitarbeiter.
 *
 * Tab-State via URL-Parameter (?tab=loehne) — gleiche Pattern wie auf
 * /einstellungen, damit Hard-Reload den richtigen Tab oeffnet.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TypePickerCard, type TypePickerTone } from "@/components/ui/type-picker-card";
import { Clock, Ticket, Plane, Briefcase, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePermissions } from "@/lib/use-permissions";
import { cn } from "@/lib/utils";
import { LohnTable } from "@/components/hr/lohn-table";
import { LohnausweiseList } from "@/components/hr/lohnausweise-list";
import { TrustedDeviceGate } from "@/components/trust/trusted-device-gate";

// Haupt-Tab-Stil: Underline + red-500-Akzent, identisch zum
// Firmenportal/Partnerportal-Switcher auf /einstellungen. Konsistenz
// app-weit fuer Haupt-Tab-Wechsel.
const TAB_BTN_CLASS = "flex items-center gap-2 px-3 py-2.5 -mb-px text-sm font-medium border-b-2 transition-colors";

type Tab = "operativ" | "loehne";

interface HRSection {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: TypePickerTone;
}

const sections: HRSection[] = [
  { href: "/stempelzeiten", label: "Stempelzeiten", description: "Arbeitszeit-Erfassung pro Auftrag",        icon: Clock,  tone: "green" },
  { href: "/tickets",       label: "Tickets",       description: "IT, Stempel-Änderungen, Material",         icon: Ticket, tone: "red" },
  { href: "/ferien",        label: "Ferien",        description: "Ferien, Krankheit & Frei-Tage eintragen",  icon: Plane,  tone: "blue" },
];

export default function HRPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(urlTab === "loehne" ? "loehne" : "operativ");
  const { can } = usePermissions();
  const canManageLohn = can("lohn:manage");

  // URL nachziehen via History-API (gleiche Logik wie /einstellungen — Next-
  // Router-replace fuer Query-Only-Wechsel hat in Next 16 nicht zuverlaessig
  // re-rendert).
  function selectTab(t: Tab) {
    setTab(t);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (t === "operativ") url.searchParams.delete("tab");
      else url.searchParams.set("tab", t);
      window.history.replaceState({}, "", url.toString());
    }
  }

  // Sync wenn der URL-Parameter sich von aussen aendert (Back/Forward).
  useEffect(() => {
    const next = urlTab === "loehne" ? "loehne" : "operativ";
    setTab(next);
  }, [urlTab]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "operativ", label: "Operativ", icon: <Briefcase className="h-4 w-4" /> },
    { key: "loehne",   label: "Löhne",    icon: <Wallet className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">HR</h1>
        <p className="text-sm text-muted-foreground mt-1" aria-hidden="true">&nbsp;</p>
      </div>

      {/* Haupt-Tab-Switcher — Underline-Stil identisch zu /einstellungen
          (Firmenportal/Partnerportal-Pattern). */}
      <nav className="border-b flex gap-1">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className={cn(
                TAB_BTN_CLASS,
                active
                  ? "border-red-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-foreground/20",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "operativ" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sections.map((s) => (
            <TypePickerCard
              key={s.href}
              icon={s.icon}
              tone={s.tone}
              label={s.label}
              description={s.description}
              onClick={() => router.push(s.href)}
            />
          ))}
        </div>
      )}

      {tab === "loehne" && (
        <div className="space-y-6">
          {/* Jeder Mitarbeiter sieht seine eigenen Lohnausweise — kein Trust-Gate
              (eigene Daten, gehoert dem User). */}
          <LohnausweiseList />
          {/* HR/Admin-Lohntabelle: sensible Querschnittsdaten → Trust-Gate. */}
          {canManageLohn && (
            <TrustedDeviceGate>
              <LohnTable />
            </TrustedDeviceGate>
          )}
        </div>
      )}
    </div>
  );
}
