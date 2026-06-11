/**
 * NotificationService — zentrale Eintritts-Schicht fuer alle In-App-
 * Benachrichtigungen.
 *
 * Statt dass jeder API-Endpoint sein eigenes
 *   supabase.from("notifications").insert({ title, message, link, type, ... })
 * baut, ruft er hier eine typisierte Funktion:
 *   await notifyTicketNew(admin, { ticketNumber, title, ticketType, byUser })
 *
 * Vorteile:
 *  - Konsistente Titles/Messages/Links app-weit
 *  - Neuer Empfaengerkreis oder neues Format an einer Stelle
 *  - Zukuenftig: Channel-Filter (In-App/Mail/Push) basierend auf
 *    user_notification_settings, ohne Endpoint-Refactor
 *  - Smart-Defaults wie Buendelung/Throttling zentralisieren leicht
 *
 * KONVENTIONEN
 *  - Receiver: Array von Profile-IDs. Empty-Array = no-op (kein Crash).
 *  - Service-Funktionen bauen Title/Message/Link selbst — Caller liefert
 *    nur den semantischen Kontext (z.B. ticketNumber + title).
 *  - Result ist immer void. Fehler werden geloggt aber NICHT geworfen
 *    (Notification-Failure soll nie eine Business-Aktion blockieren).
 *
 * USAGE (api-side mit admin client):
 *   import { createAdminClient } from "@/lib/supabase/admin";
 *   import { notifyTicketNew } from "@/lib/notification-service";
 *
 *   await notifyTicketNew(createAdminClient(), {
 *     recipients: adminIds,
 *     ticketNumber: 42,
 *     ticketTitle: "Drucker streikt",
 *     ticketType: "it",
 *     byName: "Mathis",
 *   });
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/log";
import type { NotificationType } from "@/types";

interface NotificationRow {
  user_id: string;
  type: NotificationType;
  title: string;
  message: string | null;
  link: string | null;
  resource_type: string | null;
  resource_id: string | null;
}

/** Filtert Empfaenger gegen ihre user_notification_settings.channels.
 *  Default wenn nichts gespeichert: in_app=true (= aktuelles Verhalten).
 *
 *  Lookup ist ein einziger Query mit IN — pro Notify-Call ein DB-Hit. */
async function filterByInAppSettings(
  client: SupabaseClient,
  recipients: string[],
  type: NotificationType,
): Promise<string[]> {
  if (recipients.length === 0) return recipients;
  const unique = Array.from(new Set(recipients.filter(Boolean)));
  const { data, error } = await client
    .from("user_notification_settings")
    .select("user_id, channels")
    .in("user_id", unique);
  if (error) {
    // Settings-Lookup-Failure soll Notifications nicht blockieren.
    logError("notification-service.filterByInAppSettings", error);
    return unique;
  }
  const byUser = new Map<string, Record<string, { in_app?: boolean; email?: boolean; push?: boolean }>>();
  for (const row of data ?? []) {
    byUser.set(row.user_id, (row.channels as Record<string, { in_app?: boolean; email?: boolean; push?: boolean }>) ?? {});
  }
  return unique.filter((uid) => {
    const ch = byUser.get(uid);
    if (!ch) return true; // Keine Settings = Default an
    const evCh = ch[type];
    if (!evCh) return true; // Kein Event-spezifischer Eintrag = Default an
    return evCh.in_app !== false;
  });
}

/** Low-level Insert. Funktionen unten bauen Rows und reichen sie hier
 *  durch. Insert ist best-effort: Fehler werden geloggt, nicht geworfen. */
async function insertMany(client: SupabaseClient, rows: NotificationRow[]) {
  if (rows.length === 0) return;
  const { error } = await client.from("notifications").insert(rows);
  if (error) logError("notification-service.insert", error, { count: rows.length });
}

/** Erzeugt eine Row pro Empfaenger mit gleichem Body. */
function fanOut<T extends Omit<NotificationRow, "user_id">>(
  recipients: string[],
  base: T,
): NotificationRow[] {
  const seen = new Set<string>();
  return recipients
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((user_id) => ({ user_id, ...base }));
}

/** Helper: filtert Empfaenger nach Settings + macht den Insert.
 *  Alle public Service-Funktionen nutzen das statt direkt insertMany. */
async function deliver(
  client: SupabaseClient,
  recipients: string[],
  type: NotificationType,
  base: Omit<NotificationRow, "user_id" | "type">,
) {
  const allowed = await filterByInAppSettings(client, recipients, type);
  await insertMany(client, fanOut(allowed, { type, ...base }));
}

// =============================================================
// Public API — pro Event eine Funktion
// =============================================================

interface BaseArgs {
  recipients: string[];
}

// --- TICKETS -------------------------------------------------

const TICKET_TYPE_LABEL: Record<string, string> = {
  it: "IT-Problem",
  beleg: "Beleg",
  stempel_aenderung: "Stempel-Aenderung",
  material: "Material",
};

