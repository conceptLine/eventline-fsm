import type { BlockCondition, FormBlock } from "./types";
import type { FormValues } from "@/components/partner-form/form-renderer";

/**
 * Wertet eine BlockCondition gegen einen Form-Values-Snapshot aus.
 *
 * Truthy-Definition (op='on') ist absichtlich grosszuegig damit der
 * Builder-User nicht ueberlegen muss "ist das jetzt boolean oder string":
 *   - boolean true
 *   - non-empty String
 *   - Number != 0
 *   - non-empty Array
 *   - Object mit min. einem truthy Wert (z.B. daterange { start: "..." })
 */
export function evaluateCondition(cond: BlockCondition | undefined, values: FormValues): boolean {
  if (!cond || !cond.blockId) return true;
  const raw = values[cond.blockId];
  switch (cond.op) {
    case "on":  return isTruthy(raw);
    case "off": return !isTruthy(raw);
    case "equals":     return String(raw ?? "") === String(cond.value ?? "");
    case "not-equals": return String(raw ?? "") !== String(cond.value ?? "");
    default: return true;
  }
}

function isTruthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).some(isTruthy);
  return Boolean(v);
}

/** Liefert true wenn der Block aktuell sichtbar ist (kein visibleIf oder
 *  visibleIf erfuellt). */
export function isBlockVisible(block: FormBlock, values: FormValues): boolean {
  return evaluateCondition(block.visibleIf, values);
}

/** Liefert true wenn der Block aktuell als Pflicht gilt (required + ggf.
 *  requiredIf erfuellt). */
export function isBlockRequired(required: boolean | undefined, cond: BlockCondition | undefined, values: FormValues): boolean {
  if (!required) return false;
  return evaluateCondition(cond, values);
}
