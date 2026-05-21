-- Bexio-Verbindung haerten:
--  1. Modul-Toggles (feature_contacts, feature_accounting) — Settings-Page
--     kann einzelne Bexio-Module abschalten ohne den ganzen Token zu widerrufen.
--  2. Access-/Refresh-Token wandern in supabase_vault — verschluesselt at-rest
--     mit Supabase-managed Key, Zugriff nur ueber SECURITY-DEFINER-RPCs.
--     Die plain-text-Spalten bleiben in dieser Migration noch erhalten als
--     Fallback; eine spaetere Cleanup-Migration entfernt sie wenn alles
--     stabil laeuft.
--
-- Threat-Model:
--  • Vault verschlüsselt at-rest und loggt jeden Zugriff über die View.
--  • Plain-Token-Spalten waren bisher fuer jeden mit service_role-Zugriff
--    direkt lesbar — Vault zwingt einen separaten RPC-Pfad mit Audit-Spur.

-- === 1. Modul-Toggles ===
alter table public.bexio_connection
  add column if not exists feature_contacts boolean not null default true,
  add column if not exists feature_accounting boolean not null default false;

comment on column public.bexio_connection.feature_contacts is
  'Kunden-Sync (lesen/anlegen) aktiv. Standard true.';
comment on column public.bexio_connection.feature_accounting is
  'Budget-Soll/Ist-Sync aktiv. Default false — erst nach Re-Auth mit accounting-Scope aktivierbar.';

-- === 2. Vault-Token-Referenzen ===
alter table public.bexio_connection
  add column if not exists access_token_secret_id uuid,
  add column if not exists refresh_token_secret_id uuid;

-- === 3. RPCs fuer Token-Read/Write via Vault ===
-- Beide SECURITY DEFINER + auf service_role beschraenkt: nur Server-Code
-- mit Admin-Client darf Tokens lesen oder schreiben. Anonymer Zugriff
-- ist explizit ausgeschlossen.

create or replace function public.bexio_token_get(kind text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_value text;
begin
  if kind not in ('access', 'refresh') then
    raise exception 'Ungueltiger Token-Kind: %', kind;
  end if;

  select case when kind = 'access' then access_token_secret_id else refresh_token_secret_id end
    into v_secret_id
  from public.bexio_connection
  where id = 1;

  if v_secret_id is null then
    -- Fallback auf alte plain-text-Spalte solange Migration noch nicht
    -- final ausgerollt ist.
    select case when kind = 'access' then access_token else refresh_token end
      into v_value
    from public.bexio_connection
    where id = 1;
    return v_value;
  end if;

  select decrypted_secret into v_value
  from vault.decrypted_secrets
  where id = v_secret_id;
  return v_value;
end;
$$;

create or replace function public.bexio_token_set(kind text, new_value text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_name text;
begin
  if kind not in ('access', 'refresh') then
    raise exception 'Ungueltiger Token-Kind: %', kind;
  end if;

  v_name := 'bexio_' || kind || '_token';

  select case when kind = 'access' then access_token_secret_id else refresh_token_secret_id end
    into v_secret_id
  from public.bexio_connection
  where id = 1;

  if v_secret_id is null then
    -- Neu anlegen
    v_secret_id := vault.create_secret(new_value, v_name, 'Bexio OAuth ' || kind || ' token');
    if kind = 'access' then
      update public.bexio_connection set access_token_secret_id = v_secret_id where id = 1;
    else
      update public.bexio_connection set refresh_token_secret_id = v_secret_id where id = 1;
    end if;
  else
    -- Update bestehenden Secret
    perform vault.update_secret(v_secret_id, new_value, v_name, 'Bexio OAuth ' || kind || ' token');
  end if;
end;
$$;

-- Zugriff: NUR service_role darf rufen. authenticated/anon explizit revoken.
revoke all on function public.bexio_token_get(text) from public, anon, authenticated;
revoke all on function public.bexio_token_set(text, text) from public, anon, authenticated;
grant execute on function public.bexio_token_get(text) to service_role;
grant execute on function public.bexio_token_set(text, text) to service_role;

-- === 4. Bestehenden Token in Vault migrieren ===
-- Falls schon eine Verbindung existiert und noch keine Vault-Referenz hat:
-- aktuellen plain-text-Token in Vault umheben.
do $$
declare
  v_conn record;
begin
  select id, access_token, refresh_token, access_token_secret_id, refresh_token_secret_id
    into v_conn
  from public.bexio_connection
  where id = 1;

  if v_conn is null then
    return; -- Keine Verbindung -> nichts zu tun
  end if;

  if v_conn.access_token_secret_id is null and v_conn.access_token is not null then
    perform public.bexio_token_set('access', v_conn.access_token);
  end if;
  if v_conn.refresh_token_secret_id is null and v_conn.refresh_token is not null then
    perform public.bexio_token_set('refresh', v_conn.refresh_token);
  end if;
end$$;