export async function notifyTicketNew(
  client: SupabaseClient,
  args: BaseArgs & {
    ticketId: string;
    ticketNumber: number;
    ticketTitle: string;
    ticketType: string;
    byName: string;
  },
) {
  const label = TICKET_TYPE_LABEL[args.ticketType] ?? "Ticket";
  await deliver(client, args.recipients, "ticket_new", {
    title: `Neues ${label}: ${args.ticketTitle}`,
    message: `${args.byName} hat T-${args.ticketNumber} eingereicht.`,
    link: `/tickets/${args.ticketId}`,
    resource_type: "ticket",
    resource_id: args.ticketId,
  });
}

export async function notifyTicketDone(
  client: SupabaseClient,
  args: BaseArgs & {
    ticketId: string;
    ticketNumber: number;
    ticketTitle: string;
    byName: string;
  },
) {
  await deliver(client, args.recipients, "ticket_done", {
    title: `Ticket erledigt: ${args.ticketTitle}`,
    message: `${args.byName} hat T-${args.ticketNumber} geschlossen.`,
    link: `/tickets/${args.ticketId}`,
    resource_type: "ticket",
    resource_id: args.ticketId,
  });
}

export async function notifyTicketRejected(
  client: SupabaseClient,
  args: BaseArgs & {
    ticketId: string;
    ticketNumber: number;
    ticketTitle: string;
    reason: string;
    byName: string;
  },
) {
  await deliver(client, args.recipients, "ticket_rejected", {
    title: `Ticket abgelehnt: ${args.ticketTitle}`,
    message: `${args.byName} hat T-${args.ticketNumber} abgelehnt: ${args.reason}`,
    link: `/tickets/${args.ticketId}`,
    resource_type: "ticket",
    resource_id: args.ticketId,
  });
}

// --- JOBS ----------------------------------------------------

export async function notifyJobAssigned(
  client: SupabaseClient,
  args: BaseArgs & {
    jobId: string;
    jobNumber: number;
    jobTitle: string;
    byName: string;
  },
) {
  await deliver(client, args.recipients, "job_assigned", {
    title: `Auftrag zugewiesen: ${args.jobTitle}`,
    message: `${args.byName} hat dich INT-${args.jobNumber} zugewiesen.`,
    link: `/auftraege/${args.jobId}`,
    resource_type: "job",
    resource_id: args.jobId,
  });
}

// --- APPOINTMENTS --------------------------------------------

export async function notifyAppointmentNew(
  client: SupabaseClient,
  args: BaseArgs & {
    appointmentId: string;
    appointmentTitle: string;
    jobId: string;
    jobNumber: number;
    startTime: string;
    byName: string;
  },
) {
  const when = new Date(args.startTime).toLocaleString("de-CH", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  await deliver(client, args.recipients, "appointment_new", {
    title: `Neuer Termin: ${args.appointmentTitle}`,
    message: `${when} - INT-${args.jobNumber}. Eingetragen von ${args.byName}.`,
    link: `/auftraege/${args.jobId}`,
    resource_type: "appointment",
    resource_id: args.appointmentId,
  });
}

// --- TODOS ---------------------------------------------------

export async function notifyTodoAssigned(
  client: SupabaseClient,
  args: BaseArgs & {
    todoId: string;
    todoTitle: string;
    byName: string;
    urgent?: boolean;
  },
) {
  await deliver(client, args.recipients, "todo_assigned", {
    title: `${args.urgent ? "Dringend: " : ""}${args.todoTitle}`,
    message: `${args.byName} hat dir ein Todo zugewiesen.`,
    link: `/todos`,
    resource_type: "todo",
    resource_id: args.todoId,
  });
}

// --- STEMPEL-REMINDER (CRON) ---------------------------------

/** Per-User-Reminder mit Job-Kontext. Wird vom Cron alle 30 Min
 *  pro offenen time_entry erzeugt — Recipients ist ein einzelner User. */
export async function notifyStempelReminderPerEntry(
  client: SupabaseClient,
  args: {
    userId: string;
    entryId: string;
    jobLabel: string;
    endIso: string;
  },
) {
  const endStr = new Date(args.endIso).toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  await deliver(client, [args.userId], "stempel_reminder", {
    title: `Stempeluhr laeuft noch: ${args.jobLabel}`,
    message: `Termin endete ${endStr} — bitte ausstempeln falls die Arbeit fertig ist.`,
    link: "/stempel",
    resource_type: "time_entry",
    resource_id: args.entryId,
  });
}

/** Generischer Stempel-Reminder ohne Job-Kontext. */
export async function notifyStempelReminder(
  client: SupabaseClient,
  args: BaseArgs & {
    sinceMin: number;
  },
) {
  await deliver(client, args.recipients, "stempel_reminder", {
    title: "Stempel laeuft noch",
    message: `Du bist seit ${args.sinceMin} Min eingestempelt — vergessen auszustempeln?`,
    link: "/stempelzeiten",
    resource_type: null,
    resource_id: null,
  });
}

// --- SYSTEM (fallback) ---------------------------------------

export async function notifySystem(
  client: SupabaseClient,
  args: BaseArgs & {
    title: string;
    message?: string | null;
    link?: string | null;
  },
) {
  await deliver(client, args.recipients, "system", {
    title: args.title,
    message: args.message ?? null,
    link: args.link ?? null,
    resource_type: null,
    resource_id: null,
  });
}
