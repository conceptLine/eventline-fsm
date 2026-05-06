import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { logError } from "@/lib/log";
import { EVE_SYSTEM_PROMPT } from "@/lib/eve-system-prompt";

/**
 * POST /api/chat
 * Streamed Chat-Endpoint fuer Eve via Google Gemini API.
 *
 * Phase 1: kein Tool-Use, kein DB-Zugriff. Nur System-Prompt + History.
 * Admin-only — RequireAdmin macht den Permission-Check, sodass Techniker
 * auch bei manuell getriggerten Calls keinen Zugriff bekommen.
 *
 * Request body: { messages: [{role: "user"|"model", text: string}] }
 * Response: text/event-stream mit Gemini-Streaming-Chunks
 */

interface ChatMessage {
  role: "user" | "model";
  text: string;
}

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent`;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY fehlt in der Server-Config" }, { status: 503 });
    }

    const body = await request.json();
    const messages = (body?.messages ?? []) as ChatMessage[];
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages fehlt" }, { status: 400 });
    }

    // Gemini-Format: contents-Array mit role + parts. System-Instruction
    // ist ein separates Top-Level-Feld, nicht im History-Array.
    const contents = messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));

    const geminiRes = await fetch(`${GEMINI_URL}?alt=sse&key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: EVE_SYSTEM_PROMPT }] },
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1024,
        },
      }),
    });

    if (!geminiRes.ok || !geminiRes.body) {
      const errText = await geminiRes.text();
      logError("api.chat.gemini", new Error(`Gemini ${geminiRes.status}: ${errText}`));
      return NextResponse.json({ error: `Gemini API Fehler (${geminiRes.status})` }, { status: 502 });
    }

    // SSE-Stream durchpipen — der Client parsed die "data: {...}"-Lines
    // und extrahiert die Text-Deltas selber, weil Gemini's Format JSON
    // pro Event ist statt nur Text.
    return new Response(geminiRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    logError("api.chat", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unbekannter Fehler" }, { status: 500 });
  }
}
