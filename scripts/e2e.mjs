#!/usr/bin/env node
// Manages the isolated e2e stack (docker-compose.e2e.yml).
//
//   node scripts/e2e.mjs reset               (or: pnpm e2e:reset)
//   node scripts/e2e.mjs clean               (or: pnpm e2e:clean)
//   node scripts/e2e.mjs down                (or: pnpm e2e:down)
//   node scripts/e2e.mjs run -- <command...> (or: pnpm e2e:run -- <command...>)
import { execFileSync } from 'node:child_process';

const COMPOSE_ARGS = ['compose', '-f', 'docker-compose.e2e.yml'];
const E2E_DATABASE_URL = 'postgresql://linkpulse:linkpulse@localhost:5434/linkpulse';

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
    DATABASE_URL: E2E_DATABASE_URL,
  });
}

const command = process.argv[2];

switch (command) {
  case 'reset': {
    resetStack();
    console.log('\ne2e stack ready: http://localhost:3001 (web), http://localhost:4002 (api)');
    break;
  }

  case 'clean': {
    docker(
      'exec',
      '-T',
      'postgres-e2e',
      'psql',
      '-U',
      'linkpulse',
      '-d',
      'linkpulse',
      '-c',
      'TRUNCATE TABLE users, links, clicks, refresh_tokens CASCADE;',
    );
    docker('exec', '-T', 'redis-e2e', 'redis-cli', 'FLUSHALL');
    console.log('e2e stack cleaned: all rows truncated, stack still running');
    break;
  }

  case 'down': {
    docker('down', '-v');
    console.log('e2e stack stopped, volume removed');
    break;
  }

  /**
   * One command for the whole lifecycle: reset, run whatever was passed
   * (typically a Playwright script), then always tear down - success or
   * failure, including a failure during reset itself.
   */
  case 'run': {
    // `pnpm e2e:run -- node foo.mjs` forwards the literal `--` into this
    // process's own argv rather than consuming it, so it has to be stripped
    // here - otherwise payload[0] is the string "--", not the real command.
    const rawArgs = process.argv.slice(3);
    const payload = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
    if (payload.length === 0) {
      console.error('usage: pnpm e2e:run -- <command> [args...]');
      process.exit(1);
    }

    let exitCode = 0;
    try {
      resetStack();
      console.log('\ne2e stack ready, running:', payload.join(' '), '\n');
      run(payload[0], payload.slice(1));
    } catch (error) {
      exitCode = typeof error.status === 'number' ? error.status : 1;
      console.error(`\ne2e:run failed (exit ${exitCode}) - cleaning up anyway`);
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
    console.error('usage: node scripts/e2e.mjs <reset|clean|down|run>');
    process.exit(1);
}
