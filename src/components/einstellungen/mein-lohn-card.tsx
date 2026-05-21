"use client";

/**
 * Mein-Lohn-Karte fuer /einstellungen — der eingeloggte User sieht seinen
 * eigenen Brutto-Stundenlohn (und ab wann er gueltig ist).
 *
 * Datenfluss: ruft RPC `get_my_compensation()` (SECURITY DEFINER) — die
 * Funktion liefert NUR hourly_wage_chf + effective_from/to + notes.
 * employer_costs_chf_per_hour ist absichtlich nicht in der Return-Signatur,
 * der User soll den Arbeitgeber-Anteil nicht sehen.
 *
 * Bei keinen Daten: dezenter "noch nicht hinterlegt"-Hinweis.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface MyComp {
  hourly_wage_chf: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
}

const CHF = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function MeinLohnCard() {
  const supabase = createClient();
  const [comp, setComp] = useState<MyComp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("get_my_compensation");
      if (!error && Array.isArray(data) && data.length > 0) {
        const row = data[0] as MyComp;
        setComp({
          hourly_wage_chf: Number(row.hourly_wage_chf),
          effective_from: row.effective_from,
          effective_to: row.effective_to,
          notes: row.notes,
        });
      }
      setLoading(false);
    })();
  }, [supabase]);

  // Keine Karte anzeigen wenn kein Datensatz vorhanden — sonst sehen User
  // ohne Lohnverhaeltnis (z.B. Externe) eine leere "noch nicht hinterlegt"-
  // Karte, was verwirrt. Wenn Admin den Lohn pflegt, erscheint sie automatisch.
  if (loading || !comp) return null;

  return (
    <Card className="bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Wallet className="h-4 w-4" />Mein Lohn
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">Stundenlohn (brutto)</span>
          <span className="font-semibold tabular-nums">CHF {CHF.format(comp.hourly_wage_chf)} / h</span>
        </div>
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>Gueltig ab</span>
          <span className="tabular-nums">
            {new Date(comp.effective_from + "T00:00:00").toLocaleDateString("de-CH")}
          </span>
        </div>
        {comp.notes && (
          <div className="text-xs text-muted-foreground pt-1 border-t">{comp.notes}</div>
        )}
      </CardContent>
    </Card>
  );
}
