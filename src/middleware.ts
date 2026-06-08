import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Cache-Control fuer authenticated App-Pages.
 *
 * Problem: Vercel-Edge cached prerendered HTML der "use client"-Pages
 * (~5min Stale-Time). Nach einem Deploy sieht ein User die alte HTML
 * mit alten Chunk-Hashes → laedt aus dem SW-Cache die alten JS-Chunks
 * → sieht alte App-Version bis er manuell hart-reloaded.
 *
 * Fix: 'private, no-store' wins gegenueber Vercel-Edge-Caching. Die
 * Edge speichert NICHT — jeder Request geht zum Origin und holt die
 * aktuelle HTML mit Chunk-Verweisen zum aktuellen Build. Browser cached
 * sie pro Tab kurz, aber bei Reload (egal ob User-trigger oder
 * SW-Auto-Reload) wird die aktuelle HTML geholt.
 *
 * Ausschluesse via matcher:
 *  - /_next/static/*  : content-hashed, eigene Cache-Policy
 *  - /api/* + /auth/* : Server haben eigene Cache-Headers
 *  - sw.js, manifest.json, favicon, Bilder/Fonts : eigene Cache-Policy
 *    bzw. statisch im /public-Bundle
 *  - /offline         : statische Fallback-Page, darf gecached werden
 */
export function middleware(_req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "private, no-store, must-revalidate");
  return res;
}

export const config = {
  matcher: [
    "/((?!api|auth|_next/static|_next/image|sw\\.js|manifest\\.json|favicon\\.ico|offline|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf)).*)",
  ],
};
