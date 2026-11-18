// Dev check: query AGENT_CANVAS_PLUS as the local dev service user.
// Usage: node --experimental-strip-types scripts/dev-query.mts "SELECT ..."
import { keyPairJwt, accountHost } from "../src/lib/sf-keypair.ts";
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const statement = process.argv[2];
const r = await fetch(`https://${accountHost()}/api/v2/statements`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${keyPairJwt()}`,
    "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({ statement, warehouse: "AGENT_CANVAS_PLUS_WH", role: process.env.SNOWFLAKE_ROLE }),
});
const j = await r.json();
console.log(r.status, JSON.stringify(j.data ?? j.message));
