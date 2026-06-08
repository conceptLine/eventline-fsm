"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { VertriebContact } from "@/types";

/**
 * Aktivitaets-Heatmap fuer Vertrieb.
 *
 * Visualisiert das datum_kontakt-Histogramm der letzten 8 Wochen (Mo-So
 * Spalten pro Woche). Farbintensitaet = Anzahl Leads, die an diesem Tag
 * zuletzt angefasst wurden.
 *
 * Insight: zeigt produktive Tage / Wochen, gleich auch Wochenende-Loecher
 * und Ferien-Phasen. Optisch ähnlich zur GitHub-Contribution-Heatmap.
 */

interface Props {
  contacts: VertriebContact[];
}

const WEEKS = 8;

export function VertriebHeatmapView({ contacts }: Props) {
  const { weeks, max, total } = useMemo(() => {
    // Range: heute zurueck WEEKS Wochen, gerundet auf den Montag der
    // (heutige Woche - (WEEKS-1)).
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const dayOfWeek = (today.getDay() + 6) % 7; // Mo=0
    const mondayThis = new Date(today);
    mondayThis.setDate(today.getDate() - dayOfWeek);
    const start = new Date(mondayThis);
    start.setDate(mondayThis.getDate() - 7 * (WEEKS - 1));

    // Aktivitaet-Counter per Datum
    const byDate = new Map<string, number>();
    for (const c of contacts) {
      if (!c.datum_kontakt) continue;
      const k = c.datum_kontakt; // YYYY-MM-DD
      byDate.set(k, (byDate.get(k) ?? 0) + 1);
    }

    // 8 Spalten (Wochen), pro Spalte 7 Tage (Mo-So)
    const weeks: Array<{ key: string; days: Array<{ date: string; count: number; isToday: boolean }> }> = [];
    let max = 0;
    let total = 0;
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    for (let w = 0; w < WEEKS; w++) {
      const days: { date: string; count: number; isToday: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const dt = new Date(start);
        dt.setDate(start.getDate() + w * 7 + d);
        const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
        const count = byDate.get(k) ?? 0;
        if (count > max) max = count;
        total += count;
        days.push({ date: k, count, isToday: k === todayKey });
      }
      weeks.push({ key: `w${w}`, days });
    }

    return { weeks, max, total };
  }, [contacts]);

  function bg(count: number): string {
    if (count === 0) return "bg-muted/40";
    const ratio = max > 0 ? count / max : 0;
    if (ratio < 0.25) return "bg-red-200 dark:bg-red-500/25";
    if (ratio < 0.5) return "bg-red-300 dark:bg-red-500/45";
    if (ratio < 0.75) return "bg-red-400 dark:bg-red-500/65";
    return "bg-red-500 dark:bg-red-500/85";
  }

  return (
    <Card className="bg-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-sm">Aktivitaet</h3>
            <p className="text-xs text-muted-foreground">Letzte {WEEKS} Wochen — Farbintensitaet = Leads mit datum_kontakt an diesem Tag</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
            <p className="text-lg font-bold tabular-nums">{total}</p>
          </div>
        </div>

        <div className="flex gap-2 items-start">
          {/* Y-Achse: Wochentag-Labels */}
          <div className="flex flex-col gap-1 text-[9px] text-muted-foreground pt-0">
            {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((wd, i) => (
              <div key={wd} className={`h-3.5 leading-none ${i >= 5 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                {wd}
              </div>
            ))}
          </div>

          {/* Wochen-Spalten */}
          <div className="flex gap-1 flex-1 min-w-0 overflow-x-auto pb-1">
            {weeks.map((w) => (
              <div key={w.key} className="flex flex-col gap-1 shrink-0">
                {w.days.map((d) => (
                  <div
                    key={d.date}
                    className={`w-3.5 h-3.5 rounded-sm ${bg(d.count)} ${d.isToday ? "ring-1 ring-foreground" : ""}`}
                    data-tooltip={`${formatDate(d.date)}: ${d.count} Lead${d.count === 1 ? "" : "s"} angefasst`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-1 mt-3 text-[10px] text-muted-foreground">
          <span>Wenig</span>
          <span className="w-3 h-3 rounded-sm bg-red-200 dark:bg-red-500/25" />
          <span className="w-3 h-3 rounded-sm bg-red-300 dark:bg-red-500/45" />
          <span className="w-3 h-3 rounded-sm bg-red-400 dark:bg-red-500/65" />
          <span className="w-3 h-3 rounded-sm bg-red-500 dark:bg-red-500/85" />
          <span>Viel</span>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString("de-CH", {
    weekday: "short", day: "2-digit", month: "long", year: "numeric",
  });
}
