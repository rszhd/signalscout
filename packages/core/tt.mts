import { createDatabase } from "./src/db/client.js";
import { sql } from "drizzle-orm";
const { db, close } = createDatabase(process.env.DATABASE_URL!);
const M = "(select id from monitors where name='US-044 live TikTok poll')";
for (const [l, t] of [
  ["posts:", "select kind, count(*) from posts where source='tiktok' group by kind"],
  ["usage:", `select units, estimated_cost_micros from api_usage where monitor_id in ${M}`],
  ["calls:", `select purpose, count(*), max(created_at) as newest from model_calls where monitor_id in ${M} group by purpose`],
  ["matches:", `select count(*) from matches where monitor_id in ${M}`],
] as const) {
  const r = await db.execute(sql.raw(t));
  console.log(l, JSON.stringify(r.rows));
}
await close();
