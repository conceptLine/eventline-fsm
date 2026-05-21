/**
 * Landing-Seite nach Klick auf den Confirm-Link aus der Bestaetigungs-Mail.
 * Wird auch ohne Login angezeigt — wer auch immer den Link klickt
 * (typischerweise jemand mit Zugriff auf admin@eventline-basel.com) soll
 * eine klare Rueckmeldung bekommen.
 */

import Link from "next/link";

const MESSAGES: Record<string, { title: string; body: string; tone: "ok" | "info" | "error" }> = {
  ok: {
    title: "Geraet bestaetigt",
    body: "Das Geraet wurde als vertraut markiert. Der User kann jetzt auf Finanzen + Loehne zugreifen.",
    tone: "ok",
  },
  already: {
    title: "Bereits bestaetigt",
    body: "Dieses Geraet wurde schon einmal bestaetigt — der Link ist nur einmal gueltig.",
    tone: "info",
  },
  revoked: {
    title: "Geraet wurde widerrufen",
    body: "Der User hat dieses Geraet selbst entfernt. Eine neue Bestaetigung ist nicht moeglich — der User muss erneut anfragen.",
    tone: "info",
  },
  invalid: {
    title: "Ungueltiger Link",
    body: "Dieser Bestaetigungs-Link ist nicht (mehr) gueltig. Falls du den Link aus einer alten Email aufrufst, ignoriere ihn.",
    tone: "error",
  },
  missing: {
    title: "Token fehlt",
    body: "Der Link ist unvollstaendig — bitte den ganzen URL aus der Email aufrufen.",
    tone: "error",
  },
  error: {
    title: "Server-Fehler",
    body: "Etwas ist schiefgegangen beim Bestaetigen. Bitte spaeter erneut versuchen.",
    tone: "error",
  },
};

export default async function TrustResultPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; device?: string }>;
}) {
  const params = await searchParams;
  const status = params.status ?? "error";
  const device = params.device;
  const msg = MESSAGES[status] ?? MESSAGES.error;

  const toneColors = {
    ok: "text-emerald-600 dark:text-emerald-400",
    info: "text-blue-600 dark:text-blue-400",
    error: "text-red-600 dark:text-red-400",
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full bg-card border rounded-2xl p-8 shadow-sm">
        <h1 className={`text-xl font-semibold mb-3 ${toneColors[msg.tone]}`}>{msg.title}</h1>
        {device && (
          <p className="text-xs text-muted-foreground mb-4">
            Geraet: <span className="font-mono">{device}</span>
          </p>
        )}
        <p className="text-sm text-muted-foreground leading-relaxed">{msg.body}</p>
        <div className="mt-6">
          <Link href="/" className="text-sm text-foreground hover:underline">
            Zur App
          </Link>
        </div>
      </div>
    </div>
  );
}
