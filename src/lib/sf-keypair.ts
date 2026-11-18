/**
 * Local-dev key-pair auth.
 *
 * Deployed in App Runtime the app uses the SPCS service token (see auth.ts).
 * Locally it signs in as the service user written to .env.local by
 * scripts/provision-dev.sh, using a key-pair JWT. The same JWT works for the
 * Cortex Agents REST API and the SQL REST API.
 */

import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

let cached: { token: string; exp: number } | null = null;

export function hasKeyPairConfig(): boolean {
  return Boolean(
    process.env.SNOWFLAKE_ACCOUNT &&
      process.env.SNOWFLAKE_USER &&
      process.env.SNOWFLAKE_PRIVATE_KEY_PATH
  );
}

export function privateKeyPem(): string {
  return readFileSync(process.env.SNOWFLAKE_PRIVATE_KEY_PATH!, "utf8");
}

/** Account URL host. Underscores are not valid in hostnames, so use hyphens. */
export function accountHost(): string {
  if (process.env.SNOWFLAKE_HOST) return process.env.SNOWFLAKE_HOST;
  const account = process.env.SNOWFLAKE_ACCOUNT!.toLowerCase().replace(/_/g, "-");
  return `${account}.snowflakecomputing.com`;
}

/** Returns a cached key-pair JWT, refreshed a few minutes before expiry. */
export function keyPairJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - now > 300) return cached.token;

  const account = process.env.SNOWFLAKE_ACCOUNT!.toUpperCase().replace(/\./g, "-");
  const user = process.env.SNOWFLAKE_USER!.toUpperCase();
  const key = createPrivateKey(privateKeyPem());
  const der = createPublicKey(key).export({ type: "spki", format: "der" });
  const fingerprint = `SHA256:${createHash("sha256").update(der).digest("base64")}`;

  const exp = now + 3600;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iss: `${account}.${user}.${fingerprint}`, sub: `${account}.${user}`, iat: now, exp })
  );
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), key);
  const token = `${header}.${payload}.${b64url(signature)}`;
  cached = { token, exp };
  return token;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
