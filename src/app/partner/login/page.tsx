"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { Info } from "lucide-react";

// Partner-Login — eigene Seite, eigener Redirect-Pfad (/partner/anfragen).
// Authentifizierung-Logik teilt sich mit /login, aber:
//  - Nach erfolg: Profil-Rolle pruefen. Nur 'partner' darf bleiben. Andere
//    Rollen werden mit Hinweis abgewiesen (sie sollen ueber /login rein).
//  - Reset-Password-Flow ist hier nicht; Partner-Admin (Leo) loescht/legt
//    den Partner neu an wenn was schief geht.

export default function PartnerLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  // ?reason=… — wenn der Partner versehentlich uebers Firmen-Login kam,
  // schiebt /login ihn hierher und wir zeigen einen kurzen Hinweis.
  const reason = useSearchParams().get("reason");
  const fromWrongPortal = reason === "wrong_portal";

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("E-Mail oder Passwort ist falsch.");
      setLoading(false);
      return;
    }

    if (data.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", data.user.id)
        .maybeSingle();
      if (!profile || profile.is_active === false) {
        await supabase.auth.signOut();
        setError("Dein Benutzer hat im Moment keinen Zugriff. Wende dich an EVENTLINE.");
        setLoading(false);
        return;
      }
      if (profile.role !== "partner") {
        await supabase.auth.signOut();
        setError("Dieser Login ist nur für Location-Partner. EVENTLINE-Mitarbeiter bitte über die normale Login-Seite.");
        setLoading(false);
        return;
      }
    }

    router.push("/partner/anfragen");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md border shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="mb-4 flex justify-center items-start gap-4">
            <Logo size="lg" />
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground mt-1">
              Partner
            </p>
          </div>
          <p className="text-sm text-gray-500">
            Field Service Management
          </p>
        </CardHeader>
        <CardContent>
          {fromWrongPortal && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 px-3 py-2.5 text-xs">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div className="text-amber-800 dark:text-amber-200">
                <strong className="font-semibold">Falsches Login.</strong>{" "}
                Als Location-Partner musst du dich hier auf der Partner-Login-Seite anmelden. Bitte erneut einloggen.
              </div>
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input id="email" type="email" placeholder="partner@firma.ch" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <Input id="password" type="password" placeholder="Passwort eingeben" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white" disabled={loading}>
              {loading ? "Anmelden..." : "Anmelden"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
