#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v tournament_password="$TOURNAMENT_SECRET" -v turbo_password="$TURBO_SECRET" -v gateway_password="$GATEWAY_DB_PASSWORD" <<'SQL'
CREATE USER ftb_tournament WITH PASSWORD :'tournament_password';
CREATE USER ftb_turbo WITH PASSWORD :'turbo_password';
CREATE USER ftb_gateway WITH PASSWORD :'gateway_password';
CREATE DATABASE ftb_tournament OWNER ftb_tournament;
CREATE DATABASE ftb_turbo OWNER ftb_turbo;
CREATE DATABASE ftb_gateway OWNER ftb_gateway;
REVOKE CONNECT ON DATABASE ftb_tournament FROM PUBLIC;
REVOKE CONNECT ON DATABASE ftb_turbo FROM PUBLIC;
REVOKE CONNECT ON DATABASE ftb_gateway FROM PUBLIC;
GRANT CONNECT ON DATABASE ftb_tournament TO ftb_tournament;
GRANT CONNECT ON DATABASE ftb_turbo TO ftb_turbo;
GRANT CONNECT ON DATABASE ftb_gateway TO ftb_gateway;
SQL
