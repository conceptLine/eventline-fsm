"use client";

// Wiederverwendbarer Donut-Chart fuer Lifecycle-/Pipeline-Uebersichten.
// Verwendet auf /auftraege (Status-Verteilung).
// Stil: Outline-only Tortenstuecke mit parallelen Cap-Kanten + getoenter Fuellung
// (.donut-segment Klasse). Single source of truth fuer Optik der Status-Charts.

import { Card, CardContent } from "@/components/ui/card";

export interface DonutSegment {
  label: string;
  count: number;
  /** CSS-Farbe (z.B. "var(--status-blue)" oder Tailwind hex). */
  color: string;
  /** Optionales Unter-Segment innerhalb dieses Segments — wird als
      schmalerer Innenring auf der gleichen Start-Achse gerendert,
      und in der Legende direkt unter dem Eltern-Eintrag aufgefuehrt.
      Beispiel: "Vermietung" innerhalb von "Bevorstehend". */
  sub?: {
    label: string;
    count: number;
    color: string;
  };
}

interface DonutChartProps {
  segments: DonutSegment[];
  /** Label unter der zentralen Zahl, z.B. "AUFTRÄGE", "MIETANFRAGEN". */
  centerLabel: string;
  /** Zusatz unter der Legende — z.B. ein Pill-Link "X Entwürfe · separat". */
  below?: React.ReactNode;
  /** Wenn keine Segmente Inhalt haben (alle count=0). */
  emptyMessage?: string;
}

// Donut-Geometrie als Konstanten — wenn die Optik ueberall geaendert werden soll,
// reicht eine Stelle.
const RADIUS = 72;
const RING_WIDTH = 18;
const OUTER_R = RADIUS + RING_WIDTH / 2;
const INNER_R = RADIUS - RING_WIDTH / 2;
const RING_DIFF = OUTER_R - INNER_R;
const OUTLINE_WIDTH = 2;
const SVG_PAD = Math.ceil(OUTLINE_WIDTH / 2) + 1;
const CX = OUTER_R + SVG_PAD;
const CY = OUTER_R + SVG_PAD;
const SVG_SIZE = OUTER_R * 2 + SVG_PAD * 2;
const GAP_ANGLE = 0.08; // Lueckenwinkel in Radian zwischen Segmenten

