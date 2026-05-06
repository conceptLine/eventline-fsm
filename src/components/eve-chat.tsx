"use client";

/**
 * Eve — der app-interne Chatbot. Nur fuer Admins sichtbar.
 *
 * UI: Floating Bubble unten rechts (FAB). Click oeffnet ein nicht-modales
 * Panel (drag-/resize-bar wie PdfPopup). Streaming via Server-Sent-Events.
 *
 * Backend: /api/chat ruft Google Gemini (Free Tier). RequireAdmin im
 * Endpoint stellt sicher dass nur Admins Anfragen senden koennen — das
 * Conditional-Render im Layout ist UX, der API-Check ist die Sicherheit.
 *
 * History: Session-only — bewusst nicht persistiert. Bei Browser-Reload
 * leerer Chat. Vermeidet Privacy-Mess-Up wenn jemand am gemeinsam
 * genutzten Geraet eingeloggt war.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X, Send, RotateCcw } from "lucide-react";

interface Message {
  role: "user" | "model";
  text: string;
}

const GREETING: Message = {
  role: "model",
  text: "Hoi, ich bin Eve. Ich kenne die App und helfe dir bei Bedienfragen — sag was du suchst.",
};

export function EveChat() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    return { x: window.innerWidth - 420, y: window.innerHeight - 620 };
  });
  const [size, setSize] = useState({ w: 380, h: 560 });
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setMounted(true), []);

  // Auto-scroll zum letzten Message bei jeder Aenderung.
  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages]);

  // Drag-Handling — Pattern aus PdfPopup uebernommen.
  function onHeaderMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragOffset.current.y)),
      });
    }
    function onUp() { setDragging(false); }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const next: Message[] = [...messages, { role: "user", text }, { role: "model", text: "" }];
    setMessages(next);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Gemini erwartet die History inklusive des juengsten User-Msgs aber
      // OHNE den noch leeren Model-Placeholder (sonst antwortet er auf seine
      // eigene leere Antwort).
      const apiHistory = next.slice(0, -1).map((m) => ({ role: m.role, text: m.text }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiHistory }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Netzwerkfehler" }));
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "model", text: `⚠️ ${err.error ?? "Fehler"}` };
          return copy;
        });
        return;
      }

      // SSE-Stream parsen — Gemini schickt "data: {...JSON...}\n\n" pro Chunk.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const obj = JSON.parse(json);
            const delta = obj?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (delta) {
              acc += delta;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "model", text: acc };
                return copy;
              });
            }
          } catch {
            // Einzelne kaputte Chunks verschlucken — Gemini sendet manchmal
            // unvollstaendiges JSON wenn der Stream-Buffer mitten im Token
            // gepeendet ist. Beim naechsten Chunk kommt der Rest.
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "model", text: "⚠️ Verbindung abgebrochen." };
        return copy;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function reset() {
    abortRef.current?.abort();
    setMessages([GREETING]);
    setInput("");
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sendet, Shift+Enter macht Zeilenumbruch.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (!mounted) return null;

  const bubble = !open ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="fixed bottom-6 right-6 z-[1300] flex items-center justify-center h-12 w-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-2xl hover:scale-105 transition-transform"
      aria-label="Eve öffnen"
      data-tooltip="Eve fragen"
      data-tooltip-side="top"
    >
      <MessageCircle className="h-5 w-5" />
    </button>
  ) : null;

  const panel = open ? (
    <div
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        minWidth: 320,
        minHeight: 320,
        maxWidth: "95vw",
        maxHeight: "92vh",
        resize: "both",
        overflow: "hidden",
        zIndex: 1300,
      }}
      className="bg-card border border-border rounded-xl shadow-2xl flex flex-col"
    >
      <div
        onMouseDown={onHeaderMouseDown}
        className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-gradient-to-r from-blue-500/10 to-purple-500/10 cursor-move select-none shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shrink-0">
            <MessageCircle className="h-3 w-3" />
          </div>
          <span className="text-sm font-semibold">Eve</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={reset}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            data-tooltip="Chat zurücksetzen"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-muted/10">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                m.role === "user"
                  ? "bg-blue-500 text-white rounded-br-sm"
                  : "bg-card border border-border rounded-bl-sm"
              }`}
            >
              {m.text || (streaming && i === messages.length - 1 ? "…" : "")}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-2 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Frag Eve…"
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none px-3 py-2 text-sm rounded-xl border bg-background focus:outline-none focus:ring-2 focus:ring-ring/40 max-h-32"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            type="button"
            onClick={send}
            disabled={streaming || !input.trim()}
            className="kasten kasten-blue shrink-0 disabled:opacity-40"
            data-tooltip="Senden (Enter)"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {bubble && createPortal(bubble, document.body)}
      {panel && createPortal(panel, document.body)}
    </>
  );
}
