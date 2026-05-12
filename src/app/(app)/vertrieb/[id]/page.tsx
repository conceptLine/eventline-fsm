"use client";

/**
 * Vertrieb-Lead-Detail-Page.
 *
 * Wrapper um <LeadEditor> — analog zur /auftraege/[id]-Page als eigene
 * Detail-Ansicht statt Inline-Overlay ueber der Liste. Zeigt das Form
 * fuer den Lead mit allen Aktions-Modals, navigiert beim Schliessen
 * zurueck zur Liste.
 */

import { useParams, useRouter } from "next/navigation";
import { LeadEditor } from "@/components/vertrieb/lead-editor";

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  // router.back() statt router.push("/vertrieb") — sonst feuert kein
  // popstate-Event und die globale Scroll-Restauration in (app)/layout.tsx
  // greift nicht. Fallback fuer Direkt-Links (history-Length === 1) wie
  // beim BackButton.
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/vertrieb");
    }
  };
  return <LeadEditor contactId={id} onClose={goBack} />;
}
