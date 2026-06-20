"use client";

/**
 * Wiedervorlage / Snooze fuer einen Vertriebs-Lead.
 *
 * Drei UI-States:
 *  1. Kein Reminder gesetzt → Quick-Picks (morgen / +3 Tage / +1 Woche /
 *     custom) + optionale Notiz.
 *  2. Reminder gesetzt, in der Zukunft → kompakte Anzeige mit Datum,
 *     optionalem Snooze-Badge und Buttons (Bearbeiten / Erledigt).
 *  3. Faellig oder ueberfaellig → rote Markierung + Buttons.
 *
 * Snooze = same field, plus Flag `wiedervorlage_snoozed`. Wenn true,
 * blendet die Vertriebs-Liste den Lead aus bis die Wiedervorlage faellt.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { localDateIso } from "@/lib/swiss-time";
import { toast } from "sonner";
import { Bell, Check, Pencil, X, Clock, AlertTriangle, Moon } from "lucide-react";

interface Props {
  contactId: string;
  wiedervorlageAm: string | null;
  wiedervorlageNote: string | null;
  snoozed: boolean;
  onChange: () => void | Promise<void>;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysFromNow(iso: string): number {
  const diffMs = new Date(iso).getTime() - Date.now();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

/** Quick-Pick: gibt timestamptz-ISO fuer 'morgen 09:00' / '+3 Tage' etc.
 *  zurueck. Stunden = 09:00 Europe/Zurich als Default — typische Zeit fuer
 *  einen Vertriebs-Anruf. */
function quickPick(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(9, 0, 0, 0); // 09:00 LOKAL — toISOString konvertiert nach UTC
  return d.toISOString();
}

