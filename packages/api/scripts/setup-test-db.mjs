// Creates the integration-test database and applies migrations to it.
//
// Kept separate from the dev database so a test run can truncate tables freely
// without destroying whatever you were poking at in the dashboard.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

for (const path of ['.env', '../../.env']) {
  if (existsSync(path)) {
    loadDotenv({ path, quiet: true });
    break;
  }
}

const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error('DATABASE_URL is not set; copy .env.example to .env first.');
  process.exit(1);
}

const testUrl = new URL(devUrl);
const testDbName = `${testUrl.pathname.replace(/^\//, '')}_test`;

// Connect to the maintenance database: you cannot CREATE DATABASE from inside
// the database you are creating.
const adminUrl = new URL(devUrl);
adminUrl.pathname = '/postgres';

const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();

const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
  testDbName,
]);

if (rowCount === 0) {
  // Identifier cannot be parameterised; the name is derived from our own config.
  await client.query(`CREATE DATABASE "${testDbName}"`);
  console.log(`created database ${testDbName}`);
} else {
  console.log(`database ${testDbName} already exists`);
}

await client.end();

testUrl.pathname = `/${testDbName}`;
execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: testUrl.toString() },
});
