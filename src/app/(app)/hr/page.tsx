"use client";

/**
 * HR-Hub — Karten fuer Stempelzeiten, Tickets, Ferien.
 *
 * Loehne sind nicht mehr hier: Lohn-Verwaltung passiert direkt im
 * User-Edit-Modal unter Einstellungen → Team (Lohn-Sektion mit
 * Trusted-Device-Gate). So gibt's keine separate Querschnittstabelle
 * mehr; die Lohn-Werte gehoeren konzeptionell zum jeweiligen User.
 */

import { useRouter } from "next/navigation";
import { TypePickerCard, type TypePickerTone } from "@/components/ui/type-picker-card";
import { Clock, Ticket, Plane } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">HR</h1>
        <p className="text-sm text-muted-foreground mt-1" aria-hidden="true">&nbsp;</p>
      </div>

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
    </div>
  );
}
