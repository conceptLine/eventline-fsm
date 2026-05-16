"use client";

// Hook fuer "Wirklich loeschen?"-Dialoge — Ersatz fuer browser-natives confirm().
// Nutzt die zentrale Modal-Komponente, sieht ueberall gleich aus.
//
// Verwendung:
//   const { confirm, ConfirmModalElement } = useConfirm();
//
//   async function deleteThing() {
//     const ok = await confirm({
//       title: "Wirklich loeschen?",
//       message: `"${thing.name}" wird unwiderruflich entfernt.`,
//       confirmLabel: "Loeschen",
//       variant: "red",
//     });
//     if (!ok) return;
//     // ... delete-logic
//   }
//
//   return <>{...}{ConfirmModalElement}</>;

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'red' (default) fuer destruktive Aktionen, 'blue' fuer Bestaetigungen. */
  variant?: "red" | "blue";
  /** Wenn > 0: Bestaetigen-Button ist N Sekunden lang disabled mit
   *  Countdown im Label. Zwingt den User zum Lesen bei kritischen Aktionen. */
  confirmDelaySec?: number;
}

interface State {
  open: boolean;
  options: ConfirmOptions;
}

export function useConfirm() {
  const [state, setState] = useState<State>({
    open: false,
    options: { title: "" },
  });
  // Resolver wird gerufen sobald User bestaetigt oder abbricht.
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState({ open: true, options });
    });
  }, []);

  const handleClose = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  const handleConfirm = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
    resolverRef.current?.(true);
    resolverRef.current = null;
  }, []);

  const variant = state.options.variant ?? "red";
  const confirmClass = variant === "red" ? "kasten kasten-red" : "kasten kasten-blue";

  // Countdown-Timer: laeuft nur wenn confirmDelaySec gesetzt + Modal offen.
  const [secondsLeft, setSecondsLeft] = useState(0);
  useEffect(() => {
    if (!state.open) { setSecondsLeft(0); return; }
    const delay = state.options.confirmDelaySec ?? 0;
    if (delay <= 0) { setSecondsLeft(0); return; }
    setSecondsLeft(delay);
    const start = Date.now();
    const tick = setInterval(() => {
      const remaining = Math.max(0, delay - Math.floor((Date.now() - start) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) clearInterval(tick);
    }, 250);
    return () => clearInterval(tick);
  }, [state.open, state.options.confirmDelaySec]);

  const confirmLabel = state.options.confirmLabel ?? "Bestätigen";
  const confirmDisabled = secondsLeft > 0;

  const ConfirmModalElement = (
    <Modal
      open={state.open}
      onClose={handleClose}
      title={state.options.title}
      size="sm"
    >
      {state.options.message && (
        <p className="text-sm text-muted-foreground whitespace-pre-line">{state.options.message}</p>
      )}
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={handleClose} className="kasten kasten-muted flex-1">
          {state.options.cancelLabel ?? "Abbrechen"}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirmDisabled}
          className={`${confirmClass} flex-1 disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {confirmDisabled ? `${confirmLabel} (${secondsLeft}s)` : confirmLabel}
        </button>
      </div>
    </Modal>
  );

  return { confirm, ConfirmModalElement };
}
