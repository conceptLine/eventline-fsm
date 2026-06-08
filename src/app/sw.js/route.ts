import { NextResponse } from "next/server";

/**
 * Service Worker — DYNAMISCH generiert pro Build.
 *
 * Warum nicht static (/public/sw.js)?
 *   - Ein statisches sw.js ist byte-identisch zwischen Builds → der Browser
 *     erkennt KEIN Update → der alte SW bleibt aktiv → User sieht alte App
 *     bis er manuell den Cache loescht. Nicht akzeptabel.
 *
 * Loesung: bei jedem Build wird die CACHE-Version aus VERCEL_GIT_COMMIT_SHA
 * gesetzt. Damit ist sw.js byte-different zwischen Deploys → Browser laedt
 * neue Version → install → activate → ServiceWorkerRegister im Client
 * triggert window.location.reload() via 'controllerchange' Event.
 *
 * Verhalten ist sonst identisch zum vorherigen /public/sw.js:
 *   - Navigations: network-first, /offline-Fallback
 *   - /api/* und /auth/*: nie abfangen
 *   - Supabase (cross-origin): nie abfangen
 *   - /_next/static/* und Bilder/Fonts: cache-first (immutable)
 */

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ||
    process.env.NEXT_PUBLIC_BUILD_ID ||
    "dev";

  const sw = `// EVENTLINE FSM — Service Worker (build ${version})
// AUTO-GENERATED. Nicht direkt editieren — Quelle ist src/app/sw.js/route.ts.

const CACHE = "eventline-${version}";
const PRECACHE = [
  "/offline",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Client kann manuelles Skip-Waiting ausloesen (z.B. via "Update jetzt"-Button).
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isImmutableStatic(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    /\\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf)$/i.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline").then((r) => r || Response.error()))
    );
    return;
  }

  if (isImmutableStatic(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return res;
          })
      )
    );
    return;
  }
});
`;

  return new NextResponse(sw, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Browser darf sw.js nicht aus seinem HTTP-Cache nehmen — er muss
      // immer den Server fragen damit neue Builds erkannt werden. Plus
      // Service-Worker-Allowed Header damit der SW im root-scope laufen darf
      // (auch wenn sein Pfad /sw.js ist).
      "Cache-Control": "no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
