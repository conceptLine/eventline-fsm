/**
 * Spinner — roter rotierender Strich-Kreis (Lucide Loader2 + red-500).
 *
 * App-weite Konvention: jede Lade-Animation nutzt diesen Spinner. Nur
 * Skeleton-Karten (Platzhalter-Form-Pulses) bleiben als animate-pulse —
 * die sind als "Inhalts-Approximation" gedacht, nicht als Spinner.
 *
 * Verwendung:
 *   <Spinner />                 // 16px inline-Spinner
 *   <Spinner size={24} />       // groesser
 *   <Loading />                 // Spinner + "Lade …" zentriert in der Box
 *   <Loading label="Form wird geladen…" />
 *   <Loading className="py-12" />
 */

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <Loader2
      className={cn("animate-spin text-red-500", className)}
      style={{ width: size, height: size }}
      strokeWidth={2.5}
      aria-hidden="true"
    />
  );
}

export function Loading({ label = "Lade …", className, size = 20 }: { label?: string; className?: string; size?: number }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted-foreground", className)}>
      <Spinner size={size} />
      {label && <span>{label}</span>}
    </div>
  );
}
