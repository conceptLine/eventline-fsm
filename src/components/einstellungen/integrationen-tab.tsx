"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Plug, X, Users, Wallet, ShieldAlert } from "lucide-react";
import { useConfirm } from "@/components/ui/use-confirm";
import { createClient } from "@/lib/supabase/client";
import { IcalFeedBlock } from "@/components/kalender/ical-feed-block";

interface BexioStatus {
  connected: boolean;
  connectedAt?: string;
  bexioEmail?: string | null;
  expiresAt?: string;
  features?: { contacts: boolean; accounting: boolean };
  capabilities?: { accounting: boolean };
}

export function IntegrationenTab() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<BexioStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [togglePending, setTogglePending] = useState<"contacts" | "accounting" | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const { confirm, ConfirmModalElement } = useConfirm();

  // Role-Check fuer das iCal-Feed-Sektion: nur Admins kriegen den Block
  // hier — fuer sie ist der Token-Filter automatisch der ganze Firma-
  // Kalender. Fuer normale User wuerde der Token nur den eigenen Feed
  // liefern, das ist nicht "Firma" und sie haben den Block jetzt eh
  // direkt auf der /kalender-Page.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      setIsAdmin(profile?.role === "admin");
    })();
  }, [supabase]);

  // OAuth-Rueckkehr: ?bexio=connected oder ?bexio=error&msg=...
  useEffect(() => {
    const result = searchParams.get("bexio");
    const msg = searchParams.get("msg");
    if (result === "connected") {
      toast.success("Bexio verbunden");
    } else if (result === "error") {
      toast.error("Bexio-Verbindung fehlgeschlagen" + (msg ? `: ${msg}` : ""));
    }
  }, [searchParams]);

  useEffect(() => { loadStatus(); }, []);

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await fetch("/api/bexio/status");
      const json = await res.json();
      setStatus(json);
    } catch {
      setStatus({ connected: false });
    }
    setLoading(false);
  }

  async function handleDisconnect() {
    const ok = await confirm({
      title: "Bexio trennen?",
      message: "Du musst danach neu verbinden, um Kontakte anzulegen.",
      confirmLabel: "Trennen",
      variant: "red",
    });
    if (!ok) return;
    setDisconnecting(true);
    await fetch("/api/bexio/disconnect", { method: "POST" });
    setDisconnecting(false);
    toast.success("Bexio getrennt");
    loadStatus();
  }

  async function toggleFeature(feature: "contacts" | "accounting", enabled: boolean) {
    setTogglePending(feature);
    try {
      const res = await fetch("/api/bexio/feature-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature, enabled }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        if (json.requiresReauth) {
          toast.error("Re-Auth noetig — klicke 'Budget-Scope freischalten'");
        } else {
          toast.error(json.error || "Aenderung fehlgeschlagen");
        }
        return;
      }
      toast.success(enabled ? "Modul aktiviert" : "Modul deaktiviert");
      loadStatus();
    } finally {
      setTogglePending(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Verknüpfe EVENTLINE mit externen Tools — z.B. Bexio für Kontaktverwaltung
          oder Google Calendar für persönliche Terminübersicht.
        </p>
      </div>

      {/* iCal-Feed Firma — dedizierter Token in app_settings, nicht an
          eine Person gebunden. Vorher war das der persoenliche Admin-Token,
          was strukturell falsch war (Token-Leak = Firma-Sicht-Leak,
          Admin-Deaktivierung = Firma-Feed-Tod). Block nur fuer Admins —
          RLS erlaubt nur ihnen das Lesen des Tokens. */}
      {isAdmin && (
        <IcalFeedBlock
          source="company"
          title="Kalender der Firma (iCal-Feed)"
          description={
            <>
              Dieser Feed enthält <strong>alle Aufträge + Termine</strong> der Firma — unabhängig von einzelnen Mitarbeitern.
              Kopiere die URL und füge sie in Google Calendar / Apple Calendar / Outlook über{" "}
              <span className="font-medium">&quot;Per URL hinzufügen&quot;</span> ein.
            </>
          }
        />
      )}

      <Card className="bg-card border-gray-100">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white font-bold shrink-0">
                B
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">Bexio</h3>
                  {loading ? (
                    <span className="text-xs text-muted-foreground">…</span>
                  ) : status?.connected ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      Verbunden
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300">
                      <AlertCircle className="h-3 w-3" />
                      Nicht verbunden
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Kunden direkt in Bexio anlegen — der "In Bexio anlegen"-Button erscheint dann auf jeder Kunden-Detailseite.
                </p>
                {status?.connected && status.connectedAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Verbunden seit {new Date(status.connectedAt).toLocaleString("de-CH", { timeZone: "Europe/Zurich" })}
                    {status.bexioEmail && <> · {status.bexioEmail}</>}
                  </p>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {loading ? null : status?.connected ? (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="kasten kasten-muted"
                >
                  <X className="h-3.5 w-3.5" />
                  {disconnecting ? "Trenne…" : "Komplett trennen"}
                </button>
              ) : (
                <a href="/api/bexio/connect" className="kasten kasten-bexio">
                  <Plug className="h-3.5 w-3.5" />
                  Verbinden
                </a>
              )}
            </div>
          </div>

          {/* Modul-Toggles — feingranulare Steuerung pro Daten-Strecke.
              Sichtbar nur wenn verbunden. */}
          {status?.connected && status.features && (
            <div className="mt-5 pt-5 border-t space-y-3">
              <div className="text-xs font-medium text-muted-foreground">Aktive Module</div>
              <FeatureRow
                icon={<Users className="h-4 w-4" />}
                label="Kunden-Sync"
                description="Kontakte in Bexio anlegen + Rechnungs-Link aus Auftrags-Archiv"
                enabled={status.features.contacts}
                pending={togglePending === "contacts"}
                onToggle={(v) => toggleFeature("contacts", v)}
              />
              <FeatureRow
                icon={<Wallet className="h-4 w-4" />}
                label="Budget-Soll/Ist"
                description="Taegliche Aggregation von Konto-Buchungen fuer die /budget-Seite"
                enabled={status.features.accounting}
                pending={togglePending === "accounting"}
                disabled={!status.capabilities?.accounting}
                disabledReason={
                  !status.capabilities?.accounting
                    ? "Token hat keinen accounting-Scope — bitte zuerst freischalten"
                    : undefined
                }
                onToggle={(v) => toggleFeature("accounting", v)}
                extraButton={
                  !status.capabilities?.accounting ? (
                    <a href="/api/bexio/connect?include=accounting" className="kasten kasten-bexio text-xs">
                      <Plug className="h-3 w-3" />
                      Budget-Scope freischalten
                    </a>
                  ) : null
                }
              />
              {!status.capabilities?.accounting && (
                <div className="flex gap-2 items-start text-xs text-muted-foreground p-3 rounded-lg bg-muted/40">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Fuer Budget-Soll/Ist braucht Bexio eine erweiterte Berechtigung
                    (<span className="font-mono">accounting</span> — Read-only-Zugriff auf Kontenrahmen + Buchungen).
                    Du wirst zu Bexio weitergeleitet, bestaetigst dort einmalig, und kommst zurueck.
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {ConfirmModalElement}
    </div>
  );
}

// =====================================================================
// Sub-Component: Feature-Toggle-Zeile
// =====================================================================

function FeatureRow({
  icon,
  label,
  description,
  enabled,
  pending,
  disabled,
  disabledReason,
  onToggle,
  extraButton,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  pending: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onToggle: (next: boolean) => void;
  extraButton?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="shrink-0 h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {extraButton}
        <button
          type="button"
          onClick={() => !disabled && !pending && onToggle(!enabled)}
          disabled={disabled || pending}
          data-tooltip={disabledReason}
          className={`kasten ${enabled ? "kasten-green" : "kasten-muted"} text-xs`}
        >
          {pending ? "..." : enabled ? "An" : "Aus"}
        </button>
      </div>
    </div>
  );
}
