"use client";

/**
 * Stempelzeiten-Portal
 * - Eigene Sicht (default): Liste der eigenen Stempel-Eintraege.
 * - Admin-Sicht: Toggle "Alle Mitarbeiter" laedt via SECURITY-DEFINER-RPC
 *   alle Eintraege quer durchs Team — fuer Lohnabrechnung / Stundenkontrolle.
 *
 * Filter: Datum-Range, User (nur Admin), Auftrag-vs-Andere. Live-Eintrag
 * (clock_out NULL) wird oben mit Live-Timer gerendert.
 */

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/lib/use-permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BackButton } from "@/components/ui/back-button";
import { Briefcase, FileText, Clock, Calendar, User, Trash2 } from "lucide-react";
import { useStempel, formatStempelDuration } from "@/lib/use-stempel";
import { useConfirm } from "@/components/ui/use-confirm";
import { SearchableSelect } from "@/components/searchable-select";
import { NewTicketModal } from "@/components/tickets/new-ticket-modal";
import { toast } from "sonner";
import { TOAST } from "@/lib/messages";
import Link from "next/link";

interface AdminEntry {
  id: string;
  user_id: string;
  user_name: string;
  job_id: string | null;
  job_number: number | null;
  job_title: string | null;
  clock_in: string;
  clock_out: string | null;
  description: string | null;
  notes: string | null;
  duration_minutes: number | null;
}

interface OwnEntry {
  id: string;
  job_id: string | null;
  clock_in: string;
  clock_out: string | null;
  description: string | null;
  notes: string | null;
  job: { job_number: number; title: string } | null;
}

function formatDuration(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-CH", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function StempelzeitenPage() {
  const supabase = createClient();
  const { active } = useStempel();
  const { confirm, ConfirmModalElement } = useConfirm();
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showStempelTicket, setShowStempelTicket] = useState(false);
  const { can } = usePermissions();
  const [ownEntries, setOwnEntries] = useState<OwnEntry[]>([]);
  const [adminEntries, setAdminEntries] = useState<AdminEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Live-Timer fuer aktiven Eintrag
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  // Admin-Status pruefen
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setIsAdmin(profile?.role === "admin");
    })();
  }, [supabase]);

  // User-Liste fuer Admin-Filter
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const { data } = await supabase.rpc("get_assignable_users");
      setUsers((data as { id: string; full_name: string }[]) ?? []);
    })();
  }, [isAdmin, supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    if (showAll && isAdmin) {
      const { data, error } = await supabase.rpc("get_all_time_entries", {
        filter_user_id: filterUserId || null,
        filter_from: filterFrom ? new Date(filterFrom + "T00:00:00").toISOString() : null,
        filter_to: filterTo ? new Date(filterTo + "T23:59:59").toISOString() : null,
      });
      if (error) TOAST.supabaseError(error, "Stempel-Eintraege konnten nicht geladen werden");
      setAdminEntries((data as AdminEntry[]) ?? []);
    } else {
      let q = supabase
        .from("time_entries")
        .select("id, job_id, clock_in, clock_out, description, notes, job:jobs(job_number, title)")
        .order("clock_in", { ascending: false });
      if (filterFrom) q = q.gte("clock_in", new Date(filterFrom + "T00:00:00").toISOString());
      if (filterTo) q = q.lt("clock_in", new Date(filterTo + "T23:59:59").toISOString());
      const { data } = await q;
      setOwnEntries((data as unknown as OwnEntry[]) ?? []);
    }
    setLoading(false);
  }, [supabase, showAll, isAdmin, filterUserId, filterFrom, filterTo]);

  useEffect(() => { load(); }, [load]);

  async function deleteEntry(id: string) {
    const ok = await confirm({
      title: "Eintrag löschen?",
      message: "Der Stempel-Eintrag wird unwiderruflich entfernt.",
      confirmLabel: "Löschen",
      variant: "red",
    });
    if (!ok) return;
    const { error } = await supabase.from("time_entries").delete().eq("id", id);
    if (error) {
      TOAST.supabaseError(error, "Eintrag konnte nicht gelöscht werden");
      return;
    }
    toast.success("Eintrag gelöscht");
    load();
  }

  // Total-Berechnung fuer die aktuelle Filter-Auswahl
  const totalMinutes = (() => {
    if (showAll && isAdmin) {
      return adminEntries.reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
    }
    return ownEntries.reduce((sum, e) => {
      if (!e.clock_out) return sum;
      const min = Math.floor((new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 60000);
      return sum + Math.max(0, min);
    }, 0);
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3 min-h-9">
        <div className="flex items-center gap-4">
          <BackButton fallbackHref="/hr" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Stempelzeiten</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {showAll && isAdmin ? "Alle Mitarbeiter" : "Deine Einträge"} ·{" "}
              <span className="font-semibold">Total: {formatDuration(totalMinutes)}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Direktlink zum Stempel-Aenderungs-Ticket — vorher musste der
              User zu /tickets, "+ Neues Ticket", "Stempel-Aenderung"-Karte
              waehlen. Jetzt ein Klick. Permission-gegated: User ohne
              tickets:create sieht den Button nicht (sonst Modal-Open mit
              spaeterer RLS-Denial). */}
          {can("tickets:create") && (
            <button
              type="button"
              onClick={() => setShowStempelTicket(true)}
              className="kasten kasten-green"
              data-tooltip="Stempel-Aenderung anfragen"
            >
              <Clock className="h-3.5 w-3.5" />
              Stempel-Änderung
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className={showAll ? "kasten-active" : "kasten-toggle-off"}
            >
              <User className="h-3.5 w-3.5" />
              {showAll ? "Eigene Sicht" : "Alle Mitarbeiter"}
            </button>
          )}
        </div>
      </div>

      {/* Aktiver Eintrag-Banner */}
      {active && (
        <Card className="bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30">
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-green-700 dark:text-green-400">Aktuell eingestempelt</p>
                <p className="text-sm font-medium">
                  {active.job_id ? "Auf einem Auftrag" : (active.description || "Andere Arbeit")}
                </p>
              </div>
            </div>
            <span className="font-mono text-lg font-semibold tabular-nums text-green-700 dark:text-green-400">
              {formatStempelDuration(active.clock_in, now)}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Filter-Bar */}
      <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="flex gap-2 items-center">
          <label className="text-xs text-muted-foreground">Von</label>
          <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-xs text-muted-foreground">Bis</label>
          <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="h-9 w-40" />
        </div>
        {showAll && isAdmin && (
          <div className="w-full sm:w-48">
            <SearchableSelect
              value={filterUserId}
              onChange={setFilterUserId}
              items={[
                { id: "", label: "Alle Mitarbeiter" },
                ...users.map((u) => ({ id: u.id, label: u.full_name })),
              ]}
              searchable={false}
              clearable={false}
              active={!!filterUserId}
            />
          </div>
        )}
        {(filterFrom || filterTo || filterUserId) && (
          <button
            type="button"
            onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterUserId(""); }}
            className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground rounded-lg flex items-center gap-1.5 transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {/* Liste */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map((i) => <Card key={i} className="animate-pulse bg-card"><CardContent className="p-4 h-16" /></Card>)}</div>
      ) : (showAll && isAdmin ? adminEntries : ownEntries).length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="py-16 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Clock className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-lg">Keine Einträge</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {showAll && isAdmin ? "Im gewählten Zeitraum hat niemand gestempelt." : "Du hast noch keine Stempel-Einträge."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {showAll && isAdmin
            ? adminEntries.map((e) => (
                <EntryCard
                  key={e.id}
                  userName={e.user_name}
                  jobLabel={e.job_id && e.job_number ? `INT-${e.job_number} · ${e.job_title}` : null}
                  jobHref={e.job_id ? `/auftraege/${e.job_id}` : null}
                  description={e.description}
                  clockIn={e.clock_in}
                  clockOut={e.clock_out}
                  durationMinutes={e.duration_minutes}
                  onDelete={() => deleteEntry(e.id)}
                />
              ))
            : ownEntries.map((e) => {
                const dur = e.clock_out
                  ? Math.floor((new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 60000)
                  : null;
                return (
                  <EntryCard
                    key={e.id}
                    userName={null}
                    jobLabel={e.job_id && e.job ? `INT-${e.job.job_number} · ${e.job.title}` : null}
                    jobHref={e.job_id ? `/auftraege/${e.job_id}` : null}
                    description={e.description}
                    clockIn={e.clock_in}
                    clockOut={e.clock_out}
                    durationMinutes={dur}
                    onDelete={() => deleteEntry(e.id)}
                  />
                );
              })}
        </div>
      )}

      {ConfirmModalElement}

      <NewTicketModal
        open={showStempelTicket}
        onClose={() => setShowStempelTicket(false)}
        onCreated={() => {
          setShowStempelTicket(false);
          toast.success("Ticket erstellt — Admin wurde benachrichtigt");
        }}
        initialType="stempel_aenderung"
      />
    </div>
  );
}

