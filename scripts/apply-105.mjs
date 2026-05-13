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
const q = readFileSync("supabase/migrations/105_is_eventline_email_rpc.sql", "utf-8");
await sql(q);
console.log("105 applied");

console.log("\n--- RPC registriert? ---");
console.log(await sql("select proname, prosecdef from pg_proc where proname = 'is_eventline_email'"));

console.log("\n--- Smoke-Test: bekannte Eventline-Email ---");
console.log(await sql("select public.is_eventline_email('leo@eventline-basel.com') as is_eventline"));

console.log("\n--- Smoke-Test: nicht-existente Email ---");
console.log(await sql("select public.is_eventline_email('xxx@nope.invalid') as is_eventline"));
