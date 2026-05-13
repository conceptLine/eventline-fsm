-- Partner-Rolle Permissions auf das neue module:action-Format umstellen.
--
-- Vorher (096): ['partner_anfragen','partner_belegungsplan'] — Platzhalter-
-- Strings ohne Action-Granularitaet. Wurde nirgends von der App gelesen,
-- weil das Partner-Portal-Layout direkt ueber role='partner' gated.
--
-- Jetzt: voll granulares Set passend zum neuen PARTNER_PERMISSION_MODULES-
-- Katalog (siehe src/lib/permissions.ts). Heutige Partner-Rolle = "darf
-- alles im eigenen Portal" wird damit explizit. Wenn spaeter Partner-Sub-
-- Rollen (Partner-Admin vs Partner-Mitarbeiter) eingefuehrt werden, kann
-- ein Subset davon vergeben werden.
--
-- Effekt auf laufenden Betrieb: kein funktionaler Unterschied — das
-- Partner-Portal gated weiterhin ueber role-Check, nicht ueber diese
-- Permissions. Reine UX-Aenderung im Rollen-Editor (/einstellungen).

UPDATE public.roles
SET permissions = '[
  "partner-anfragen:view",
  "partner-anfragen:create",
  "partner-anfragen:edit",
  "partner-anfragen:delete",
  "partner-belegungsplan:view"
]'::jsonb
WHERE slug = 'partner';