interface EntryCardProps {
  userName: string | null;
  jobLabel: string | null;
  jobHref: string | null;
  description: string | null;
  clockIn: string;
  clockOut: string | null;
  durationMinutes: number | null;
  onDelete: () => void;
}

function EntryCard({ userName, jobLabel, jobHref, description, clockIn, clockOut, durationMinutes, onDelete }: EntryCardProps) {
  const isRunning = !clockOut;
  return (
    <Card className={`card-hover bg-card ${isRunning ? "border-green-300 dark:border-green-500/40" : ""}`}>
      <CardContent className="p-4 flex items-center gap-3 flex-wrap">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          jobLabel ? "bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400"
                   : "bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400"
        }`}>
          {jobLabel ? <Briefcase className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {userName && (
              <span className="text-xs font-medium px-1.5 py-0 rounded-full bg-muted">{userName}</span>
            )}
            {jobLabel ? (
              jobHref ? (
                <Link href={jobHref} className="font-medium text-sm hover:underline truncate">{jobLabel}</Link>
              ) : (
                <span className="font-medium text-sm truncate">{jobLabel}</span>
              )
            ) : (
              <span className="font-medium text-sm truncate">{description || "Andere Arbeit"}</span>
            )}
            {isRunning && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0 text-[10px] font-semibold rounded-full bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                </span>
                Läuft
              </span>
            )}
          </div>
          {jobLabel && description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDateTime(clockIn)}</span>
            {clockOut && <span>→ {formatDateTime(clockOut)}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono font-semibold text-sm tabular-nums">
            {durationMinutes !== null ? formatDuration(durationMinutes) : "läuft…"}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors shrink-0"
          aria-label="Eintrag löschen"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </CardContent>
    </Card>
  );
}
