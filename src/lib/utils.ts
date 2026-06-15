import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parst ein Datum-only String (YYYY-MM-DD) als lokales Datum — OHNE Timezone-Shift.
 * new Date("2026-04-19") parst als UTC 00:00 und verschiebt sich je nach Timezone.
 * Diese Funktion erstellt ein Date das garantiert am richtigen Tag bleibt.
 */
export function parseLocalDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const datePart = dateStr.split("T")[0]; // tz-ok: dateStr ist YYYY-MM-DD oder iso, hier bewusst nur Datums-Teil; result wird mit new Date(y,m-1,d,12) konstruiert (siehe unten) und ist daher TZ-neutral
  const parts = datePart.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d, 12, 0, 0); // 12 Uhr mittags → keine Timezone-Probleme
}

/**
 * Formatiert ein Datum-only String (YYYY-MM-DD) in de-CH Format — ohne Timezone-Shift.
 */
export function formatLocalDate(dateStr: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  const date = parseLocalDate(dateStr);
  if (!date) return "";
  // timeZone Europe/Zurich auch hier — date ist auf 12 Uhr LOKAL gesetzt,
  // ohne TZ-Option wuerde auf einem UTC-Server (Vercel) das Datum am
  // Winter-DST-Edge faelschlich kippen.
  return date.toLocaleDateString("de-CH", { timeZone: "Europe/Zurich", ...(options || { day: "2-digit", month: "2-digit", year: "numeric" }) });
}

/**
 * Formatiert ein Timestamp (mit Zeit) in Europe/Zurich Zeit.
 */
export function formatZurichDateTime(isoDateTime: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!isoDateTime) return "";
  const d = new Date(isoDateTime);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    ...(options || { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  });
}

/**
 * Formatiert ein ISO-Datum/Zeit nur als Datum in Europe/Zurich — stabil gegen Server-Timezone.
 */
export function formatZurichDate(isoDateTime: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!isoDateTime) return "";
  const d = new Date(isoDateTime);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich",
    ...(options || { day: "2-digit", month: "2-digit", year: "numeric" }),
  });
}
