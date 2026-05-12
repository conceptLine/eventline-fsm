"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// App-weite Scroll-Position-Restauration auf Back-Navigation.
//
// Default-Next.js-Verhalten im App-Router:
//   - Forward-Nav (Link/router.push)   -> scrollt nach oben
//   - Back-Nav   (router.back/Browser) -> versucht zu restoren, klappt
//                                         aber nicht zuverlaessig wenn
//                                         die Page Async-Daten laedt
//                                         (Daten = noch nicht da = Page
//                                         ist 0px hoch = scroll-to-Y
//                                         clipt auf 0)
//
// Loesung: scrollRestoration auf "manual" stellen, scrollY pro URL in
// sessionStorage spiegeln, bei popstate auf die gleiche URL die letzte
// gespeicherte Position wiederherstellen — mit RAF-Retry, weil Listen
// erst auf Datenladung wachsen.

let popstateFired = false;
let popstateUrl: string | null = null;
if (typeof window !== "undefined") {
  // EIN globaler Listener — der Hook selbst registriert keinen, sonst
  // doppelte Events bei jedem Mount.
  window.addEventListener("popstate", () => {
    popstateFired = true;
    popstateUrl = window.location.pathname + window.location.search;
  });
}

const storageKey = (url: string) => `scroll:${url}`;

export function useScrollRestoration() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const url = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : "");

  // Browser's auto-Restore deaktivieren — wir machen's selbst, sonst
  // springt der Browser auf 0 bevor unsere Daten da sind.
  useEffect(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  // Position auf jedem Scroll-Event mitschreiben. KEIN initial-save beim
  // Mount: bei "manual"-Restoration springt der Browser auf Back-Nav
  // nicht auf 0, der scrollY-Wert der vorherigen Page lebt fort —
  // ein initial-save wuerde damit den korrekten saved-Wert (z.B. 500
  // von vorher) ueberschreiben mit dem Muell-Wert (z.B. 200 vom Detail).
  // Beim Cleanup speichern wir nochmal final, damit eine kurz-besuchte
  // Page (User hat nicht gescrollt) trotzdem den Endstand kriegt.
  useEffect(() => {
    let isRestoring = false;
    const save = () => {
      if (isRestoring) return; // Restore-RAF nicht in den Storage reinpfuschen lassen
      try {
        sessionStorage.setItem(storageKey(url), String(window.scrollY));
      } catch { /* quota oder private-mode — egal */ }
    };
    window.addEventListener("scroll", save, { passive: true });

    // Wenn diese URL durch popstate erreicht wurde: gespeicherte Position
    // restoren. RAF-Retry weil Async-Daten die DOM-Hoehe erst nachladen.
    let cancelled = false;
    if (popstateFired && popstateUrl === url) {
      popstateFired = false;
      popstateUrl = null;
      let saved: string | null = null;
      try { saved = sessionStorage.getItem(storageKey(url)); } catch { /* ignore */ }
      const target = saved ? parseInt(saved, 10) : NaN;
      if (Number.isFinite(target) && target > 0) {
        isRestoring = true;
        let tries = 0;
        const restore = () => {
          if (cancelled) return;
          window.scrollTo(0, target);
          if (Math.abs(window.scrollY - target) > 10 && tries++ < 30) {
            requestAnimationFrame(restore);
          } else {
            isRestoring = false;
            // letzten Stand sauber persistieren
            try { sessionStorage.setItem(storageKey(url), String(window.scrollY)); } catch { /* ignore */ }
          }
        };
        requestAnimationFrame(restore);
      }
    }

    return () => {
      cancelled = true;
      window.removeEventListener("scroll", save);
      // final save — nur wenn wir nicht gerade mitten in einem Restore
      // stecken; sonst koennte ein halb-fertiger scrollTo-Zwischenwert
      // in den Storage rutschen.
      if (!isRestoring) {
        try { sessionStorage.setItem(storageKey(url), String(window.scrollY)); } catch { /* ignore */ }
      }
    };
  }, [url]);
}
