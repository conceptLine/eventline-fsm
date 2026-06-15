/**
 * Timezone-Discipline-Guard — bricht den Build wenn jemand
 * UTC-Datums-Anti-Patterns in src/ einfuehrt.
 *
 * Hintergrund: am 2026-06-15 hatten wir den dritten Timezone-Bug
 * (Auftrag INT-26285 wurde als 13.06 statt 14.06 angezeigt) weil
 * `new Date(iso).toLocaleString(...)` ohne `timeZone: 'Europe/Zurich'`
 * im SSR (Vercel = UTC) das UTC-Datum rendert, und weil `.slice(0,10)`
 * bzw. `.split('T')[0]` auf einer timestamptz-Spalte den UTC-Tag liefert
 * statt den Zurich-Tag. Leo's Reaktion war "darf darf NIE MEHR passieren".
 *
 * Dieser Test scanst alle src/**.{ts,tsx}-Dateien und failed wenn:
 *   - ein `toLocale(String|DateString|TimeString)`-Call ohne `timeZone:`-Key
 *     in den Optionen vorkommt
 *   - `.slice(0, 10)` oder `.split("T")[0]` auf einem String aufgerufen
 *     wird (die einzigen Stellen wo das OK ist: src/lib/swiss-time.ts und
 *     dieser Test selbst — die sind in ALLOWED_FILES)
 *
 * Wenn du diesen Test rot kriegst: fixe den Code, NICHT den Test. Bei
 * absoluter Notwendigkeit (z.B. neue swiss-time-internal-Funktion) fuege
 * die Datei zur ALLOWED_FILES-Liste hinzu — aber dokumentiere warum.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC_ROOT = join(process.cwd(), "src");

// Dateien die die Anti-Patterns legitim nutzen duerfen (intern korrekt).
const ALLOWED_FILES = new Set([
  "lib/swiss-time.ts",
  "lib/timezone-guard.test.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function normalizeRel(file: string): string {
  return relative(SRC_ROOT, file).split(sep).join("/");
}

interface Finding {
  file: string;
  line: number;
  excerpt: string;
  rule: string;
}

const TO_LOCALE_DATE_OR_TIME_RE = /\.toLocale(?:DateString|TimeString)\s*\(/;
const TO_LOCALE_STRING_RE = /\.toLocaleString\s*\(/;
const TIMEZONE_RE = /timeZone\s*:/;
// Datum/Zeit-Optionen-Keys — wenn einer davon im Window auftaucht,
// formatiert toLocaleString ein Datum/Zeit, nicht eine Zahl.
const DATE_TIME_KEY_RE = /\b(?:day|month|year|hour|minute|second|weekday|hour12|fractionalSecondDigits|timeZoneName|era|calendar)\s*:/;
// Beleg fuer "options-arg ist da": vom Match-Ende bis zum naechsten Newline
// oder Semikolon den Rest der Zeile checken. Wenn `timeZone:` darin fehlt,
// ist es ein Versto. Vereinfachung: wir checken die GESAMTE Zeile (manchmal
// stehen die Optionen mehrzeilig — dann checken wir die naechsten 3 Zeilen).

function isCommentLine(raw: string): boolean {
  const t = raw.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function findInFile(file: string, src: string): Finding[] {
  const rel = normalizeRel(file);
  if (ALLOWED_FILES.has(rel)) return [];
  const lines = src.split(/\r?\n/);
  const findings: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    // Inline-Allowlist: Devs koennen eine bewusst-korrekte Verwendung mit
    // // tz-ok markieren (z.B. .slice(0,10) auf einer date-Spalte oder
    // datetime-local-String, wo die Regel nicht zutrifft).
    if (line.includes("// tz-ok")) continue;

    // Rule 1a: toLocaleDateString/TimeString immer mit timeZone
    if (TO_LOCALE_DATE_OR_TIME_RE.test(line)) {
      const window = lines.slice(i, Math.min(i + 6, lines.length)).join(" ");
      if (!TIMEZONE_RE.test(window)) {
        findings.push({
          file: rel,
          line: i + 1,
          excerpt: line.trim().slice(0, 140),
          rule: "toLocaleDate/TimeString ohne timeZone-Option (rendert UTC im SSR)",
        });
      }
    }
    // Rule 1b: toLocaleString nur wenn Datum/Zeit-Keys vorkommen (sonst
    // ist es Number-Formatting -> brauch keine timeZone).
    if (TO_LOCALE_STRING_RE.test(line) && !TO_LOCALE_DATE_OR_TIME_RE.test(line)) {
      const window = lines.slice(i, Math.min(i + 6, lines.length)).join(" ");
      if (DATE_TIME_KEY_RE.test(window) && !TIMEZONE_RE.test(window)) {
        findings.push({
          file: rel,
          line: i + 1,
          excerpt: line.trim().slice(0, 140),
          rule: "toLocaleString mit Datum/Zeit-Optionen ohne timeZone (rendert UTC im SSR)",
        });
      }
    }

    // Rule 2: .slice(0, 10) auf einer Variable (= UTC-Datum bei timestamptz)
    if (/\.slice\s*\(\s*0\s*,\s*10\s*\)/.test(line)) {
      findings.push({
        file: rel,
        line: i + 1,
        excerpt: line.trim().slice(0, 140),
        rule: ".slice(0, 10) — liefert UTC-Datum bei timestamptz; nutze localDateIso()",
      });
    }

    // Rule 3: .split("T")[0] (gleiche Wirkung wie slice)
    if (/\.split\s*\(\s*["']T["']\s*\)\s*\[\s*0\s*\]/.test(line)) {
      findings.push({
        file: rel,
        line: i + 1,
        excerpt: line.trim().slice(0, 140),
        rule: ".split('T')[0] — liefert UTC-Datum bei timestamptz; nutze localDateIso()",
      });
    }
  }

  return findings;
}

describe("Timezone-Discipline-Guard", () => {
  const allFindings: Finding[] = [];
  for (const file of walk(SRC_ROOT)) {
    const src = readFileSync(file, "utf8");
    allFindings.push(...findInFile(file, src));
  }

  it("kein toLocale*-Call ohne timeZone Europe/Zurich", () => {
    const violations = allFindings.filter((f) => f.rule.startsWith("toLocale"));
    if (violations.length > 0) {
      const msg = violations
        .map((f) => `  ${f.file}:${f.line}  →  ${f.excerpt}`)
        .join("\n");
      throw new Error(
        `${violations.length} toLocale*-Call(s) ohne timeZone gefunden — NIE MEHR.\n` +
        `Fix: zweites Argument muss \`{ timeZone: "Europe/Zurich", ... }\` enthalten.\n` +
        `Verstoesse:\n${msg}`,
      );
    }
    expect(violations.length).toBe(0);
  });

  it("kein .slice(0,10) oder .split('T')[0] auf timestamptz-Strings", () => {
    const violations = allFindings.filter((f) => !f.rule.startsWith("toLocale"));
    if (violations.length > 0) {
      const msg = violations
        .map((f) => `  ${f.file}:${f.line}  →  ${f.excerpt}`)
        .join("\n");
      throw new Error(
        `${violations.length} UTC-Datum-Extraktion(en) gefunden — NIE MEHR.\n` +
        `Fix: \`localDateIso(new Date(iso))\` aus @/lib/swiss-time verwenden.\n` +
        `Verstoesse:\n${msg}`,
      );
    }
    expect(violations.length).toBe(0);
  });
});
