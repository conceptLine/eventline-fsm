"use client";

/**
 * Mobile-PDF-Viewer auf Basis von react-pdf (PDF.js).
 *
 * Warum nicht das <iframe> wie auf Desktop? Auf iOS/Android zeigt ein
 * iframe mit PDF-Quelle nur die ERSTE Seite und laesst sich nicht sinnvoll
 * zoomen/scrollen — man muss horizontal "herumschweben". Hier rendern wir
 * jede Seite selbst auf Canvas, breiten-angepasst (passt per Default exakt
 * in die Mobil-Breite) und mit Zoom-Buttons.
 *
 * Wird nur lazy auf Mobile geladen (next/dynamic, ssr:false in pdf-popup),
 * damit pdf.js nicht ins Haupt-Bundle wandert.
 */

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ZoomIn, ZoomOut, Loader2 } from "lucide-react";

// Worker lokal aus dem Bundle (kein externes CDN — robust & offline-fest).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

export default function PdfMobileViewer({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState(false);

  // Verfuegbare Breite messen (und bei Rotation/Resize aktualisieren), damit
  // die Seiten exakt in den Viewport passen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Seitenbreite = volle Breite * Zoom, minus etwas Polster.
  const pageWidth = containerWidth > 0 ? Math.floor((containerWidth - 16) * zoom) : undefined;

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full overflow-auto bg-muted/30 flex flex-col items-center py-2"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            PDF konnte nicht geladen werden.
          </div>
        ) : (
          <Document
            file={url}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            onLoadError={() => setError(true)}
            loading={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            }
          >
            {Array.from({ length: numPages }, (_, i) => (
              <Page
                key={i}
                pageNumber={i + 1}
                width={pageWidth}
                // Text-/Annotation-Layer aus: wir brauchen reine Darstellung,
                // das spart CSS-Setup und ist deutlich schneller.
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="mb-2 shadow-sm"
              />
            ))}
          </Document>
        )}
      </div>

      {/* Zoom-Steuerung — schwebt unten rechts, immer erreichbar. */}
      {numPages > 0 && !error && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-card/95 border border-border shadow-lg px-1 py-1 backdrop-blur">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.25) * 100) / 100))}
            disabled={zoom <= MIN_ZOOM}
            className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
            aria-label="Verkleinern"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="px-2 text-xs font-medium tabular-nums text-muted-foreground min-w-[3rem]"
            aria-label="Zoom zurücksetzen"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.25) * 100) / 100))}
            disabled={zoom >= MAX_ZOOM}
            className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
            aria-label="Vergrößern"
          >
            <ZoomIn className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
