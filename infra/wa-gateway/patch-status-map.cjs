// Correção aplicada ao WA-AKG (commit fixado) durante o build da imagem.
//
// Bug: o mapa de status do gateway está deslocado em relação ao Baileys
// (proto.WebMessageInfo.Status: ERROR=0, PENDING=1, SERVER_ACK=2,
// DELIVERY_ACK=3, READ=4, PLAYED=5). O original traduz 2→DELIVERED e
// 3→READ, ou seja, marca "lida" quando a mensagem apenas chegou ao aparelho.
//
// O patch exige o trecho original exato; se o código mudar, o build falha
// em vez de aplicar a correção às cegas.
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
  '                // [aero] mapa corrigido conforme proto.WebMessageInfo.Status do Baileys',
  '                const statusMap: Record<number, string> = {',
  "                    0: 'PENDING', // ERROR ou atualização sem status",
  "                    1: 'PENDING',",
  "                    2: 'SENT', // SERVER_ACK",
  "                    3: 'DELIVERED', // DELIVERY_ACK",
  "                    4: 'READ',",
  "                    5: 'READ', // PLAYED",
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
