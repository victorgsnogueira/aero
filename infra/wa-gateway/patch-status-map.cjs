const fs = require('node:fs');

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

const file = process.argv[2] ?? 'src/modules/whatsapp/store/index.ts';
const original = [
  '                const statusMap: Record<number, string> = {',
  "                    0: 'PENDING',",
  "                    1: 'SENT',",
  "                    2: 'DELIVERED',",
  "                    3: 'READ',",
  "                    4: 'READ', // Played",
  '                };',
].join(LF);
const fixed = [
  '                const statusMap: Record<number, string> = {',
  "                    0: 'PENDING',",
  "                    1: 'PENDING',",
  "                    2: 'SENT',",
  "                    3: 'DELIVERED',",
  "                    4: 'READ',",
  "                    5: 'READ',",
  '                };',
].join(LF);

const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes(CRLF) ? CRLF : LF;
const src = raw.split(CRLF).join(LF);
const count = src.split(original).length - 1;
if (count !== 1) {
  console.error(`[aero] patch do mapa de status: trecho original encontrado ${count} vez(es); revise o patch para esta versão do WA-AKG`);
  process.exit(1);
}
fs.writeFileSync(file, src.replace(original, fixed).split(LF).join(eol));
console.log('[aero] patch do mapa de status aplicado');
