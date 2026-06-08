"use client";

import { useEffect } from "react";

/**
 * PWA-Service-Worker Registration + Auto-Update.
 *
 * Lifecycle:
 *  1. Initial-Load: registriert /sw.js mit updateViaCache='none' damit der
 *     Browser sw.js NIE aus seinem HTTP-Cache nimmt — er fragt immer den
 *     Server. Bei jedem Deploy ist sw.js byte-different (CACHE-Version =
 *     Build-Hash, siehe app/sw.js/route.ts), daher detected der Browser
 *     ein Update.
 *  2. Periodic Check (jede 60s im Foreground): registration.update()
 *     pingt den Server. Wenn ein neuer SW da ist, wird er installiert.
 *  3. Tab-Visibility: wenn der User den Tab wieder in den Vordergrund
 *     bringt, sofort updaten — typischer Fall: User hatte App seit Stunden
 *     im Hintergrund, neuer Deploy ging derweil live.
 *  4. Neuer SW installed → skipWaiting() (im SW selber) → activate →
 *     navigator.serviceWorker.controllerchange feuert → wir reloaden die
 *     Page automatisch, damit der User sofort die neue Version sieht.
 *
 * Nur in Production: im Dev-Modus wuerde ein cachender SW staendig zu
 * veralteten Next-Chunks fuehren.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let intervalId: number | undefined;
    let refreshing = false;

    function handleControllerChange() {
      // Nur einmal reloaden — controllerchange kann mehrfach feuern.
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    }

    function handleVisibility() {
      if (document.visibilityState === "visible" && registration) {
        registration.update().catch(() => {});
      }
    }

    function register() {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          registration = reg;
          // Periodischer Update-Check. 60s ist ein guter Kompromiss —
          // selten genug um keine Network-Last zu erzeugen, oft genug
          // dass ein Deploy in <2 Min auf jedem Tab sichtbar wird.
          intervalId = window.setInterval(() => {
            reg.update().catch(() => {});
          }, 60_000);
        })
        .catch(() => {
          // Best-effort — Registrierung darf die App nicht stoeren.
        });

      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
      document.addEventListener("visibilitychange", handleVisibility);
    }

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      if (intervalId) window.clearInterval(intervalId);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return null;
}
