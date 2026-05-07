/**
 * Vertrieb-Notes-Schema.
 *
 * Das `notizen`-Feld auf vertrieb_contacts ist historisch ein Text-Feld
 * geworden, in dem wir JSON ablegen: { _text: freie Notiz, _details: ... }.
 * Hier explizit getypt damit alle Lese-/Schreib-Operationen safe sind.
 *
 * War vorher in /vertrieb/page.tsx inline definiert — ausgelagert weil
 * jetzt auch /vertrieb/[id]/page.tsx + LeadEditor die selben Types
 * brauchen.
 */

export type Termin = {
  id: string;
  date: string; // ISO YYYY-MM-DD
  time: string; // HH:MM
  end_time?: string;
  type?: string;
  notes?: string;
};

export interface VertriebDetails {
  event_start?: string;
  event_end?: string;
  // Verwaltung-spezifisch
  infrastruktur?: string;
  ort?: string;
  zielgruppe?: string;
  programm?: string;
  bedarf_vor_ort?: string;
  // Veranstaltung-spezifisch (key=Bedarf-Slug, value=Beschreibung)
  bedarf?: Record<string, string>;
  // Cross-cutting
  termine?: Termin[];
  // Offerten-PDF: Storage-Pfad + Original-Filename
  offerte_pdf?: { name: string; path: string } | null;
  // Wird gesetzt wenn ein Auftrag aus diesem Lead konvertiert wurde
  job_id?: string;
  job_number?: number | null;
  // Optional: vom Lead vorausgewaehlte Location
  location_id?: string;
}

export interface VertriebNotes {
  _text?: string;
  _details?: VertriebDetails;
}

/** Robust gegen kaputte / Legacy-Daten — returnt bei Fehler {}. */
export function parseVertriebNotes(raw: string | null | undefined): VertriebNotes {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as VertriebNotes;
    return {};
  } catch {
    // Legacy-Daten haben einfach den Text drin (kein JSON) — als _text behandeln.
    return { _text: raw };
  }
}
