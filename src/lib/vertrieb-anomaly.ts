import type { VertriebContact } from "@/types";

/**
 * Anomalien-Detection fuer Vertriebs-Leads.
 *
 *  - stale: seit >7 Tagen kein Kontakt UND noch aktiv (step >= 2).
 *  - hotIdle: prioritaet=top + step=1 (= heisser Lead aber nichts passiert).
 *  - eventSoon: event_start in <14 Tagen aber noch nicht in step 4
 *    (Operations) — Vorbereitung knapp.
 *  - forgotten: angelegt vor >7 Tagen, nie kontaktiert (step=1 +
 *    datum_kontakt NULL) — wurde komplett vergessen.
 *
 * Eine Anomalie heisst nicht "Fehler" — heisst nur "anschauen". Im UI
 * mit gelbem/rotem Marker.
 */
export interface LeadAnomaly {
  stale: boolean;
  hotIdle: boolean;
  eventSoon: boolean;
  forgotten: boolean;
}

export function detectLeadAnomaly(c: VertriebContact, nowMs: number): LeadAnomaly {
  if (c.status === "gewonnen" || c.status === "abgesagt") {
    return { stale: false, hotIdle: false, eventSoon: false, forgotten: false };
  }

  const step = c.step || 1;
  const daysSince = daysSinceLastTouch(c, nowMs);
  const stale = step >= 2 && daysSince !== null && daysSince > 7;
  const hotIdle = c.prioritaet === "top" && step === 1;
  const forgotten = step === 1 && !c.datum_kontakt && daysSince !== null && daysSince > 7;

  let eventSoon = false;
  try {
    const parsed = JSON.parse(c.notizen || "{}") as { _details?: { event_start?: string } };
    const eventStart = parsed?._details?.event_start;
    if (eventStart) {
      const eventMs = new Date(eventStart).getTime();
      if (!Number.isNaN(eventMs)) {
        const daysToEvent = Math.floor((eventMs - nowMs) / (1000 * 60 * 60 * 24));
        eventSoon = daysToEvent >= 0 && daysToEvent < 14 && step < 4;
      }
    }
  } catch { /* ignore */ }

  return { stale, hotIdle, eventSoon, forgotten };
}

export function hasAnomaly(a: LeadAnomaly): boolean {
  return a.stale || a.hotIdle || a.eventSoon || a.forgotten;
}

/** Tage seit letzter Aktion (datum_kontakt > created_at). */
export function daysSinceLastTouch(c: VertriebContact, nowMs: number): number | null {
  let thenMs: number;
  if (c.datum_kontakt) {
    const [y, m, d] = c.datum_kontakt.split("-").map(Number);
    thenMs = new Date(y, m - 1, d, 12).getTime();
  } else if (c.created_at) {
    thenMs = new Date(c.created_at).getTime();
  } else {
    return null;
  }
  return Math.floor((nowMs - thenMs) / (1000 * 60 * 60 * 24));
}

/** event_start aus notizen JSON parsen — null wenn fehlt/invalid. */
export function parseEventStart(c: VertriebContact): Date | null {
  try {
    const d = (JSON.parse(c.notizen || "{}") as { _details?: { event_start?: string } })?._details?.event_start;
    if (!d) return null;
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  } catch { return null; }
}