export function WiedervorlageBlock({
  contactId,
  wiedervorlageAm,
  wiedervorlageNote,
  snoozed,
  onChange,
}: Props) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formDate, setFormDate] = useState<string>("");
  const [formTime, setFormTime] = useState<string>("09:00");
  const [formNote, setFormNote] = useState<string>("");
  const [formSnoozed, setFormSnoozed] = useState<boolean>(false);

  const isOverdue = wiedervorlageAm ? new Date(wiedervorlageAm).getTime() <= Date.now() : false;
  const tone = !wiedervorlageAm
    ? "neutral"
    : isOverdue
      ? "overdue"
      : snoozed
        ? "snoozed"
        : "scheduled";

  function openEditor(prefillDays?: number) {
    if (prefillDays != null) {
      const d = new Date(quickPick(prefillDays));
      setFormDate(localDateIso(d));
      setFormTime("09:00");
    } else if (wiedervorlageAm) {
      const d = new Date(wiedervorlageAm);
      setFormDate(localDateIso(d));
      // Zeit-Anteil im Europe/Zurich-Kalender (HH:MM).
      setFormTime(
        d.toLocaleTimeString("de-CH", {
          timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hour12: false,
        }),
      );
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setFormDate(localDateIso(tomorrow));
      setFormTime("09:00");
    }
    setFormNote(wiedervorlageNote ?? "");
    setFormSnoozed(snoozed);
    setEditing(true);
  }

  async function save() {
    if (!formDate) { toast.error("Datum fehlt"); return; }
    setSaving(true);
    // Local-time-Konvertierung: Browser-TZ wird angenommen = Europe/Zurich.
    // Wenn der User in einer anderen TZ ist, fallen wir auf seine lokale
    // Zeit zurueck (akzeptabel weil App Schweiz-only ist).
    const local = new Date(`${formDate}T${formTime}:00`);
    if (Number.isNaN(local.getTime())) { toast.error("Ungueltiges Datum"); setSaving(false); return; }
    const { error } = await supabase
      .from("vertrieb_contacts")
      .update({
        wiedervorlage_am: local.toISOString(),
        wiedervorlage_note: formNote.trim() || null,
        wiedervorlage_snoozed: formSnoozed,
        // notified_at zuruecksetzen damit der Cron-Job die neue
        // Wiedervorlage als 'noch nicht benachrichtigt' erkennt.
        wiedervorlage_notified_at: null,
      })
      .eq("id", contactId);
    setSaving(false);
    if (error) { toast.error("Konnte nicht speichern: " + error.message); return; }
    toast.success(formSnoozed ? "Snooze gesetzt" : "Wiedervorlage gesetzt");
    setEditing(false);
    await onChange();
  }

  async function clearReminder() {
    setSaving(true);
    const { error } = await supabase
      .from("vertrieb_contacts")
      .update({
        wiedervorlage_am: null,
        wiedervorlage_note: null,
        wiedervorlage_snoozed: false,
        wiedervorlage_notified_at: null,
      })
      .eq("id", contactId);
    setSaving(false);
    if (error) { toast.error("Konnte nicht entfernen: " + error.message); return; }
    toast.success("Erledigt");
    await onChange();
  }

  async function quickSet(offsetDays: number, asSnooze: boolean) {
    setSaving(true);
    const { error } = await supabase
      .from("vertrieb_contacts")
      .update({
        wiedervorlage_am: quickPick(offsetDays),
        wiedervorlage_snoozed: asSnooze,
        wiedervorlage_notified_at: null,
      })
      .eq("id", contactId);
    setSaving(false);
    if (error) { toast.error("Konnte nicht setzen: " + error.message); return; }
    toast.success(asSnooze ? `Snooze bis in ${offsetDays} Tag${offsetDays === 1 ? "" : "en"}` : `Wiedervorlage in ${offsetDays} Tag${offsetDays === 1 ? "" : "en"}`);
    await onChange();
  }

  // ── Editor-Form ──
  if (editing) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium">Wiedervorlage</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Datum *</label>
            <Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="mt-1 bg-gray-50" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Zeit</label>
            <Input type="time" value={formTime} onChange={(e) => setFormTime(e.target.value)} className="mt-1 bg-gray-50" />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Notiz (optional)</label>
          <textarea
            value={formNote}
            onChange={(e) => setFormNote(e.target.value)}
            placeholder="Warum erinnern? (z.B. 'nach Angebot nachfassen')"
            rows={2}
            className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-gray-50 resize-none"
          />
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={formSnoozed}
            onChange={(e) => setFormSnoozed(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          <span className="flex items-center gap-1.5">
            <Moon className="h-3 w-3 text-muted-foreground" />
            Lead bis dahin aus der aktiven Liste ausblenden
            <span className="text-muted-foreground">(Snooze)</span>
          </span>
        </label>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setEditing(false)} className="kasten kasten-muted flex-1" disabled={saving}>
            <X className="h-3.5 w-3.5" />Abbrechen
          </button>
          <button type="button" onClick={save} className="kasten kasten-red flex-1" disabled={saving}>
            <Check className="h-3.5 w-3.5" />{saving ? "Speichert…" : "Speichern"}
          </button>
        </div>
      </div>
    );
  }

  // ── Anzeige ──
  if (tone === "neutral") {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium">Wiedervorlage setzen</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => quickSet(1, false)} className="kasten kasten-muted" disabled={saving}>Morgen</button>
          <button type="button" onClick={() => quickSet(3, false)} className="kasten kasten-muted" disabled={saving}>In 3 Tagen</button>
          <button type="button" onClick={() => quickSet(7, false)} className="kasten kasten-muted" disabled={saving}>Nächste Woche</button>
          <button type="button" onClick={() => openEditor()} className="kasten kasten-blue" disabled={saving}><Pencil className="h-3 w-3" />Custom</button>
        </div>
        <div className="border-t border-border pt-2">
          <p className="text-[10px] text-muted-foreground mb-1">Oder weglegen (Snooze) — Lead verschwindet aus der Liste:</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => quickSet(1, true)} className="kasten kasten-muted text-[10px]" disabled={saving}><Moon className="h-3 w-3" />Bis morgen</button>
            <button type="button" onClick={() => quickSet(7, true)} className="kasten kasten-muted text-[10px]" disabled={saving}><Moon className="h-3 w-3" />Bis nächste Woche</button>
          </div>
        </div>
      </div>
    );
  }

  // Gesetzter Reminder — kompakte Anzeige
  const styleByTone = {
    overdue: "border-red-500/60 bg-red-500/10",
    snoozed: "border-purple-500/40 bg-purple-500/10",
    scheduled: "border-amber-500/40 bg-amber-500/10",
  } as const;
  const iconByTone = {
    overdue: <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-300" />,
    snoozed: <Moon className="h-4 w-4 text-purple-600 dark:text-purple-300" />,
    scheduled: <Clock className="h-4 w-4 text-amber-600 dark:text-amber-300" />,
  } as const;
  const days = wiedervorlageAm ? daysFromNow(wiedervorlageAm) : 0;
  const dayLabel = !wiedervorlageAm
    ? ""
    : days === 0
      ? "heute"
      : days === 1
        ? "morgen"
        : days === -1
          ? "gestern fällig"
          : days > 0
            ? `in ${days} Tagen`
            : `${Math.abs(days)} Tage überfällig`;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${styleByTone[tone]}`}>
      <div className="flex items-start gap-2">
        {iconByTone[tone]}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {tone === "overdue" ? "Überfällig" : tone === "snoozed" ? "Snoozed" : "Wiedervorlage"}
            <span className="text-muted-foreground font-normal"> · {dayLabel}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {wiedervorlageAm && fmtDateTime(wiedervorlageAm)}
          </p>
          {wiedervorlageNote && (
            <p className="text-xs italic mt-1 text-foreground/80">„{wiedervorlageNote}"</p>
          )}
        </div>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <button type="button" onClick={() => openEditor()} className="kasten kasten-muted" disabled={saving}>
          <Pencil className="h-3 w-3" />Bearbeiten
        </button>
        <button type="button" onClick={clearReminder} className="kasten kasten-green" disabled={saving}>
          <Check className="h-3 w-3" />Erledigt
        </button>
      </div>
    </div>
  );
}
