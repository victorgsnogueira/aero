#!/bin/bash
set -euo pipefail

: "${AERO_DB_PASSWORD:?}"
: "${WA_DB_PASSWORD:?}"

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS aero CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS wa_gateway CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS aero_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'aero'@'%' IDENTIFIED BY '${AERO_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON aero.* TO 'aero'@'%';
GRANT ALL PRIVILEGES ON aero_test.* TO 'aero'@'%';

CREATE USER IF NOT EXISTS 'wa_gateway'@'%' IDENTIFIED BY '${WA_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON wa_gateway.* TO 'wa_gateway'@'%';
-- Prisma db push precisa de um shadow database apenas em migrate dev; db push não.
FLUSH PRIVILEGES;
SQL
echo "[aero] bancos aero, aero_test e wa_gateway criados"
