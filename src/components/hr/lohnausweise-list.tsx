"use client";

/**
 * Lohnausweise-Liste — sieht jeder Mitarbeiter (eigene Dokumente).
 *
 * Aktuell ein Platzhalter: das Upload/Download-System fuer Lohnausweise
 * ist noch nicht gebaut. Wenn's so weit ist: Liste der PDF-Lohnausweise
 * (z.B. ueber Supabase Storage Bucket 'lohnausweise' mit signed URLs),
 * gefiltert nach profile_id = auth.uid().
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Clock } from "lucide-react";

export function LohnausweiseList() {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Meine Lohnausweise</h2>
        <p className="text-xs text-muted-foreground">
          Hier wirst du in Zukunft deine Lohnausweise als PDF herunterladen können.
        </p>
      </div>
      <Card className="bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <FileText className="h-4 w-4" />Verfügbare Dokumente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 text-sm text-muted-foreground p-3 rounded-lg bg-muted/40">
            <Clock className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Noch keine Lohnausweise hinterlegt. Sobald der erste Lohnausweis bereitsteht, erscheint er hier zum Download.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
