"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PartnerBelegungsplan } from "@/components/partner-belegungsplan";

// Partner-Belegungsplan: Monats-Kalender + Buchungs-Liste fuer die
// zugewiesene Location. Eigene Anfragen mit Titel sichtbar, Eventline-
// interne Buchungen als "Belegt" maskiert (Maskierung macht das
// /api/belegungsplan-Endpoint anhand der user_can_see_job-RLS).

export default function PartnerBelegungsplanPage() {
  const supabase = createClient();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("partner_location_id")
        .eq("id", user.id)
        .maybeSingle();
      setLocationId(data?.partner_location_id ?? null);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="h-64 rounded-xl bg-foreground/10 dark:bg-foreground/15 animate-pulse" />;
  }

  if (!locationId) {
    return (
      <div className="rounded-xl border border-dashed bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Deinem Profil ist keine Location zugewiesen. Wende dich an EVENTLINE.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Belegungsplan</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Übersicht deiner Location. EVENTLINE-interne Buchungen erscheinen als „Belegt" ohne Details.
        </p>
      </div>
      <PartnerBelegungsplan locationId={locationId} />
    </div>
  );
}
