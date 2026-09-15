#!/usr/bin/env node
// Manages the isolated verification stack (docker-compose.verify.yml), used
// for live/browser-driven checks against a running app instead of the dev
// stack - see that file's header for why this exists at all.
//
//   node scripts/verify.mjs reset   (or: pnpm verify:reset)
//   node scripts/verify.mjs clean   (or: pnpm verify:clean)
//   node scripts/verify.mjs down    (or: pnpm verify:down)
import { execFileSync } from 'node:child_process';

const COMPOSE_ARGS = ['compose', '-f', 'docker-compose.verify.yml'];
const VERIFY_DATABASE_URL = 'postgresql://linkpulse:linkpulse@localhost:5434/linkpulse';

function docker(...args) {
  execFileSync('docker', [...COMPOSE_ARGS, ...args], { stdio: 'inherit' });
}

function run(command, args, env = process.env) {
  execFileSync(command, args, { stdio: 'inherit', env });
}

const command = process.argv[2];

switch (command) {
  case 'reset': {
    // down -v first: a stale volume from a previous run would mean
    // migrations applying on top of leftover data instead of a clean slate.
    docker('down', '-v');
    docker('up', '-d', '--build', '--wait');
    run('pnpm', ['--filter', '@linkpulse/api', 'exec', 'prisma', 'migrate', 'deploy'], {
      ...process.env,
      DATABASE_URL: VERIFY_DATABASE_URL,
    });
    console.log('\nverify stack ready: http://localhost:3001 (web), http://localhost:4002 (api)');
    break;
  }

  case 'clean': {
    docker(
      'exec',
      '-T',
      'postgres-verify',
      'psql',
      '-U',
      'linkpulse',
      '-d',
      'linkpulse',
      '-c',
      'TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE;',
    );
    docker('exec', '-T', 'redis-verify', 'redis-cli', 'FLUSHALL');
    console.log('verify stack cleaned: all rows truncated, stack still running');
    break;
  }

  case 'down': {
    docker('down', '-v');
    console.log('verify stack stopped, volume removed');
    break;
  }

  default:
    console.error('usage: node scripts/verify.mjs <reset|clean|down>');
    process.exit(1);
}
