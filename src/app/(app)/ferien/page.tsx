"use client";

/**
 * Ferien & Abwesenheit — Mitarbeiter beantragen, Admin genehmigt.
 *
 * Mitarbeiter-Sicht: nur eigene Antraege (RLS regelt). Beantragen via
 * "+ Neue Anfrage"-Button. Eigene noch nicht entschiedene Antraege sind
 * loeschbar.
 *
 * Admin-Sicht (ferien:approve): Tabs "Meine | Team", Team-Liste mit
 * Filter nach Status, Genehmigen/Ablehnen-Buttons auf "beantragt"-Eintraegen.
 * Top-Stats: offene Antraege + aktuell abwesend.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Loading } from "@/components/ui/spinner";
import { Plane, ThermometerSun, Repeat, Coffee, Shield, Plus, Check, X, Trash2, Calendar, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { TOAST } from "@/lib/messages";
import { usePermissions } from "@/lib/use-permissions";
import { useConfirm } from "@/components/ui/use-confirm";
import type { TimeOff, TimeOffType, TimeOffStatus } from "@/types";

interface TimeOffWithUser extends TimeOff {
  user: { full_name: string } | null;
}

const TYPE_META: Record<TimeOffType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  ferien:        { label: "Ferien",         icon: Plane,           color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  krank:         { label: "Krank",          icon: ThermometerSun,  color: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  kompensation:  { label: "Kompensation",   icon: Repeat,          color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  frei:          { label: "Frei",           icon: Coffee,          color: "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300" },
  militaer:      { label: "Militär",        icon: Shield,          color: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" },
};

const STATUS_META: Record<TimeOffStatus, { label: string; color: string }> = {
  beantragt: { label: "Offen",       color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  genehmigt: { label: "Genehmigt",   color: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" },
  abgelehnt: { label: "Abgelehnt",   color: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function daysBetween(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const sDate = new Date(sy, sm - 1, sd);
  const eDate = new Date(ey, em - 1, ed);
  return Math.round((eDate.getTime() - sDate.getTime()) / 86400000) + 1;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function FerienPage() {
  const supabase = createClient();
  const { profile, can, ready } = usePermissions();
  const { confirm, ConfirmModalElement } = useConfirm();

  const canApprove = can("ferien:approve");
  const userId = profile?.id ?? null;

  const [entries, setEntries] = useState<TimeOffWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"meine" | "team">("meine");
  const [filterStatus, setFilterStatus] = useState<TimeOffStatus | "alle">("alle");

  // Anfrage-Modal
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState<TimeOffType>("ferien");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newNote, setNewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Decision-Modal (Admin)
  const [deciding, setDeciding] = useState<{ entry: TimeOffWithUser; decision: "genehmigen" | "ablehnen" } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("time_off")
      .select("*, user:profiles!time_off_user_id_fkey(full_name)")
      .order("start_date", { ascending: false });
    if (error) {
      TOAST.supabaseError(error, "Anträge konnten nicht geladen werden");
      setLoading(false);
      return;
    }
    setEntries((data as unknown as TimeOffWithUser[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // Effective view: Non-Admins sehen immer "meine"
  const effectiveView = canApprove ? view : "meine";

  const visible = useMemo(() => {
    let list = entries;
    if (effectiveView === "meine") {
      list = list.filter((e) => e.user_id === userId);
    }
    if (effectiveView === "team" && filterStatus !== "alle") {
      list = list.filter((e) => e.status === filterStatus);
    }
    return list;
  }, [entries, effectiveView, filterStatus, userId]);

  // Stats fuer Admin-Header
  const stats = useMemo(() => {
    if (!canApprove) return null;
    const now = todayISO();
    const offen = entries.filter((e) => e.status === "beantragt").length;
    const aktuellAbwesend = entries.filter((e) =>
      e.status === "genehmigt" && e.start_date <= now && e.end_date >= now
    ).length;
    return { offen, aktuellAbwesend };
  }, [entries, canApprove]);

  function openCreate() {
    setNewType("ferien");
    setNewStart(todayISO());
    setNewEnd(todayISO());
    setNewNote("");
    setCreating(true);
  }

  async function submitCreate() {
    if (!newStart || !newEnd) {
      TOAST.error("Start- und End-Datum sind Pflicht");
      return;
    }
    if (newStart > newEnd) {
      TOAST.error("Start-Datum muss vor End-Datum liegen");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/time-off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date: newStart,
        end_date: newEnd,
        type: newType,
        note: newNote.trim() || null,
      }),
    });
    const json = await res.json();
    setSubmitting(false);
    if (!json.success) {
      TOAST.errorOr(json.error, "Anlegen fehlgeschlagen");
      return;
    }
    toast.success("Antrag eingereicht");
    setCreating(false);
    load();
  }

  async function deleteEntry(entry: TimeOffWithUser) {
    const ok = await confirm({
      title: "Antrag zurückziehen?",
      message: `${TYPE_META[entry.type].label} vom ${formatDateRange(entry.start_date, entry.end_date)} wird gelöscht.`,
      confirmLabel: "Zurückziehen",
      variant: "red",
    });
    if (!ok) return;
    const { error } = await supabase.from("time_off").delete().eq("id", entry.id);
    if (error) {
      TOAST.supabaseError(error, "Löschen fehlgeschlagen");
      return;
    }
    toast.success("Antrag zurückgezogen");
    load();
  }

  function openDecide(entry: TimeOffWithUser, decision: "genehmigen" | "ablehnen") {
    setDeciding({ entry, decision });
    setDecisionNote("");
  }

  async function submitDecide() {
    if (!deciding) return;
    const isReject = deciding.decision === "ablehnen";
    if (isReject && !decisionNote.trim()) {
      TOAST.error("Begründung beim Ablehnen ist Pflicht");
      return;
    }
    const res = await fetch(`/api/time-off/${deciding.entry.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: deciding.decision,
        note: decisionNote.trim() || null,
      }),
    });
    const json = await res.json();
    if (!json.success) {
      TOAST.errorOr(json.error, "Speichern fehlgeschlagen");
      return;
    }
    toast.success(isReject ? "Antrag abgelehnt" : "Antrag genehmigt");
    setDeciding(null);
    setDecisionNote("");
    load();
  }

  if (!ready) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ferien & Abwesenheit</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {canApprove
              ? "Eigene Anträge einreichen, Team-Anträge genehmigen oder ablehnen."
              : "Eigene Ferien-, Krank- oder Frei-Tage eintragen."}
          </p>
        </div>
        <button type="button" onClick={openCreate} className="kasten kasten-red shrink-0">
          <Plus className="h-3.5 w-3.5" />
          Neue Anfrage
        </button>
      </div>

      {/* Admin-Stats */}
      {canApprove && stats && (
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-card">
            <CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Offene Anträge
              </p>
              <p className="text-2xl font-bold tabular-nums mt-1">{stats.offen}</p>
            </CardContent>
          </Card>
          <Card className="bg-card">
            <CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Aktuell abwesend
              </p>
              <p className="text-2xl font-bold tabular-nums mt-1">{stats.aktuellAbwesend}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs (Admin) */}
      {canApprove && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setView("meine")}
            className={view === "meine" ? "kasten-active" : "kasten-toggle-off"}
          >
            Meine
          </button>
          <button
            type="button"
            onClick={() => setView("team")}
            className={view === "team" ? "kasten-active" : "kasten-toggle-off"}
          >
            Team
          </button>
          {view === "team" && (
            <>
              <div className="w-px bg-border mx-1" />
              {(["alle", "beantragt", "genehmigt", "abgelehnt"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilterStatus(s)}
                  className={filterStatus === s ? "kasten-active" : "kasten-toggle-off"}
                >
                  {s === "alle" ? "Alle Status" : STATUS_META[s].label}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* List */}
      {loading ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="py-10 text-center">
            <Calendar className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              {effectiveView === "meine"
                ? "Noch keine Anträge — leg deine erste Ferien-Anfrage an."
                : "Keine Anträge mit diesen Filtern."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              showUser={effectiveView === "team"}
              isOwn={e.user_id === userId}
              canApprove={canApprove}
              onDelete={() => deleteEntry(e)}
              onDecide={(d) => openDecide(e, d)}
            />
          ))}
        </div>
      )}

      {/* Anfrage-Modal */}
      <Modal
        open={creating}
        onClose={() => !submitting && setCreating(false)}
        title="Neue Anfrage"
        icon={<Plane className="h-5 w-5 text-blue-500" />}
        size="md"
        closable={!submitting}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Typ</label>
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              {(Object.keys(TYPE_META) as TimeOffType[]).map((t) => {
                const meta = TYPE_META[t];
                const Icon = meta.icon;
                const active = newType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewType(t)}
                    className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                      active
                        ? "border-2 border-foreground/30 bg-foreground/5"
                        : "border border-border hover:bg-muted/50"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Von</label>
              <Input
                type="date"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Bis</label>
              <Input
                type="date"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
          {newStart && newEnd && newStart <= newEnd && (
            <p className="text-xs text-muted-foreground">{daysBetween(newStart, newEnd)} Tag(e)</p>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notiz (optional)</label>
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value.slice(0, 500))}
              placeholder="z.B. Italien-Reise, Hochzeit, ..."
              rows={2}
              maxLength={500}
              className="mt-1.5 w-full px-3 py-2 text-sm rounded-lg border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              disabled={submitting}
              className="kasten kasten-muted flex-1"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={submitCreate}
              disabled={submitting}
              className="kasten kasten-red flex-1"
            >
              <Plus className="h-3.5 w-3.5" />
              {submitting ? "Speichere…" : "Einreichen"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Decision-Modal */}
      <Modal
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title={deciding?.decision === "ablehnen" ? "Antrag ablehnen" : "Antrag genehmigen"}
        icon={
          deciding?.decision === "ablehnen"
            ? <X className="h-5 w-5 text-red-500" />
            : <Check className="h-5 w-5 text-green-500" />
        }
        size="md"
      >
        {deciding && (
          <div className="space-y-3">
            <div className="text-sm rounded-lg bg-muted/40 px-3 py-2">
              <p className="font-medium">{deciding.entry.user?.full_name ?? "Unbekannt"}</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                {TYPE_META[deciding.entry.type].label} · {formatDateRange(deciding.entry.start_date, deciding.entry.end_date)}
                {" "}({daysBetween(deciding.entry.start_date, deciding.entry.end_date)} Tage)
              </p>
              {deciding.entry.note && (
                <p className="text-xs mt-1 italic">"{deciding.entry.note}"</p>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {deciding.decision === "ablehnen" ? "Begründung (Pflicht)" : "Notiz (optional)"}
              </label>
              <textarea
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value.slice(0, 500))}
                placeholder={deciding.decision === "ablehnen" ? "Warum wird abgelehnt?" : "z.B. Vertretung organisieren, ..."}
                rows={3}
                maxLength={500}
                autoFocus
                className="mt-1.5 w-full px-3 py-2 text-sm rounded-lg border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeciding(null)}
                className="kasten kasten-muted flex-1"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={submitDecide}
                className={`flex-1 ${deciding.decision === "ablehnen" ? "kasten kasten-red" : "kasten kasten-green"}`}
              >
                {deciding.decision === "ablehnen" ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                {deciding.decision === "ablehnen" ? "Ablehnen" : "Genehmigen"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {ConfirmModalElement}
    </div>
  );
}

// =====================================================================
// EntryRow — eine Antrag-Zeile (Card)
// =====================================================================

interface EntryRowProps {
  entry: TimeOffWithUser;
  showUser: boolean;
  isOwn: boolean;
  canApprove: boolean;
  onDelete: () => void;
  onDecide: (decision: "genehmigen" | "ablehnen") => void;
}

function EntryRow({ entry, showUser, isOwn, canApprove, onDelete, onDecide }: EntryRowProps) {
  const typeMeta = TYPE_META[entry.type];
  const statusMeta = STATUS_META[entry.status];
  const TypeIcon = typeMeta.icon;
  const days = daysBetween(entry.start_date, entry.end_date);
  const canCancel = isOwn && entry.status === "beantragt";
  const canDecide = canApprove && entry.status === "beantragt";

  return (
    <Card className="bg-card">
      <CardContent className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${typeMeta.color}`}>
              <TypeIcon className="h-4 w-4" />
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {showUser && entry.user?.full_name && (
                <span className="font-semibold text-sm">{entry.user.full_name}</span>
              )}
              <span className="text-sm text-muted-foreground">
                {typeMeta.label}
              </span>
              <span className={`inline-flex items-center px-1.5 py-0 text-[10px] font-medium rounded-full ${statusMeta.color}`}>
                {statusMeta.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
              {formatDateRange(entry.start_date, entry.end_date)} · {days} {days === 1 ? "Tag" : "Tage"}
            </p>
            {entry.note && (
              <p className="text-xs italic mt-1 truncate">"{entry.note}"</p>
            )}
            {entry.status === "abgelehnt" && entry.decision_note && (
              <p className="text-[11px] mt-1 text-red-600 dark:text-red-400 flex items-start gap-1">
                <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>{entry.decision_note}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {canDecide && (
              <>
                <button
                  type="button"
                  onClick={() => onDecide("ablehnen")}
                  className="kasten kasten-red"
                  data-tooltip="Ablehnen"
                  aria-label="Ablehnen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDecide("genehmigen")}
                  className="kasten kasten-green"
                  data-tooltip="Genehmigen"
                  aria-label="Genehmigen"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {canCancel && !canDecide && (
              <button
                type="button"
                onClick={onDelete}
                className="kasten kasten-muted"
                data-tooltip="Zurückziehen"
                aria-label="Zurückziehen"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
