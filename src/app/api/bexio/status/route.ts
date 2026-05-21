import { NextResponse } from "next/server";
import { getConnection, ACCOUNTING_SCOPE } from "@/lib/bexio";
import { requireUser } from "@/lib/api-auth";

// Status fuer das Frontend: Ist Bexio verbunden? Wer hat es verbunden, wann?
// Welche Module sind aktiv? Welche Scopes hat der Token?
// Token selbst NIE rausgeben — nur Metadaten.
//
// Auth-Check: nur fuer eingeloggte User. Vorher kein Check — die
// Bexio-Connect-Email war fuer jeden mit der URL einsehbar (Info-
// Disclosure).
export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const conn = await getConnection();
  if (!conn) {
    return NextResponse.json({ connected: false });
  }
  const grantedScopes = (conn.scope ?? "").split(/\s+/).filter(Boolean);
  return NextResponse.json({
    connected: true,
    connectedAt: conn.connected_at,
    bexioEmail: conn.bexio_user_email,
    expiresAt: conn.expires_at,
    features: {
      contacts: conn.feature_contacts,
      accounting: conn.feature_accounting,
    },
    capabilities: {
      // Wird der accounting-Scope vom aktuellen Token abgedeckt? Wenn nein,
      // muss der User Re-Auth durchlaufen bevor er feature_accounting an
      // schalten kann.
      accounting: grantedScopes.includes(ACCOUNTING_SCOPE),
    },
  });
}
