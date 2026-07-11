import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL || 'file:local.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