export function DonutChart({ segments, centerLabel, below, emptyMessage }: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  const visibleSegments = segments.filter((s) => s.count > 0);

  if (total === 0) {
    return (
      <Card className="bg-card">
        <CardContent className="p-5">
          <p className="text-xs text-muted-foreground">{emptyMessage ?? "Keine Daten."}</p>
          {below && <div className="mt-3">{below}</div>}
        </CardContent>
      </Card>
    );
  }

  // Sub-Segment-Geometrie: schmalerer Innenring innerhalb des Eltern-Segments.
  // Start-Achse identisch zum Eltern-Segment, sodass das Sub auf der ersten
  // (linken) Kante haengt und sich von dort entlang des Eltern-Bogens streckt
  // proportional zu sub.count / parent.count.
  // SUB_PAD = Pixel-Abstand des Sub-Segments zum Eltern-Bogen — gleicher
  // Wert oben (zu OUTER_R), unten (zu INNER_R) und rechts (angular umgerechnet
  // ueber midR). Links sitzt das Sub flush am Eltern-Anfang.
  const SUB_PAD = 4;
  const SUB_OUTER_R = OUTER_R - SUB_PAD;
  const SUB_INNER_R = INNER_R + SUB_PAD;

  // Pfade vorab berechnen
  let cumulativeGapMid = -Math.PI / 2; // Start an einer Gap-Mitte (12 Uhr)
  const segmentPaths: { color: string; d: string }[] = [];
  const subSegmentPaths: { color: string; d: string }[] = [];
  if (visibleSegments.length > 1) {
    const gapAngle = GAP_ANGLE;
    for (const s of visibleSegments) {
      const portion = s.count / total;
      const segAngle = portion * 2 * Math.PI - gapAngle;
      const gapMidPrev = cumulativeGapMid;
      const startA = gapMidPrev + gapAngle / 2;
      const endA = startA + segAngle;
      const gapMidNext = endA + gapAngle / 2;
      cumulativeGapMid = gapMidNext;
      // Outer-Endpunkte (exakt auf outerR)
      const ox1 = CX + OUTER_R * Math.cos(startA);
      const oy1 = CY + OUTER_R * Math.sin(startA);
      const ox2 = CX + OUTER_R * Math.cos(endA);
      const oy2 = CY + OUTER_R * Math.sin(endA);
      // Inner-Endpunkte: parallel zur Gap-Mid-Achse statt radial
      const ix1u = ox1 - RING_DIFF * Math.cos(gapMidPrev);
      const iy1u = oy1 - RING_DIFF * Math.sin(gapMidPrev);
      const innerStartAngle = Math.atan2(iy1u - CY, ix1u - CX);
      const ix1 = CX + INNER_R * Math.cos(innerStartAngle);
      const iy1 = CY + INNER_R * Math.sin(innerStartAngle);
      const ix2u = ox2 - RING_DIFF * Math.cos(gapMidNext);
      const iy2u = oy2 - RING_DIFF * Math.sin(gapMidNext);
      const innerEndAngle = Math.atan2(iy2u - CY, ix2u - CX);
      const ix2 = CX + INNER_R * Math.cos(innerEndAngle);
      const iy2 = CY + INNER_R * Math.sin(innerEndAngle);
      const largeArc = segAngle > Math.PI ? 1 : 0;
      const d = `M ${ox1} ${oy1} A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
      segmentPaths.push({ color: s.color, d });

      // Sub-Segment: gleichmaessiger Abstand zu allen 4 Raendern des Eltern-
      // Bogens. Linke Kante des Sub ist PARALLEL zur linken Kante des Eltern-
      // Segments (gapMidPrev-Achse) — gleiche Schraegung. Damit dieselbe Optik
      // wie bei den Haupt-Segmenten (parallele Cap-Kanten).
      if (s.sub && s.sub.count > 0 && s.count > 0) {
        const SUB_RING_DIFF = SUB_OUTER_R - SUB_INNER_R;
        const midR = (OUTER_R + INNER_R) / 2;
        const angularPad = SUB_PAD / midR;
        const subPortion = Math.min(s.sub.count / s.count, 1);
        const availableAngle = Math.max(segAngle - 2 * angularPad, 0);
        const subSegAngle = subPortion * availableAngle;
        const subStartA = startA + angularPad;
        const subEndA = subStartA + subSegAngle;
        // Outer-Endpunkte (radial)
        const sox1 = CX + SUB_OUTER_R * Math.cos(subStartA);
        const soy1 = CY + SUB_OUTER_R * Math.sin(subStartA);
        const sox2 = CX + SUB_OUTER_R * Math.cos(subEndA);
        const soy2 = CY + SUB_OUTER_R * Math.sin(subEndA);
        // Linker Inner-Endpunkt: parallel zur Eltern-Achse (gapMidPrev) statt
        // radial — gleiche Schraegung wie das graue Eltern-Segment.
        const six1u = sox1 - SUB_RING_DIFF * Math.cos(gapMidPrev);
        const siy1u = soy1 - SUB_RING_DIFF * Math.sin(gapMidPrev);
        const subInnerStartA = Math.atan2(siy1u - CY, six1u - CX);
        const six1 = CX + SUB_INNER_R * Math.cos(subInnerStartA);
        const siy1 = CY + SUB_INNER_R * Math.sin(subInnerStartA);
        // Rechter Inner-Endpunkt: bleibt radial (Sub endet meist mitten im
        // Eltern-Bogen, kein Gap dahinter zum parallel-ausrichten).
        const six2 = CX + SUB_INNER_R * Math.cos(subEndA);
        const siy2 = CY + SUB_INNER_R * Math.sin(subEndA);
        const subLargeArc = subSegAngle > Math.PI ? 1 : 0;
        const subD = `M ${sox1} ${soy1} A ${SUB_OUTER_R} ${SUB_OUTER_R} 0 ${subLargeArc} 1 ${sox2} ${soy2} L ${six2} ${siy2} A ${SUB_INNER_R} ${SUB_INNER_R} 0 ${subLargeArc} 0 ${six1} ${siy1} Z`;
        subSegmentPaths.push({ color: s.sub.color, d: subD });
      }
    }
  }

  return (
    <Card className="bg-card">
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row items-start gap-6">
          <div className="relative shrink-0">
            <svg width={SVG_SIZE} height={SVG_SIZE}>
              {/* Track: zwei feine konzentrische Outlines als Rahmen des Donuts */}
              <circle cx={CX} cy={CY} r={OUTER_R} fill="none" stroke="currentColor" strokeWidth={1} className="text-foreground/[0.12] dark:text-foreground/[0.18]" />
              <circle cx={CX} cy={CY} r={INNER_R} fill="none" stroke="currentColor" strokeWidth={1} className="text-foreground/[0.12] dark:text-foreground/[0.18]" />
              {visibleSegments.length === 1 ? (
                // Voller Ring: aussen + innen kompletter Kreis (ohne Fill — sonst innenkreis komplett getoent)
                <>
                  <circle cx={CX} cy={CY} r={OUTER_R} fill="none" stroke={visibleSegments[0].color} strokeWidth={OUTLINE_WIDTH} />
                  <circle cx={CX} cy={CY} r={INNER_R} fill="none" stroke={visibleSegments[0].color} strokeWidth={OUTLINE_WIDTH} />
                </>
              ) : (
                <>
                  {segmentPaths.map((p, i) => (
                    <path
                      key={i}
                      d={p.d}
                      fill={p.color}
                      stroke={p.color}
                      strokeWidth={OUTLINE_WIDTH}
                      strokeLinejoin="round"
                      className="donut-segment"
                    />
                  ))}
                  {/* Sub-Segmente liegen oben drauf — schmalerer Innenring
                      innerhalb des Eltern-Segments, gleiche Optik (Outline +
                      getoenter Fill via .donut-segment). */}
                  {subSegmentPaths.map((p, i) => (
                    <path
                      key={`sub-${i}`}
                      d={p.d}
                      fill={p.color}
                      stroke={p.color}
                      strokeWidth={OUTLINE_WIDTH}
                      strokeLinejoin="round"
                      className="donut-segment"
                    />
                  ))}
                </>
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[34px] font-bold leading-none tracking-tight">{total}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{centerLabel}</span>
            </div>
          </div>
          <div className="flex-1 w-full md:self-stretch flex flex-col">
            <div className="space-y-2.5">
              {segments.map((s) => {
                const pct = total > 0 ? (s.count / total) * 100 : 0;
                const subPct = s.sub && s.count > 0 ? (s.sub.count / s.count) * 100 : 0;
                return (
                  <div key={s.label}>
                    <div className={`flex items-center gap-3 ${s.count === 0 ? "opacity-40" : ""}`}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium truncate">
                            {s.label}
                            {s.sub && s.sub.count > 0 && (
                              <>
                                <span className="inline-block w-1.5 h-1.5 rounded-full mx-2 align-middle" style={{ background: s.sub.color }} />
                                <span style={{ color: s.sub.color }}>{s.sub.label}</span>
                                {/* Vermietungs-Zahl direkt am Label, damit alle grauen
                                    Eltern-Zahlen rechts auf einer Achse fluchten. */}
                                <span className="ml-2 tabular-nums" style={{ color: s.sub.color }}>
                                  <strong style={{ color: s.sub.color }}>{s.sub.count}</strong> · {String(Math.round(subPct)).padStart(2, "0")}%
                                </span>
                              </>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                            <strong className="text-foreground">{s.count}</strong> · {String(Math.round(pct)).padStart(2, "0")}%
                          </span>
                        </div>
                        <div className="h-[2px] rounded-full bg-foreground/[0.05] overflow-hidden mt-1.5 relative">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                          {s.sub && s.sub.count > 0 && (
                            <div
                              className="h-full rounded-full transition-all absolute left-0 top-0"
                              style={{ width: `${(s.sub.count / total) * 100}%`, background: s.sub.color }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {below && <div className="mt-auto pt-4">{below}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
