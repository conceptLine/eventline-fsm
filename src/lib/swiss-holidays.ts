/**
 * Schweizer Feiertage fuer ein gegebenes Jahr.
 *
 * Quelle: Bundesfeiertag (1. August) ist gesetzlich bundesweit, der Rest
 * ist kantonal. Hier verwenden wir die in Basel-Stadt geltenden Feiertage
 * (= Standort EVENTLINE). Falls spaeter andere Kantone dazukommen,
 * pro-Mitarbeiter-Kanton + Lookup-Tabelle bauen.
 *
 * ArGV 1 Art. 28 behandelt Bundesfeiertage gleich wie Sonntage (50%-
 * Zuschlag-Regelung, gemeinsamer 6/Jahr-Counter).
 *
 * Ostern wird via Meeus/Jones/Butcher-Algorithmus berechnet — daraus
 * leiten sich Karfreitag, Ostermontag, Auffahrt, Pfingstmontag ab.
 */

export interface Holiday {
  date: string; // YYYY-MM-DD (Local Date)
  name: string;
}

export function swissHolidaysForYear(year: number): Holiday[] {
  const easter = calcEaster(year); // Sonntag
  const goodFriday = addDays(easter, -2);
  const easterMonday = addDays(easter, 1);
  const ascension = addDays(easter, 39); // Auffahrt = Donnerstag, 39 Tage nach Ostersonntag
  const pentecostMonday = addDays(easter, 50); // Pfingstmontag = 50 Tage nach Ostersonntag

  return [
    { date: `${year}-01-01`, name: "Neujahr" },
    { date: `${year}-01-02`, name: "Berchtoldstag" },
    { date: toIso(goodFriday), name: "Karfreitag" },
    { date: toIso(easterMonday), name: "Ostermontag" },
    { date: `${year}-05-01`, name: "Tag der Arbeit" },
    { date: toIso(ascension), name: "Auffahrt" },
    { date: toIso(pentecostMonday), name: "Pfingstmontag" },
    { date: `${year}-08-01`, name: "Bundesfeiertag" },
    { date: `${year}-12-25`, name: "Weihnachten" },
    { date: `${year}-12-26`, name: "Stephanstag" },
  ];
}

export function isSwissHoliday(dateIso: string, year: number): { holiday: true; name: string } | { holiday: false } {
  const list = swissHolidaysForYear(year);
  const hit = list.find((h) => h.date === dateIso);
  return hit ? { holiday: true, name: hit.name } : { holiday: false };
}

// Meeus/Jones/Butcher — gueltig fuer gregorianisches Ostern alle Jahre nach 1583.
function calcEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = Maerz, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
