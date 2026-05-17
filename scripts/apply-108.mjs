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
const q = readFileSync("supabase/migrations/108_datenschutz_acceptance.sql", "utf-8");
await sql(q);
console.log("108 applied");

console.log("\n--- Spalten da? ---");
console.log(await sql("select column_name, data_type from information_schema.columns where table_schema='public' and table_name='profiles' and column_name like 'datenschutz%'"));

console.log("\n--- RPC registriert? ---");
console.log(await sql("select proname, prosecdef from pg_proc where proname = 'accept_datenschutz'"));
