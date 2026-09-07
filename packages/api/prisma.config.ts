// Prisma 7 dropped two things this file restores: the datasource URL no longer
// lives in schema.prisma, and the CLI no longer loads .env on its own.
import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Look in the package first, then the repo root, so `prisma migrate` works
// whether it is run from packages/api or from the workspace root.
for (const path of ['.env', '../../.env']) {
  if (existsSync(path)) {
    loadDotenv({ path, quiet: true });
    break;
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
