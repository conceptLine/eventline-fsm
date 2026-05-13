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
const q = readFileSync("supabase/migrations/102_partner_entwurf_status.sql", "utf-8");
await sql(q);
console.log("102 applied");

console.log("--- Status-Verteilung Barakuba aktiv ---");
console.log(await sql("select status, count(*)::int as n from public.jobs where location_id='d0219c22-458a-4bb5-99fa-e532c5a6bc4e' and is_deleted is not true and status not in ('abgeschlossen','storniert') group by status order by status"));

console.log("--- RPCs ---");
console.log(await sql("select proname from pg_proc where proname in ('partner_update_notes','partner_submit_anfrage') order by proname"));
