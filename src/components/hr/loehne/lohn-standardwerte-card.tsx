"use client";

/**
 * Lohn-Standardwerte: firmenweite Defaults fuer Mitarbeiter-Abzuege +
 * Arbeitgeber-Anteil. Eigenstaendige Card, laedt + persistiert via
 * /api/hr/lohn-defaults.
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { TOAST } from "@/lib/messages";
import {
  DefaultsGroup,
  DEFAULTS_FALLBACK,
  defaultsToPctMap,
  type PctMap,
  type PctKey,
  AN_FIELDS,
  AG_FIELDS,
} from "@/components/hr/loehne/lohn-shared";

export function LohnStandardwerteCard() {
  const [defaults, setDefaults] = useState<PctMap>(DEFAULTS_FALLBACK);
  const [drafts, setDrafts] = useState<PctMap>(DEFAULTS_FALLBACK);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/hr/lohn-defaults")
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        if (json?.success && json.defaults) {
          const map = defaultsToPctMap(json.defaults);
          setDefaults(map);
          setDrafts(map);
        }
      })
      .catch(() => {});
  }, []);

  async function saveOne(key: string) {
    const k = key as PctKey;
    const v = parseFloat(drafts[k].replace(",", "."));
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      toast.error("Ungueltiger Wert (0-100)");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/hr/lohn-defaults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [`default_${k}`]: v }),
    });
    setSaving(false);
    const json = await res.json();
    if (!res.ok || !json.success) {
      TOAST.errorOr(json.error);
      return;
    }
    setDefaults((p) => ({ ...p, [k]: String(v) }));
    toast.success("Standard gespeichert");
  }

  return (
    <Card className="bg-card">
      <CardContent className="p-3 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Wallet className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Lohn-Standardwerte</p>
            <p className="text-[11px] text-muted-foreground">
              Firmenweite Defaults. Greifen bei jedem Mitarbeiter, ausser der hat im Lohn-Tab einen Override gesetzt.
            </p>
          </div>
        </div>

        <DefaultsGroup
          title="Mitarbeiter-Abzüge (% vom Brutto)"
          subtitle="werden vom Brutto abgezogen → Netto-Auszahlung"
          fields={AN_FIELDS}
          drafts={drafts}
          setDrafts={setDrafts}
          current={defaults}
          onSave={saveOne}
          saving={saving}
        />

        <DefaultsGroup
          title="Arbeitgeber-Anteil (% vom Brutto)"
          subtitle="zusätzliche Firmenkosten → Vollkosten"
          fields={AG_FIELDS}
          drafts={drafts}
          setDrafts={setDrafts}
          current={defaults}
          onSave={saveOne}
          saving={saving}
        />
      </CardContent>
    </Card>
  );
}
