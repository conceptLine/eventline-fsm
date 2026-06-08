"use client";

/**
 * Combobox / Searchable Select.
 * Wie ein <select>, aber mit Tipp-Filter:
 *   - Beim Tippen werden Vorschläge gefiltert (Wort-Start-Match)
 *   - Auswahl per Klick oder Enter
 *   - Dropdown wird via Portal in document.body gerendert (kein Card-Clipping)
 *
 * Verwendung:
 *   <SearchableSelect
 *     value={customerId}
 *     onChange={setCustomerId}
 *     items={customers.map(c => ({ id: c.id, label: c.name }))}
 *     placeholder="Kunde…"
 *   />
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, X } from "lucide-react";

export type SelectItem = {
  id: string;
  label: string;
  sub?: string;
};

interface Props {
  value: string;
  onChange: (id: string) => void;
  items: SelectItem[];
  placeholder?: string;
  required?: boolean;
  id?: string;
  /** false = reines Dropdown (kein Such-Input, kein Tipp-Filter). Default true. */
  searchable?: boolean;
  /** false = kein X-Button zum Leeren der Auswahl (z.B. wenn "Alle" das default Item ist). Default true. */
  clearable?: boolean;
  /** Visueller Stil-Hinweis am Trigger, wenn ein Filter aktiv ist (nicht-default-Wert). */
  active?: boolean;
  /** Wenn gesetzt: zeigt eine "Neu anlegen"-Option am Ende, sobald der Nutzer etwas getippt hat. */
  onCreateNew?: (query: string) => void;
  /** Label vor dem getippten Wert, z.B. "Neuer Kunde" -> "+ Neuer Kunde: Max". Default "Neu anlegen". */
  createNewLabel?: string;
}

function matchesWordStart(text: string, q: string): boolean {
  const lq = q.toLowerCase();
  const lower = text.toLowerCase();
  if (lower.startsWith(lq)) return true;
  return lower.split(/[\s,.\-/]+/).some((p) => p.startsWith(lq));
}

