import { Building2, PartyPopper, type LucideIcon } from "lucide-react";
import type { VertriebStatus, VertriebPriority, VertriebKategorie } from "@/types";

export const STATUS_OPTIONS: { value: VertriebStatus; label: string; color: string }[] = [
  { value: "offen", label: "Offen", color: "bg-gray-100 text-gray-700 border-gray-200" },
  { value: "kontaktiert", label: "Kontaktiert", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "gespraech", label: "Gespräch", color: "bg-teal-100 text-teal-700 border-teal-200" },
  { value: "gewonnen", label: "Gewonnen", color: "bg-green-100 text-green-700 border-green-200" },
  { value: "abgesagt", label: "Abgesagt", color: "bg-red-100 text-red-700 border-red-200" },
];

export const PRIORITY_OPTIONS: { value: VertriebPriority; label: string; color: string }[] = [
  { value: "top", label: "★ Top", color: "bg-green-100 text-green-700 border-green-200" },
  { value: "gut", label: "Gut", color: "bg-orange-100 text-orange-700 border-orange-200" },
  { value: "mittel", label: "Mittel", color: "bg-gray-100 text-gray-600 border-gray-200" },
];

export const KATEGORIE_OPTIONS: { value: VertriebKategorie; label: string; icon: LucideIcon; color: string }[] = [
  { value: "verwaltung", label: "Verwaltungs-Anfragen", icon: Building2, color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "veranstaltung", label: "Veranstaltungen", icon: PartyPopper, color: "bg-purple-100 text-purple-700 border-purple-200" },
];

export const STEPS = [
  { nr: 1, label: "Offen", action: "Kontakt aufnehmen" },
  { nr: 2, label: "Kontaktiert", action: "Weiter zu Finalisierung" },
  { nr: 3, label: "Finalisierung", action: "Weiter zu Operations" },
  { nr: 4, label: "Operations", action: "Auftrag erstellen" },
];

export const BEDARF_BEREICHE = [
  { key: "verwaltungsaufwand", label: "Verwaltungsaufwand" },
  { key: "material", label: "Material" },
  { key: "arbeiten", label: "Arbeiten" },
  { key: "stunden", label: "Stunden" },
  { key: "catering", label: "Catering" },
  { key: "transport", label: "Transport" },
  { key: "raum", label: "Raum" },
] as const;

export const BEDARF_LABELS: Record<string, string> = {
  verwaltungsaufwand: "Verwaltungsaufwand",
  material: "Material",
  arbeiten: "Arbeiten",
  stunden: "Stunden",
  catering: "Catering",
  transport: "Transport",
  raum: "Raum",
};

export const emptyForm = {
  firma: "", branche: "", ansprechperson: "", position: "", email: "", telefon: "",
  event_typ: "", status: "offen" as VertriebStatus, datum_kontakt: "", notizen: "",
  prioritaet: "mittel" as VertriebPriority, kategorie: "veranstaltung" as VertriebKategorie,
  // Verwaltung
  infrastruktur: "", ort: "", zielgruppe: "", programm: "", bedarf_vor_ort: "",
  // Veranstaltungsdatum
  event_start: "", event_end: "",
  // Veranstaltung: pro Bereich ein Text
  bedarf: {} as Record<string, string>,
  // Kontakt als Kunden speichern (standardmässig aktiv)
  create_customer: true,
};

export type VertriebFormState = typeof emptyForm;
