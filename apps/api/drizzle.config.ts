import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'mysql://aero:aero@127.0.0.1:3306/aero' },
  strict: true,
  verbose: true,
});
