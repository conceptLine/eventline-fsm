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
const q = readFileSync("supabase/migrations/103_is_partner_email_rpc.sql", "utf-8");
await sql(q);
console.log("103 applied");
// Verifikation: existiert + executes (Partner-Test admin als Test)
console.log(await sql("select proname from pg_proc where proname='is_partner_email'"));
console.log("Probe (Partner-Test admin):");
console.log(await sql("select public.is_partner_email((select email from public.profiles where role='partner' limit 1)) as is_partner"));
console.log("Probe (non-partner):");
console.log(await sql("select public.is_partner_email((select email from public.profiles where role='admin' limit 1)) as is_partner"));
