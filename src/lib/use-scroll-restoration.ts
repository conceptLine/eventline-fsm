"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// App-weite Scroll-Position-Restauration auf Back-Navigation.
//
// Default-Verhalten im App-Router:
//   - Forward-Nav (Link/router.push)   -> scrollt nach oben
//   - Back-Nav   (router.back/Browser) -> tries to restore, klappt aber
//                                          nicht zuverlaessig wenn die
//                                          Page Async-Daten laedt
//
// Loesung: bei popstate (Back-Nav) gespeicherte Position aus
// sessionStorage zurueckschreiben, mit RAF-Retry weil Listen erst auf
// Datenladung wachsen.
//
// Wichtig: Scroll-Container ist NICHT window. Der Layout-Wrapper hat
// overflow-x:hidden, dadurch wird overflow-y implizit auto (CSS-Quirk)
// und dieser Div scrollt — nicht das Document. Wir targetieren den
// Container via id="app-scroll".

let popstateFired = false;
let popstateUrl: string | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    popstateFired = true;
    popstateUrl = window.location.pathname + window.location.search;
  });
}

const storageKey = (url: string) => `scroll:${url}`;

function getScroller(): HTMLElement | Window {
  if (typeof document === "undefined") return globalThis as unknown as Window;
  return document.getElementById("app-scroll") ?? window;
}

function getScrollTop(el: HTMLElement | Window): number {
  return el instanceof Window ? el.scrollY : el.scrollTop;
}

function setScrollTop(el: HTMLElement | Window, y: number): void {
  if (el instanceof Window) el.scrollTo(0, y);
  else el.scrollTop = y;
}

export function useScrollRestoration() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const url = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : "");

  // Browser-Auto-Restore deaktivieren — wir machen's selbst.
  useEffect(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    const scroller = getScroller();
    let isRestoring = false;

    const save = () => {
      if (isRestoring) return; // RAF-Zwischenstaende nicht persistieren
      try {
        sessionStorage.setItem(storageKey(url), String(getScrollTop(scroller)));
      } catch { /* quota/private-mode */ }
    };
    scroller.addEventListener("scroll", save, { passive: true });

    // Restore wenn diese URL durch popstate (Back) erreicht wurde.
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
          setScrollTop(scroller, target);
          if (Math.abs(getScrollTop(scroller) - target) > 10 && tries++ < 30) {
            requestAnimationFrame(restore);
          } else {
            isRestoring = false;
            try { sessionStorage.setItem(storageKey(url), String(getScrollTop(scroller))); } catch { /* ignore */ }
          }
        };
        requestAnimationFrame(restore);
      }
    }

    return () => {
      cancelled = true;
      scroller.removeEventListener("scroll", save);
      if (!isRestoring) {
        try { sessionStorage.setItem(storageKey(url), String(getScrollTop(scroller))); } catch { /* ignore */ }
      }
    };
  }, [url]);
}
