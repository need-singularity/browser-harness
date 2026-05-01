// browser-harness main dispatcher
//
// Subcommands:
//   probe                              -> "ready" exit 0  (or "absent: <why>" exit 1)
//   selftest                           -> F1-F6 fixtures, structural (no browser launch)
//   oauth-login --slot N [--headless]  -> real OAuth flow (see docs/oauth-login.md)

const path = require('path');
const fs = require('fs');

const VERSION = '0.2.0';

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out.flags[key] = next;
        i++;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function cmdProbe() {
  // Probe contract: "ready" iff playwright-core resolvable AND factory loadable.
  // Browser binary presence NOT required (graceful — runtime concern, not install).
  try {
    require.resolve('playwright-core');
  } catch (_) {
    process.stdout.write('absent: playwright-core not installed\n');
    return 1;
  }
  try {
    require('./factory.cjs');
  } catch (e) {
    process.stdout.write(`absent: factory load failed: ${e.message}\n`);
    return 1;
  }
  process.stdout.write('ready\n');
  return 0;
}

function cmdSelftest() {
  const path = require('path');
  const selftestPath = path.join(__dirname, '..', 'tests', 'selftest.cjs');
  if (!fs.existsSync(selftestPath)) {
    process.stderr.write(`selftest fixture missing: ${selftestPath}\n`);
    return 5;
  }
  const { runSelftest } = require(selftestPath);
  return runSelftest();
}

async function cmdOauthLogin(args) {
  const slot = args.flags.slot;
  if (slot === undefined) {
    process.stderr.write('usage: oauth-login --slot <N> [--headless]\n');
    return 4;
  }
  const { runOauthLogin } = require('./oauth.cjs');
  return await runOauthLogin({
    slot,
    headless: !!args.flags.headless,
  });
}

function usage() {
  process.stderr.write(
    `browser-harness v${VERSION}\n` +
    `usage:\n` +
    `  harness probe                                check install + factory loadable\n` +
    `  harness selftest                             run F1-F6 structural fixtures\n` +
    `  harness oauth-login --slot N [--headless]   oauth flow (see docs/oauth-login.md)\n` +
    `\n` +
    `env:\n` +
    `  BROWSER_HARNESS_ENGINE                 chromium|firefox|webkit (default: firefox)\n` +
    `  BROWSER_HARNESS_EXECUTABLE             path to browser binary (overrides bundled)\n` +
    `  BROWSER_HARNESS_STATE                  slot storage dir (default: ~/.browser-harness/state)\n` +
    `  BROWSER_HARNESS_OAUTH_START_URL        OAuth authorize URL (oauth-login; required)\n` +
    `  BROWSER_HARNESS_OAUTH_SUCCESS_PATTERN  regex for callback URL (oauth-login)\n` +
    `  BROWSER_HARNESS_OAUTH_TIMEOUT_MS       user-click ceiling, ms (oauth-login; default 300000)\n` +
    `  BROWSER_HARNESS_OAUTH_ENGINE           oauth-login engine (default: chromium)\n`
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) { usage(); process.exit(4); }
  const args = parseArgs(argv);
  const sub = args._[0];

  let code = 4;
  switch (sub) {
    case 'probe':       code = await cmdProbe(); break;
    case 'selftest':    code = await cmdSelftest(); break;
    case 'oauth-login': code = await cmdOauthLogin(args); break;
    case '--version':
    case 'version':     process.stdout.write(`${VERSION}\n`); code = 0; break;
    case '--help':
    case 'help':        usage(); code = 0; break;
    default:            process.stderr.write(`unknown subcommand: ${sub}\n`); usage(); code = 4;
  }
  process.exit(code);
}

main().catch(e => { process.stderr.write(`FATAL: ${e.stack || e.message}\n`); process.exit(2); });
