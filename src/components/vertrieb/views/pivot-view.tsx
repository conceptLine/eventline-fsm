"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { VertriebContact } from "@/types";
import { STEPS } from "@/app/(app)/vertrieb/constants";

/**
 * Pivot Owner x Stage — Matrix mit Lead-Anzahl je Zelle.
 *
 * Zeilen: zustaendige Sales-Person (incl. "Nicht zugewiesen").
 * Spalten: Step 1-4 + Gewonnen + Verloren.
 * Zellen: Anzahl Leads.
 *
 * Zeilen- und Spalten-Total + Grand-Total in der letzten Reihe/Spalte.
 * Sticky Header + Sticky Owner-Column damit auch bei vielen Sales-People
 * (zukuenftig) nicht verloren scrollt.
 */

interface Props {
  contacts: VertriebContact[];
  salesPeople: { id: string; full_name: string }[];
}

export function VertriebPivotView({ contacts, salesPeople }: Props) {
  // Spalten-Definition: vier Steps + Outcomes
  const cols = useMemo(() => {
    const stepCols = STEPS.map((s) => ({ key: `step_${s.nr}`, label: `${s.nr}. ${s.label}`, terminal: false }));
    return [
      ...stepCols,
      { key: "gewonnen", label: "Gewonnen", terminal: true },
      { key: "abgesagt", label: "Verloren", terminal: true },
    ];
  }, []);

  // Zeilen-Definition: alle Sales-People die in den Daten vorkommen +
  // alle aus dem salesPeople-Prop (auch wenn 0 Leads) + "Nicht zugewiesen".
  const rows = useMemo(() => {
    const ids = new Set<string>();
    for (const sp of salesPeople) ids.add(sp.id);
    for (const c of contacts) if (c.assigned_to) ids.add(c.assigned_to);
    const result = Array.from(ids).map((id) => {
      const sp = salesPeople.find((s) => s.id === id);
      return { id, name: sp?.full_name ?? "Unbekannt" };
    });
    result.sort((a, b) => a.name.localeCompare(b.name));
    result.push({ id: "__unassigned__", name: "Nicht zugewiesen" });
    return result;
  }, [salesPeople, contacts]);

  // Matrix-Aufbau
  const matrix = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of rows) m.set(r.id, new Map());
    for (const c of contacts) {
      const rowKey = c.assigned_to ?? "__unassigned__";
      let colKey: string;
      if (c.status === "gewonnen") colKey = "gewonnen";
      else if (c.status === "abgesagt") colKey = "abgesagt";
      else colKey = `step_${Math.max(1, Math.min(4, c.step || 1))}`;
      const rowMap = m.get(rowKey);
      if (rowMap) rowMap.set(colKey, (rowMap.get(colKey) ?? 0) + 1);
    }
    return m;
  }, [contacts, rows]);

  // Totals
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  let grand = 0;
  for (const r of rows) {
    let rowSum = 0;
    for (const col of cols) {
      const v = matrix.get(r.id)?.get(col.key) ?? 0;
      rowSum += v;
      colTotals.set(col.key, (colTotals.get(col.key) ?? 0) + v);
    }
    rowTotals.set(r.id, rowSum);
    grand += rowSum;
  }

  // Hide-Empty-Rows: wenn ein Owner 0 Leads hat UND nicht Nicht-zugewiesen
  // ist, ueberspringen (sonst leere Zeilen ohne Aussagekraft).
  const visibleRows = rows.filter((r) => (rowTotals.get(r.id) ?? 0) > 0 || r.id === "__unassigned__");

  return (
    <Card className="bg-card">
      <CardContent className="p-0 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b z-10">
            <tr>
              <th className="text-left px-3 py-2 font-semibold sticky left-0 bg-card z-20 min-w-[180px]">
                Sales-Person
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`text-right px-3 py-2 font-semibold whitespace-nowrap ${
                    c.terminal ? "text-muted-foreground" : ""
                  }`}
                >
                  {c.label}
                </th>
              ))}
              <th className="text-right px-3 py-2 font-bold sticky right-0 bg-card border-l">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const rowSum = rowTotals.get(r.id) ?? 0;
              return (
                <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-1.5 sticky left-0 bg-card hover:bg-muted/30 font-medium truncate max-w-[200px]" title={r.name}>
                    {r.name}
                  </td>
                  {cols.map((c) => {
                    const v = matrix.get(r.id)?.get(c.key) ?? 0;
                    return (
                      <td
                        key={c.key}
                        className={`text-right px-3 py-1.5 tabular-nums ${
                          v === 0 ? "text-muted-foreground/30" : ""
                        }`}
                      >
                        {v > 0 ? v : "·"}
                      </td>
                    );
                  })}
                  <td className="text-right px-3 py-1.5 tabular-nums font-bold sticky right-0 bg-card border-l">
                    {rowSum}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 bg-muted/40 font-semibold">
              <td className="px-3 py-2 sticky left-0 bg-muted/40">Total</td>
              {cols.map((c) => (
                <td key={c.key} className="text-right px-3 py-2 tabular-nums">
                  {(colTotals.get(c.key) ?? 0) > 0 ? colTotals.get(c.key) : "·"}
                </td>
              ))}
              <td className="text-right px-3 py-2 tabular-nums sticky right-0 bg-muted/40 border-l">
                {grand}
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
