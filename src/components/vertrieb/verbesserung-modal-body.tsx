"use client";

import { Mail } from "lucide-react";

interface Props {
  verbesserungText: string;
  setVerbesserungText: (t: string) => void;
  onSend: () => void | Promise<void>;
  onClose: () => void;
  sending: boolean;
}

export function VerbesserungModalBody({ verbesserungText, setVerbesserungText, onSend, onClose, sending }: Props) {
  return (
    <>
      <p className="text-sm text-gray-700 dark:text-gray-300">An <strong>buchhaltung@eventline-basel.com</strong> — was soll an der Offerte verbessert werden?</p>
      <div>
        <label className="text-sm font-medium">Verbesserungen *</label>
        <textarea
          value={verbesserungText}
          onChange={(e) => setVerbesserungText(e.target.value)}
          placeholder="z.B. Preis anpassen, Leistungen ergänzen, Datum ändern..."
          className="mt-1.5 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-gray-50 dark:bg-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-green-500/20"
          rows={5}
          autoFocus
        />
      </div>
      <div className="flex gap-3">
        <button onClick={onClose} className="kasten kasten-muted flex-1">Abbrechen</button>
        <button onClick={onSend} disabled={!verbesserungText.trim() || sending} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
          <Mail className="h-4 w-4" />{sending ? "Senden..." : "Senden"}
        </button>
      </div>
    </>
  );
}
