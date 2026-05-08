"use client";

/**
 * Termine-Sektion fuer Auftrag-Detail-Page. Aus auftraege/[id]/page.tsx
 * extrahiert (war Teil eines >900-Zeilen-Files).
 *
 * Eigene State-Domain: Form, Notify-Modal, Delete-Modal-mit-Code-Bestaetigung.
 * Parent passt nur Daten + onReload-Callback rein.
 */

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deleteRow } from "@/lib/db-mutations";
import { logError } from "@/lib/log";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/use-confirm";
import { Calendar, Clock, User, Plus, Send, Check, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { TOAST } from "@/lib/messages";
import { usePermissions } from "@/lib/use-permissions";
import type { JobAppointment, Profile, TimeOffType } from "@/types";
import { useTimeOffConflicts, buildConflictMap } from "@/lib/use-time-off-conflicts";

interface Props {
  jobId: string;
  jobTitle: string | null;
  jobStatus: string;
  jobStartDate: string | null;
  appointments: JobAppointment[];
  profiles: Profile[];
  onReload: () => void;
  /** Wenn true wird das Termin-Form initial offen gerendert (?termin=neu Flow). */
  defaultOpen?: boolean;
}

export function AppointmentsSection({
  jobId,
  jobTitle,
  jobStatus,
  jobStartDate,
  appointments,
  profiles,
  onReload,
  defaultOpen = false,
}: Props) {
  const supabase = createClient();
  const { can } = usePermissions();
  const [showApptForm, setShowApptForm] = useState(defaultOpen);
  const [apptForm, setApptForm] = useState({
    title: "",
    date: new Date().toISOString().split("T")[0],
    time: "09:00",
    end_time: "17:00",
    assigned_to: [] as string[],
    description: "",
  });
  const [notifiedAppts, setNotifiedAppts] = useState<Set<string>>(new Set());
  const [notifyPopup, setNotifyPopup] = useState<string | null>(null);
  const [emailField1, setEmailField1] = useState("");
  const [emailField2, setEmailField2] = useState("");
  const { confirm, ConfirmModalElement } = useConfirm();

  // Ferien-Konflikte am Termin-Datum — Hook gated auf showApptForm
  // (sonst polled das im Hintergrund obwohl das Form geschlossen ist).
  const timeOffConflicts = useTimeOffConflicts(showApptForm ? apptForm.date : null);
  const conflictByUser = buildConflictMap(timeOffConflicts);

  const TYPE_LABEL: Record<TimeOffType, string> = {
    ferien: "Ferien",
    krank: "Krank",
    kompensation: "Kompensation",
    frei: "Frei",
  };

  function formatDateShort(iso: string): string {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d, 12).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
  }

  async function addAppointment(e: React.FormEvent) {
    e.preventDefault();
    const tzOffset = -new Date().getTimezoneOffset();
    const tzSign = tzOffset >= 0 ? "+" : "-";
    const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, "0");
    const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, "0");
    const tz = `${tzSign}${tzHours}:${tzMins}`;
    const startTime = `${apptForm.date}T${apptForm.time || "00:00"}:00${tz}`;
    const endTime = `${apptForm.date}T${apptForm.end_time || "17:00"}:00${tz}`;

    const { data: { user } } = await supabase.auth.getUser();
    const assignees = apptForm.assigned_to.length > 0 ? apptForm.assigned_to : [user?.id || ""];

    const rows = assignees.map((personId) => ({
      job_id: jobId,
      title: apptForm.title,
      start_time: startTime,
      end_time: endTime,
      assigned_to: personId,
      description: apptForm.description || null,
    }));
    await supabase.from("job_appointments").insert(rows);

    // E-Mail an zugewiesene Personen (ausser self)
    const { data: creator } = await supabase.from("profiles").select("full_name").eq("id", user?.id).single();
    for (const personId of assignees) {
      if (personId && personId !== user?.id) {
        try {
          await fetch("/api/appointments/assign-notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assignedTo: personId,
              title: apptForm.title,
              date: apptForm.date,
              time: apptForm.time,
              endTime: apptForm.end_time,
              jobTitle: jobTitle ?? null,
              creatorName: creator?.full_name || "Unbekannt",
            }),
          });
        } catch (e) {
          logError("auftrag.appt.assign-notify", e, { personId, jobId });
        }
      }
    }

    setApptForm({
      title: "",
      date: new Date().toISOString().split("T")[0],
      time: "09:00",
      end_time: "17:00",
      assigned_to: [],
      description: "",
    });
    setShowApptForm(false);
    onReload();
    toast.success(`Termin für ${assignees.length} Person${assignees.length > 1 ? "en" : ""} erstellt`);
  }

  // useConfirm-Pattern statt vorherigem hardcoded Code "5225"-Modal —
  // konsistent mit allen anderen Loesch-Flows app-weit.
  async function deleteAppointment(apptId: string) {
    const ok = await confirm({
      title: "Termin löschen?",
      message: "Der Termin wird unwiderruflich gelöscht. Die Mitarbeiter-Zuweisung verschwindet ebenfalls.",
      confirmLabel: "Löschen",
      variant: "red",
    });
    if (!ok) return;
    const result = await deleteRow("job_appointments", apptId);
    if (!result.ok) {
      toast.error(result.error ?? "Termin konnte nicht gelöscht werden");
      return;
    }
    onReload();
    toast.success("Termin gelöscht");
  }

  async function notifyAppointment(apptId: string) {
    const emails = [emailField1, emailField2].filter((e) => e.trim() && e.includes("@"));
    if (emails.length === 0) {
      toast.error("Mindestens eine E-Mail eingeben");
      return;
    }
    toast.info("E-Mails werden gesendet...");
    try {
      const res = await fetch("/api/appointments/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: apptId, job_id: jobId, send_to_emails: emails }),
      });
      const result = await res.json();
      if (result.sentTo?.length > 0) {
        toast.success(`E-Mail gesendet an: ${result.sentTo.join(", ")}`);
        setNotifiedAppts((prev) => new Set(prev).add(apptId));
      } else {
        toast.error("Keine E-Mails gesendet");
      }
    } catch (e) {
      logError("auftrag.appt.notify", e, { apptId, jobId });
      TOAST.sendError();
    }
    setNotifyPopup(null);
    setEmailField1("");
    setEmailField2("");
  }

  const isClosed = ["abgeschlossen", "storniert"].includes(jobStatus);

  return (
    <>
      <Card id="termin-form" className="bg-card scroll-mt-4">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Calendar className="h-4 w-4" />Termine ({appointments.length})
          </CardTitle>
          {can("kalender:create") && (
            <Button size="sm" variant="outline" onClick={() => setShowApptForm(!showApptForm)}>
              <Plus className="h-4 w-4 mr-1" />Termin
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {showApptForm && (
            <form onSubmit={addAppointment} className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-3">
              <Input placeholder="Termin-Titel *" value={apptForm.title} onChange={(e) => setApptForm({ ...apptForm, title: e.target.value })} required />
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs font-medium">Datum *</label><Input type="date" value={apptForm.date} onChange={(e) => setApptForm({ ...apptForm, date: e.target.value })} className="mt-1" required /></div>
                <div><label className="text-xs font-medium">Von *</label><Input type="time" value={apptForm.time} onChange={(e) => setApptForm({ ...apptForm, time: e.target.value })} className="mt-1" required /></div>
                <div><label className="text-xs font-medium">Bis *</label><Input type="time" value={apptForm.end_time} onChange={(e) => setApptForm({ ...apptForm, end_time: e.target.value })} className="mt-1" required /></div>
              </div>
              <div>
                <label className="text-xs font-medium">Zuweisen an {apptForm.assigned_to.length > 0 && <span className="text-red-500">({apptForm.assigned_to.length})</span>}</label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {profiles.map((p) => {
                    const selected = apptForm.assigned_to.includes(p.id);
                    const conflict = conflictByUser.get(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setApptForm({ ...apptForm, assigned_to: selected ? apptForm.assigned_to.filter((pid) => pid !== p.id) : [...apptForm.assigned_to, p.id] })}
                        className={selected ? "kasten-active" : "kasten-toggle-off"}
                        title={conflict ? `${TYPE_LABEL[conflict.type]} ${formatDateShort(conflict.start_date)}–${formatDateShort(conflict.end_date)} (${conflict.status})` : undefined}
                      >
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${selected ? "bg-background/20" : "bg-foreground/10 text-muted-foreground"}`}>
                          {p.full_name.charAt(0)}
                        </div>
                        {p.full_name.split(" ")[0]}
                        {conflict && (
                          <AlertTriangle
                            className={`h-3.5 w-3.5 ${conflict.status === "genehmigt" ? "text-red-500" : "text-amber-500"}`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
                {apptForm.assigned_to.length === 0 && <p className="text-[11px] text-muted-foreground mt-1">Keine Auswahl = mir selbst</p>}

                {/* Konflikt-Liste: zeigt JEDEN User mit Konflikt am Datum,
                    nicht nur die selektierten — hilft beim Auswaehlen. */}
                {timeOffConflicts.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 px-3 py-2">
                    <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-200 mb-1">
                      Abwesend am {formatDateShort(apptForm.date)}
                    </p>
                    <ul className="space-y-0.5 text-[11px] text-amber-900 dark:text-amber-200">
                      {timeOffConflicts.map((c) => {
                        const isSelected = apptForm.assigned_to.includes(c.user_id);
                        return (
                          <li key={c.id} className="flex items-center gap-1.5">
                            <AlertTriangle className={`h-3 w-3 shrink-0 ${c.status === "genehmigt" ? "text-red-500" : "text-amber-500"}`} />
                            <span className={isSelected ? "font-semibold" : ""}>
                              {c.user?.full_name ?? "Unbekannt"}
                            </span>
                            <span className="opacity-75">
                              · {TYPE_LABEL[c.type]} {formatDateShort(c.start_date)}–{formatDateShort(c.end_date)}
                              {c.status === "beantragt" ? " (Antrag offen)" : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
              <textarea placeholder="Beschreibung..." value={apptForm.description} onChange={(e) => setApptForm({ ...apptForm, description: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-card resize-none" rows={2} />
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowApptForm(false)} className="kasten kasten-muted">Abbrechen</button>
                <button type="submit" className="kasten kasten-red">Termin erstellen</button>
              </div>
            </form>
          )}
          {appointments.length === 0 && !showApptForm && (
            !isClosed ? (
              <div className="flex items-center gap-3 p-3 rounded-xl border tinted-amber">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/20 shrink-0">
                  <Calendar className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Kein Termin geplant</p>
                  <p className="text-xs opacity-80 mt-0.5">
                    {jobStartDate ? (() => {
                      const days = Math.ceil((new Date(jobStartDate).getTime() - Date.now()) / 86400000);
                      return days > 0 ? `Auftrag beginnt in ${days} Tag${days === 1 ? "" : "en"}` : days === 0 ? "Auftrag beginnt heute" : `Auftrag hat vor ${Math.abs(days)} Tag${Math.abs(days) === 1 ? "" : "en"} begonnen`;
                    })() : "Kein Startdatum gesetzt"}
                    {" · oben rechts \"Termin\" anlegen"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2">Keine Termine.</p>
            )
          )}
          {appointments.map((appt) => {
            const assignee = appt.assignee;
            return (
              <div key={appt.id} className="flex items-center justify-between p-3 rounded-xl border bg-gray-50 border-gray-100">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="min-w-0">
                    <span className="font-medium text-sm">{appt.title}</span>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(appt.start_time).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{appt.end_time ? ` – ${new Date(appt.end_time).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
                      {assignee && <span className="flex items-center gap-1"><User className="h-3 w-3" />{assignee.full_name}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setNotifyPopup(notifyPopup === appt.id ? null : appt.id)}
                      className={`kasten ${notifiedAppts.has(appt.id) ? "kasten-green" : "kasten-blue"}`}
                    >
                      {notifiedAppts.has(appt.id) ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                      {notifiedAppts.has(appt.id) ? "Gesendet" : "Benachrichtigen"}
                    </button>
                      <Modal
                        open={notifyPopup === appt.id}
                        onClose={() => { setNotifyPopup(null); setEmailField1(""); setEmailField2(""); }}
                        title="Terminbestätigung senden"
                        icon={<Send className="h-5 w-5 text-blue-500" />}
                        size="md"
                      >
                        <div>
                          <label className="text-sm font-medium">E-Mail 1 *</label>
                          <Input
                            type="email"
                            value={emailField1}
                            onChange={(e) => setEmailField1(e.target.value)}
                            placeholder="empfaenger@beispiel.ch"
                            className="mt-1.5"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">E-Mail 2 (optional)</label>
                          <Input
                            type="email"
                            value={emailField2}
                            onChange={(e) => setEmailField2(e.target.value)}
                            placeholder="weitere@beispiel.ch"
                            className="mt-1.5"
                          />
                        </div>
                        <div className="flex gap-3 pt-2">
                          <button type="button" onClick={() => { setNotifyPopup(null); setEmailField1(""); setEmailField2(""); }} className="kasten kasten-muted flex-1">
                            Abbrechen
                          </button>
                          <button type="button" onClick={() => notifyAppointment(appt.id)} className="kasten kasten-blue flex-1">
                            <Send className="h-3.5 w-3.5" />Senden
                          </button>
                        </div>
                    </Modal>
                  </div>
                  {!isClosed && can("kalender:delete") && (
                    <button
                      type="button"
                      onClick={() => deleteAppointment(appt.id)}
                      className="kasten kasten-red"
                      data-tooltip="Termin löschen"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Löschen
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {ConfirmModalElement}
    </>
  );
}
