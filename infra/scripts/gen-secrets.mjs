#!/usr/bin/env node
// Cria `.env` a partir de `.env.example`, preenchendo segredos vazios com
// valores aleatórios. Não sobrescreve valores já definidos. Não imprime segredos.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const examplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');

const SECRET_KEYS = [
  'MYSQL_ROOT_PASSWORD',
  'AERO_DB_PASSWORD',
  'WA_DB_PASSWORD',
  'REDIS_PASSWORD',
  'WA_GATEWAY_API_KEY',
  'WA_WEBHOOK_SECRET',
  'WA_AUTH_SECRET',
  'WA_ADMIN_PASSWORD',
];

const hadEnv = existsSync(envPath);
const source = hadEnv ? readFileSync(envPath, 'utf8') : readFileSync(examplePath, 'utf8');
const generated = {};
let out = source
  .split(/\r?\n/)
  .map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) return line;
    const [, key, value] = m;
    if (SECRET_KEYS.includes(key) && value.trim() === '') {
      generated[key] = randomBytes(24).toString('hex');
      return `${key}=${generated[key]}`;
    }
    return line;
  })
  .join('\n');

// URLs de desenvolvimento usam as senhas geradas
const get = (k) => generated[k] ?? (new RegExp(`^${k}=(.*)$`, 'm').exec(out)?.[1] ?? '');
out = out
  .replace(/^DATABASE_URL=mysql:\/\/aero:CHANGE_ME@/m, `DATABASE_URL=mysql://aero:${get('AERO_DB_PASSWORD')}@`)
  .replace(/^REDIS_URL=redis:\/\/:CHANGE_ME@/m, `REDIS_URL=redis://:${get('REDIS_PASSWORD')}@`);

writeFileSync(envPath, out.endsWith('\n') ? out : `${out}\n`, { mode: 0o600 });
console.log(`.env ${hadEnv ? 'atualizado' : 'criado'}; segredos gerados: ${Object.keys(generated).join(', ') || 'nenhum'}`);