export function SearchableSelect({
  value,
  onChange,
  items,
  placeholder,
  required,
  id,
  searchable = true,
  clearable = true,
  active = false,
  onCreateNew,
  createNewLabel = "Neu anlegen",
}: Props) {
  const selectedItem = items.find((i) => i.id === value) ?? null;
  const [search, setSearch] = useState(selectedItem?.label ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(
    null
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);

  // Wenn value von außen zurückgesetzt wird (z.B. durch Form-Reset oder Job-Type-Wechsel),
  // synchronisiere die Anzeige.
  useEffect(() => {
    setSearch(selectedItem?.label ?? "");
  }, [selectedItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Beim Oeffnen Suche leeren damit ALLE Items im Dropdown sichtbar sind.
  // Sonst filtert der Match-Algorithmus gegen das Label des aktuellen Werts
  // und zeigt nur Items die mit dem gleichen Wort beginnen → man sieht
  // dann nur den schon ausgewaehlten Eintrag selbst. Bei Schliessen ohne
  // Auswahl setzt onDocClick die Anzeige zurueck auf selectedItem.label.
  useEffect(() => {
    if (open && searchable) setSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => setMounted(true), []);

  // Position des Dropdowns — flippt ueber den Trigger wenn unter
  // dem Bildschirmrand zu wenig Platz waere (Standard-Combobox-Verhalten).
  useEffect(() => {
    if (!open) return;
    function update() {
      if (!inputRef.current) return;
      const r = inputRef.current.getBoundingClientRect();
      const dropdownMax = 288; // max-h-72 (Tailwind = 18rem = 288px)
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      // Wenn nicht genug Platz UND oben mehr ist → ueber dem Trigger oeffnen
      if (spaceBelow < dropdownMax && spaceAbove > spaceBelow) {
        setPos({ top: Math.max(8, r.top - dropdownMax - 4), left: r.left, width: r.width });
      } else {
        setPos({ top: r.bottom + 4, left: r.left, width: r.width });
      }
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Click outside
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      const inWrapper = wrapperRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inWrapper && !inDropdown) {
        setOpen(false);
        // Wenn beim Verlassen kein Match, Anzeige auf letzten gültigen Wert zurücksetzen
        if (search !== (selectedItem?.label ?? "")) {
          setSearch(selectedItem?.label ?? "");
        }
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [search, selectedItem?.label]);

  const filtered = useMemo(() => {
    if (!open) return [];
    if (!searchable) return items;
    // Cap auf 50 — der max-h-72-Container scrollt darunter, sodass der User
    // bei realistischen Mengen (~30-50 aktive Auftraege) alles per Scroll
    // erreicht. Bei groesseren Listen filtert die Suche.
    if (!search) return items.slice(0, 50);
    return items.filter((i) => matchesWordStart(i.label, search)).slice(0, 50);
  }, [items, search, open, searchable]);

  // "Neu anlegen"-Option: nur wenn vom Aufrufer gewuenscht UND Nutzer hat etwas getippt
  // UND der getippte Wert matcht keinen bestehenden Eintrag exakt (case-insensitive).
  const trimmedSearch = search.trim();
  const exactMatchExists = trimmedSearch.length > 0 && items.some(
    (i) => i.label.trim().toLowerCase() === trimmedSearch.toLowerCase(),
  );
  const showCreateOption = !!onCreateNew && trimmedSearch.length > 0 && !exactMatchExists;
  // Highlight-Index gilt fuer filtered.length + (showCreateOption ? 1 : 0)
  const totalOptions = filtered.length + (showCreateOption ? 1 : 0);

  function pick(item: SelectItem) {
    onChange(item.id);
    setSearch(item.label);
    setOpen(false);
  }

  function pickCreateNew() {
    if (!onCreateNew) return;
    const q = trimmedSearch;
    setOpen(false);
    onCreateNew(q);
  }

  function clear() {
    onChange("");
    setSearch("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min(h + 1, totalOptions - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open) {
        if (highlight < filtered.length && filtered[highlight]) {
          e.preventDefault();
          pick(filtered[highlight]);
        } else if (showCreateOption && highlight === filtered.length) {
          e.preventDefault();
          pickCreateNew();
        }
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setSearch(selectedItem?.label ?? "");
    }
  }

  const dropdown =
    open && pos ? (
      <ul
        ref={dropdownRef}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: pos.width,
        }}
        className="z-[1200] rounded-xl border bg-popover shadow-lg max-h-72 overflow-y-auto p-1"
      >
        {filtered.length === 0 && !showCreateOption ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">
            Keine Treffer.
          </li>
        ) : (
          <>
            {filtered.map((item, i) => (
              <li
                key={item.id}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex items-start gap-2 px-2.5 py-1.5 text-sm cursor-pointer rounded-lg transition-colors ${
                  i === highlight
                    ? "bg-foreground/[0.08]"
                    : "hover:bg-foreground/[0.05] dark:hover:bg-foreground/[0.12]"
                } ${item.id === value ? "font-semibold" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{item.label}</div>
                  {item.sub && (
                    <div className="truncate text-xs text-muted-foreground">
                      {item.sub}
                    </div>
                  )}
                </div>
              </li>
            ))}
            {showCreateOption && (
              <li
                role="option"
                aria-selected={highlight === filtered.length}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickCreateNew();
                }}
                onMouseEnter={() => setHighlight(filtered.length)}
                className={`flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer rounded-lg transition-colors border-t border-border/60 mt-1 pt-2 ${
                  highlight === filtered.length
                    ? "bg-foreground/[0.08]"
                    : "hover:bg-foreground/[0.05] dark:hover:bg-foreground/[0.12]"
                }`}
              >
                <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">{createNewLabel}: </span>
                  <span className="font-medium">{trimmedSearch}</span>
                </span>
              </li>
            )}
          </>
        )}
      </ul>
    ) : null;

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={search}
        readOnly={!searchable}
        onChange={
          searchable
            ? (e) => {
                setSearch(e.target.value);
                setOpen(true);
                setHighlight(0);
              }
            : undefined
        }
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-required={required}
        className={`flex h-9 w-full rounded-xl border bg-background pl-3 pr-8 py-1 text-sm transition-all placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 ${
          !searchable ? "cursor-pointer select-none" : ""
        } ${active ? "border-foreground/60 font-medium" : "hover:border-foreground/30"}`}
      />
      {clearable && value ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Auswahl entfernen"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <ChevronDown
          className={`absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      )}
      {mounted && dropdown && createPortal(dropdown, document.body)}
    </div>
  );
}
