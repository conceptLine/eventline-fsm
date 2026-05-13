import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf-8")
  .split(/\r?\n/).filter(l => l && !l.startsWith("#"))
  .reduce((a, l) => { const e = l.indexOf("="); if (e > 0) a[l.slice(0, e).trim()] = l.slice(e + 1).trim(); return a; }, {});
const PAT = env.SUPABASE_ACCESS_TOKEN;
const REF = "uxtotpniwbwyoznwkygd";
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const j = await r.json();
  if (j.message) throw new Error(j.message);
  return j;
}
const q = readFileSync("supabase/migrations/104_partner_audit_fixes.sql", "utf-8");
await sql(q);
console.log("104 applied");

console.log("\n--- Spalten submitted_at/by da? ---");
console.log(await sql("select column_name from information_schema.columns where table_schema='public' and table_name='jobs' and column_name like 'submitted%'"));

console.log("\n--- Trigger registriert? ---");
console.log(await sql("select tgname from pg_trigger where tgrelid in ('public.jobs'::regclass, 'public.job_appointments'::regclass) and tgname like '%partner%' or tgname like 'protect_last%' order by tgname"));

console.log("\n--- RPCs ---");
console.log(await sql("select proname from pg_proc where proname in ('partner_submit_anfrage','partner_withdraw_anfrage','partner_status_change_guard','protect_last_termin_for_partner_anfrage') order by proname"));

console.log("\n--- Aktualisierte Policies ---");
console.log(await sql("select polname, polcmd from pg_policy where polrelid='public.jobs'::regclass and polname like '%partner%' order by polname"));
console.log(await sql("select polname, polcmd from pg_policy where polrelid='public.job_appointments'::regclass and polname like '%partner%' order by polname"));
