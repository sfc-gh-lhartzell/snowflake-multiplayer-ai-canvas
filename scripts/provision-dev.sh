#!/bin/zsh
# One-time setup for local development against a real Snowflake account.
#
#   1. Runs setup.sql (database, tables, tools, agent "Luke", grants).
#   2. Creates a key pair and a SERVICE user, CANVAS_PLUS_DEV_SVC, that local
#      dev authenticates as. It gets only AGENT_CANVAS_PLUS_ROLE, the same
#      least-privilege role the deployed app uses.
#   3. Writes .env.local for `next dev`.
#
# Usage:  scripts/provision-dev.sh <snow-connection-name>
# Needs:  snow CLI, openssl, a connection whose user can USE ROLE ACCOUNTADMIN.
set -euo pipefail

CONN="${1:?usage: scripts/provision-dev.sh <snow-connection-name>}"
ROOT="${0:A:h:h}"
KEYDIR="$ROOT/.dev-keys"
mkdir -p "$KEYDIR"
chmod 700 "$KEYDIR"

if [[ ! -f "$KEYDIR/rsa_key.p8" ]]; then
  openssl genrsa 2048 2>/dev/null | openssl pkcs8 -topk8 -inform PEM -out "$KEYDIR/rsa_key.p8" -nocrypt
  openssl rsa -in "$KEYDIR/rsa_key.p8" -pubout -out "$KEYDIR/rsa_key.pub" 2>/dev/null
  chmod 600 "$KEYDIR/rsa_key.p8"
fi
PUB=$(grep -v -- '-----' "$KEYDIR/rsa_key.pub" | tr -d '\n')

echo "==> Running setup.sql on connection $CONN"
snow sql -c "$CONN" --enable-templating NONE -f "$ROOT/setup.sql"

echo "==> Creating dev service user"
snow sql -c "$CONN" --enable-templating NONE -q "
USE ROLE ACCOUNTADMIN;
CREATE USER IF NOT EXISTS CANVAS_PLUS_DEV_SVC TYPE = SERVICE
  DEFAULT_ROLE = AGENT_CANVAS_PLUS_ROLE
  DEFAULT_WAREHOUSE = AGENT_CANVAS_PLUS_WH
  COMMENT = 'Local dev identity for the Agent Canvas Plus app';
ALTER USER CANVAS_PLUS_DEV_SVC SET RSA_PUBLIC_KEY = '$PUB';
GRANT ROLE AGENT_CANVAS_PLUS_ROLE TO USER CANVAS_PLUS_DEV_SVC;
"

ACCOUNT=$(snow connection list --format json | python3 -c "
import json,sys
for c in json.load(sys.stdin):
    if c['connection_name']=='$CONN':
        print(c['parameters']['account']); break")

cat > "$ROOT/.env.local" <<EOF
# Written by scripts/provision-dev.sh. Local dev only; never commit.
SNOWFLAKE_ACCOUNT=$ACCOUNT
SNOWFLAKE_USER=CANVAS_PLUS_DEV_SVC
SNOWFLAKE_ROLE=AGENT_CANVAS_PLUS_ROLE
SNOWFLAKE_PRIVATE_KEY_PATH=$KEYDIR/rsa_key.p8
EOF
echo "==> Done. Wrote .env.local for account $ACCOUNT"
