import mysql from 'mysql2/promise';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from './schema.ts';

export type Db = MySql2Database<typeof schema>;

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: mysql.Pool;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string, opts: { connectionLimit?: number } = {}): DbHandle {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: opts.connectionLimit ?? 10,
    timezone: 'Z',
    dateStrings: false,
    decimalNumbers: false,
    supportBigNumbers: true,
    enableKeepAlive: true,
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool, close: () => pool.end() };
}
