#!/usr/bin/env node
// Manages the isolated verification stack (docker-compose.verify.yml), used
// for live/browser-driven checks against a running app instead of the dev
// stack - see that file's header for why this exists at all.
//
//   node scripts/verify.mjs reset               (or: pnpm verify:reset)
//   node scripts/verify.mjs clean               (or: pnpm verify:clean)
//   node scripts/verify.mjs down                (or: pnpm verify:down)
//   node scripts/verify.mjs run -- <command...> (or: pnpm verify:run -- <command...>)
import { execFileSync } from 'node:child_process';

const COMPOSE_ARGS = ['compose', '-f', 'docker-compose.verify.yml'];
const VERIFY_DATABASE_URL = 'postgresql://linkpulse:linkpulse@localhost:5434/linkpulse';

function docker(...args) {
  execFileSync('docker', [...COMPOSE_ARGS, ...args], { stdio: 'inherit' });
}

function run(command, args, env = process.env) {
  execFileSync(command, args, { stdio: 'inherit', env });
}

/** Fresh containers, fresh database, migrations applied. Idempotent. */
function resetStack() {
  // down -v first: a stale volume from a previous run would mean migrations
  // applying on top of leftover data instead of a clean slate.
  docker('down', '-v');
  docker('up', '-d', '--build', '--wait');
  run('pnpm', ['--filter', '@linkpulse/api', 'exec', 'prisma', 'migrate', 'deploy'], {
    ...process.env,
    DATABASE_URL: VERIFY_DATABASE_URL,
  });
}

const command = process.argv[2];

switch (command) {
  case 'reset': {
    resetStack();
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

  /**
   * One command for the whole lifecycle: reset, run whatever was passed
   * (typically a Playwright script), then always tear down - success or
   * failure, and even if the reset itself fails partway through (a real
   * case, not hypothetical: Docker ran out of disk space mid-reset once
   * while building this and left an orphaned container behind because nothing
   * was there to catch it). The `finally` covers the whole attempt, not just
   * the payload, so nothing manual has to be remembered afterward regardless
   * of where it broke.
   */
  case 'run': {
    // `pnpm verify:run -- node foo.mjs` forwards the literal `--` into this
    // process's own argv rather than consuming it, so it has to be stripped
    // here - otherwise payload[0] is the string "--", not the real command.
    const rawArgs = process.argv.slice(3);
    const payload = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
    if (payload.length === 0) {
      console.error('usage: pnpm verify:run -- <command> [args...]');
      process.exit(1);
    }

    let exitCode = 0;
    try {
      resetStack();
      console.log('\nverify stack ready, running:', payload.join(' '), '\n');
      run(payload[0], payload.slice(1));
    } catch (error) {
      exitCode = typeof error.status === 'number' ? error.status : 1;
      console.error(`\nverify:run failed (exit ${exitCode}) - cleaning up anyway`);
    } finally {
      try {
        docker('down', '-v');
      } catch (teardownError) {
        console.error('teardown itself failed:', teardownError.message);
      }
    }

    process.exit(exitCode);
  }

  default:
    console.error('usage: node scripts/verify.mjs <reset|clean|down|run>');
    process.exit(1);
}
