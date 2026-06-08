-- Session-Tracking-Fix.
--
-- Problem 1: /api/sessions/end mit reason='inactive' hat ended_at = NOW()
-- gesetzt. Wenn der User die App in einem Tab vergessen hat und 5 Tage
-- spaeter zurueckkommt + dann der inactive-Timer fired, wurde die
-- Session als 5-Tage-aktiv verbucht. Folge: Mathis hatte eine 121h-Session.
-- Code-Fix: route.ts setzt jetzt ended_at = last_seen_at fuer 'inactive'.
--
-- Problem 2: Browser-Close ohne explicit logout → Session bleibt
-- open_at=NULL fuer immer. Activity-Tab zaehlt bis last_seen_at (= OK),
-- aber das wirkt komisch wenn der User offline ist.
--
-- Fix in dieser Migration:
--   (a) Historische 'inactive'-Sessions korrigieren wo ended_at >>
--       last_seen_at ist (= unsere falschen Daten zurueckpatchen).
--   (b) Offene Sessions (ended_at IS NULL) die seit >1h kein Heartbeat
--       hatten als 'orphan' closen mit ended_at = last_seen_at.

-- (a) Historische inactive-Sessions korrigieren
update public.user_sessions
set ended_at = last_seen_at
where end_reason = 'inactive'
  and ended_at is not null
  and last_seen_at is not null
  and ended_at > last_seen_at + interval '5 minutes';

-- (b) end_reason CHECK erweitern um 'orphan'
alter table public.user_sessions drop constraint if exists user_sessions_end_reason_check;
alter table public.user_sessions add constraint user_sessions_end_reason_check
  check (end_reason is null or end_reason = any (array['logout', 'inactive', 'expired', 'orphan']));

-- (c) Offene Sessions mit last_seen > 1h alt = orphan, sauber closen
update public.user_sessions
set ended_at = last_seen_at,
    end_reason = 'orphan'
where ended_at is null
  and last_seen_at is not null
  and last_seen_at < now() - interval '1 hour';
