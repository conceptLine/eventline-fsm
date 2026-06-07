"use client";

/**
 * TrustedDeviceGate — Wrapper-Komponente fuer sensible Page-Inhalte.
 *
 *   <TrustedDeviceGate>
 *     <SensibleContent />
 *   </TrustedDeviceGate>
 *
 * Verhalten:
 *   • Lade /api/trust/status
 *   • Wenn trusted: rendere children
 *   • Wenn pending: zeige "wartet auf Bestaetigung"-Hinweis
 *   • Wenn nicht trusted: zeige Trust-Anfrage-Form (Geraete-Name + Button)
 *
 * Nach erfolgreicher Anfrage: UI auf "pending" — User wartet auf
 * Bestaetigung durch admin@eventline-basel.com. Page pollt nicht; User
 * muss nach Bestaetigung manuell reloaden.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Shield, ShieldCheck, Clock, MailCheck } from "lucide-react";
import { toast } from "sonner";

interface TrustStatus {
  trusted: boolean;
  pending: boolean;
  deviceName?: string;
}

export function TrustedDeviceGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<TrustStatus | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const res = await fetch("/api/trust/status");
    const json = await res.json();
    if (res.ok && json.success) {
      setStatus({ trusted: !!json.trusted, pending: !!json.pending, deviceName: json.deviceName });
    } else {
      setStatus({ trusted: false, pending: false });
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRequest() {
    const name = deviceName.trim();
    if (!name) {
      toast.error("Geraete-Name eingeben");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/trust/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_name: name }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error || "Anfrage fehlgeschlagen");
        return;
      }
      toast.success("Bestaetigungs-Mail an admin@eventline-basel.com gesendet");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  if (status === null) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Pruefe Geraete-Vertrauen ...</div>;
  }

  if (status.trusted) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          {status.pending ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <Clock className="h-5 w-5" />
                <h2 className="font-semibold">Wartet auf Bestaetigung</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Eine Bestaetigungs-Mail wurde an <span className="font-mono">admin@eventline-basel.com</span>{" "}
                gesendet. Sobald der Link aus der Mail geklickt wurde, hat dieses Geraet Zugriff auf
                Finanzen + Loehne.
              </p>
              {status.deviceName && (
                <p className="text-xs text-muted-foreground">
                  Geraete-Name: <span className="font-mono">{status.deviceName}</span>
                </p>
              )}
              <div className="pt-2">
                <button type="button" onClick={load} className="kasten kasten-muted text-sm">
                  Status neu pruefen
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h2 className="font-semibold">Vertrautes Geraet noetig</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Dieser Bereich (Finanzen, Loehne) ist nur auf vertrauten Geraeten zugaenglich.
                Damit kann ein gestohlenes Login allein keine sensiblen Daten einsehen — der Angreifer
                braeuchte zusaetzlich Zugriff auf <span className="font-mono">admin@eventline-basel.com</span>.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Geraete-Name</label>
                <Input
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="z.B. 'Buero-MacBook' oder 'iPhone Leo'"
                  maxLength={60}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRequest}
                  disabled={submitting || !deviceName.trim()}
                  className="kasten kasten-green"
                >
                  <MailCheck className="h-3.5 w-3.5" />
                  {submitting ? "Sende ..." : "Bestaetigungs-Mail anfragen"}
                </button>
              </div>
              <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 rounded-lg bg-muted/40 mt-2">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Die Mail geht zentral an <strong>admin@eventline-basel.com</strong> — nicht an deine
                  eigene Adresse. Nur wer diese Mailbox kontrolliert kann neue Geraete freischalten.
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
