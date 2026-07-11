import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

export * from './schema';
export * from 'drizzle-orm';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url && process.env.NODE_ENV === 'production') {
  throw new Error('TURSO_DATABASE_URL environment variable is required in production.');
}

export const client = createClient({
  url: url || 'file:local.db',
  authToken: authToken,
});

export const db = drizzle(client, { schema });
export type Database = typeof db;
