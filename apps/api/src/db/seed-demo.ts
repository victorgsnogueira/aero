// Dados de DEMONSTRAÇÃO, separados dos reais:
//  - empresas marcadas com is_demo = 1 (ocultas por padrão e fora dos indicadores);
//  - telefones propositalmente inválidos (DDD 11 + número iniciado em 0), que
//    nunca correspondem a uma pessoa real e não podem ser validados/abordados;
//  - empresas de demonstração são recusadas ao montar públicos de campanha.
// Uso: npm run seed:demo        Remoção: npm run seed:demo -- --remove
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb } from './client.ts';
import { companies, companyPhones, phones } from './schema.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definido');
const { db, close } = createDb(url, { connectionLimit: 2 });

const remove = process.argv.includes('--remove');
const demo = await db.select({ id: companies.id }).from(companies).where(eq(companies.isDemo, true));
if (demo.length) {
  const ids = demo.map((d) => d.id);
  await db.delete(companyPhones).where(inArray(companyPhones.companyId, ids));
  await db.delete(companies).where(inArray(companies.id, ids));
  await db.execute(sql`DELETE FROM phones WHERE dedupe_key LIKE 'demo:%'`);
}
if (remove) {
  console.log(`Dados de demonstração removidos (${demo.length} empresas).`);
  await close();
  process.exit(0);
}

const categories = ['Dentista', 'Clínica de estética', 'Restaurante', 'Pet shop', 'Academia', 'Escritório de contabilidade'];
const neighborhoods = [
  ['Pinheiros', -23.5617, -46.6909],
  ['Vila Mariana', -23.5893, -46.6345],
  ['Moema', -23.6006, -46.6646],
  ['Tatuapé', -23.5403, -46.5763],
  ['Santana', -23.5025, -46.6253],
] as const;
// Gerador determinístico (sem Math.random) para resultados reproduzíveis
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const total = 400;
for (let i = 0; i < total; i++) {
  const [hood, lat, lng] = neighborhoods[i % neighborhoods.length]!;
  const category = categories[i % categories.length]!;
  const withCoords = i % 17 !== 0; // alguns sem coordenadas, para exibir o aviso
  const [c] = await db
    .insert(companies)
    .values({
      source: 'demo',
      sourcePlaceId: `demo-${i}`,
      name: `[DEMO] ${category} ${i + 1}`,
      category,
      address: `Endereço fictício ${i + 1}`,
      neighborhood: hood,
      city: 'São Paulo',
      state: 'SP',
      countryCode: 'BR',
      latitude: withCoords ? (lat + (rnd() - 0.5) * 0.03).toFixed(7) : null,
      longitude: withCoords ? (lng + (rnd() - 0.5) * 0.03).toFixed(7) : null,
      isDemo: true,
      notes: 'Registro de demonstração — não é um estabelecimento real.',
    })
    .$returningId();
  const raw = `(11) 0${String(1000000 + i).slice(-7)}`;
  await db.insert(phones).values({
    e164: null,
    dedupeKey: `demo:${i}`,
    rawSample: raw,
    countryCode: 'BR',
    formatStatus: 'invalid',
    formatNote: 'Número fictício de demonstração',
    waStatus: 'invalid_format',
  });
  const [p] = await db.select({ id: phones.id }).from(phones).where(eq(phones.dedupeKey, `demo:${i}`));
  await db.insert(companyPhones).values({ companyId: c!.id, phoneId: p!.id, rawValue: raw, source: 'demo' });
}
console.log(`${total} empresas de demonstração criadas (marcadas como [DEMO]).`);
await close();
