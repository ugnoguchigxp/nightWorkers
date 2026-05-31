import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config();

export default defineConfig({
  schema: './api/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.DATABASE_URL?.startsWith('file:')
      ? process.env.DATABASE_URL
      : `file:${process.env.DATABASE_URL || 'sqlite.db'}`,
  },
});
