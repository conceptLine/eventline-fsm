"use client";

/**
 * Vertraute-Geraete-Karte unter /einstellungen → Mein Konto.
 *
 * Zeigt eigene Geraete-Liste (pending/approved) mit:
 *   • Geraete-Name + Browser/OS-Hint
 *   • Status-Badge
 *   • Last seen / Approved at
 *   • "Entfernen"-Button → revoke (Cookie wird auf dem entsprechenden
 *     Geraet beim naechsten API-Call zurueckgewiesen)
 *
 * Anfrage eines neuen Geraets passiert nicht von hier — sondern direkt
 * von der sensiblen Seite (HR-Loehne), die das TrustedDeviceGate
 * rendert. Diese Karte ist nur Listing + Cleanup.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, CheckCircle2, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/use-confirm";

interface Device {
  id: string;
  device_name: string;
  user_agent_hint: string | null;
  status: "pending" | "approved" | "revoked";
  requested_at: string;
  approved_at: string | null;
  last_seen_at: string;
  expires_at: string;
}

export function VertrauteGeraeteCard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm, ConfirmModalElement } = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/trust/devices");
    const json = await res.json();
    if (res.ok && json.success) {
      setDevices(json.devices as Device[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRevoke(d: Device) {
    const ok = await confirm({
      title: `"${d.device_name}" entfernen?`,
      message:
        "Dieses Geraet verliert sofort den Zugriff auf Finanzen + Loehne. Wenn du es spaeter wieder vertrauen willst, musst du den Bestaetigungs-Mail-Flow neu durchlaufen.",
      confirmLabel: "Entfernen",
      variant: "red",
    });
    if (!ok) return;
    const res = await fetch(`/api/trust/devices?id=${d.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || "Entfernen fehlgeschlagen");
      return;
    }
    toast.success("Geraet entfernt");
    load();
  }

  // Karte nur zeigen wenn mind. ein Geraet existiert — sonst gibt's nichts
  // zu verwalten (der Erst-Trust passiert via TrustedDeviceGate auf der
  // sensiblen Seite). Verhindert eine leere "noch keine Geraete"-Karte
  // im Standard-Settings-Layout.
  if (loading) return null;
  if (devices.length === 0) return null;

  return (
    <Card className="bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Shield className="h-4 w-4" />Vertraute Geräte
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-xs text-muted-foreground">
          Geräte mit Zugriff auf Finanzen + Löhne. Bestätigung erfolgt über admin@eventline-basel.com.
        </p>
        <ul className="divide-y border rounded-lg">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{d.device_name}</span>
                  {d.status === "approved" ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      Aktiv
                    </span>
                  ) : d.status === "pending" ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                      <Clock className="h-2.5 w-2.5" />
                      Wartet
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground truncate">{d.user_agent_hint ?? "—"}</div>
                <div className="text-[11px] text-muted-foreground">
                  {d.status === "approved" && d.approved_at
                    ? `Bestätigt: ${new Date(d.approved_at).toLocaleString("de-CH", { timeZone: "Europe/Zurich" })}`
                    : `Angefragt: ${new Date(d.requested_at).toLocaleString("de-CH", { timeZone: "Europe/Zurich" })}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRevoke(d)}
                className="p-1.5 rounded hover:bg-foreground/10 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                data-tooltip="Geraet entfernen"
                data-tooltip-align="end"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
      {ConfirmModalElement}
    </Card>
  );
}
