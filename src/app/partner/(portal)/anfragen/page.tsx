"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Clock, Check, XCircle, ArrowRight, FileText } from "lucide-react";

interface PartnerAnfrage {
  id: string;
  job_number: number | null;
  title: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  created_at: string;
  partner_response_message: string | null;
}

function statusStyle(status: string) {
  switch (status) {
    case "partner_anfrage":
      return { label: "Anfrage offen", icon: Clock, bg: "bg-amber-50 dark:bg-amber-500/15", text: "text-amber-800 dark:text-amber-300", border: "border-amber-200 dark:border-amber-500/30" };
    case "offen":
    case "abgeschlossen":
      return { label: status === "offen" ? "Bestätigt" : "Abgeschlossen", icon: Check, bg: "bg-green-50 dark:bg-green-500/15", text: "text-green-800 dark:text-green-300", border: "border-green-200 dark:border-green-500/30" };
    case "storniert":
      return { label: "Abgelehnt", icon: XCircle, bg: "bg-red-50 dark:bg-red-500/15", text: "text-red-800 dark:text-red-300", border: "border-red-200 dark:border-red-500/30" };
    default:
      return { label: status, icon: Clock, bg: "bg-muted/30", text: "text-foreground/70", border: "border-border" };
  }
}

export default function PartnerAnfragenPage() {
  const router = useRouter();
  const supabase = createClient();
  const [anfragen, setAnfragen] = useState<PartnerAnfrage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // RLS laesst den Partner alle Jobs an seiner Location sehen (damit
      // der Belegungsplan funktioniert). Hier filtern wir aber explizit auf
      // EIGENE Anfragen — sonst tauchen Eventline-interne Auftraege/Vermiet-
      // entwuerfe an seinem Standort in "Meine Anfragen" auf.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from("jobs")
        .select("id, job_number, title, start_date, end_date, status, created_at, partner_response_message")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .limit(100);
      setAnfragen((data ?? []) as PartnerAnfrage[]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Meine Anfragen</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Erstelle Anfragen für Veranstaltungen an deinem Standort. Eventline bestätigt oder lehnt ab.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/partner/anfragen/neu")}
          className="kasten kasten-red"
        >
          <Plus className="h-3.5 w-3.5" />
          Neue Anfrage
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse bg-card">
              <CardContent className="p-4">
                <div className="h-5 bg-foreground/10 dark:bg-foreground/15 rounded w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : anfragen.length === 0 ? (
        <Card className="bg-card border-dashed">
          <CardContent className="py-16 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-foreground/10 dark:bg-foreground/15 flex items-center justify-center mb-4">
              <FileText className="h-7 w-7 text-foreground/40" />
            </div>
            <h3 className="font-semibold text-lg">Noch keine Anfragen</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Klick auf „Neue Anfrage" um zu starten.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {anfragen.map((a) => {
            const s = statusStyle(a.status);
            const Icon = s.icon;
            return (
              <Link
                key={a.id}
                href={`/partner/anfragen/${a.id}`}
                className="block group"
              >
                <Card className="bg-card hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border ${s.bg} ${s.text} ${s.border}`}>
                            <Icon className="h-3 w-3" />
                            {s.label}
                          </span>
                          {a.job_number && (
                            <span className="text-[10px] font-mono text-muted-foreground bg-foreground/[0.05] dark:bg-foreground/10 px-1.5 py-0.5 rounded">
                              INT-{String(a.job_number).padStart(4, "0")}
                            </span>
                          )}
                        </div>
                        <h3 className="font-semibold text-sm truncate">{a.title}</h3>
                        {(a.start_date || a.end_date) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {a.start_date && new Date(a.start_date).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            {a.end_date && a.end_date !== a.start_date && ` – ${new Date(a.end_date).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })}`}
                          </p>
                        )}
                        {a.status === "storniert" && a.partner_response_message && (
                          <p className="text-xs text-red-700 dark:text-red-300 mt-1.5">
                            Grund: {a.partner_response_message}
                          </p>
                        )}
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
