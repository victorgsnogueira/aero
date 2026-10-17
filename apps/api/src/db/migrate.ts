import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createDb } from './client.ts';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function runMigrations(databaseUrl: string): Promise<void> {
  const handle = createDb(databaseUrl, { connectionLimit: 1 });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não definido');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('Migrations aplicadas.');
    })
    .catch((err: unknown) => {
      console.error('Falha ao aplicar migrations', err);
      process.exit(1);
    });
}
