// browser-harness main dispatcher
//
// Subcommands:
//   probe                              -> "ready" exit 0  (or "absent: <why>" exit 1)
//   selftest                           -> F1-F8 fixtures, structural (no browser launch)
//   oauth-login --slot N [--headless]  -> real OAuth flow (see docs/oauth-login.md)
//
// v0.3.0: --target {mac|ubu1|ubu2|fleet} dispatches to lib/remote.cjs
//         (Mac → ubu* SSH-pipe transport). Default mac (current behavior).

const path = require('path');
const fs = require('fs');

const VERSION = '0.3.0';

const REMOTE_TARGETS = ['ubu1', 'ubu2', 'fleet'];

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

function targetOf(args) {
  const t = args.flags.target;
  if (t === undefined || t === true || t === '' || t === 'mac') return 'mac';
  return t;
}

function isRemoteTarget(t) {
  return REMOTE_TARGETS.includes(t);
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
    process.stderr.write('usage: oauth-login --slot <N> [--headless] [--target {mac|ubu1|ubu2}]\n');
    return 4;
  }
  const { runOauthLogin } = require('./oauth.cjs');
  return await runOauthLogin({
    slot,
    headless: !!args.flags.headless,
  });
}

// --- remote dispatch (v0.3.0) ---------------------------------------------

function dispatchRemote(target, sub, args) {
  const remote = require('./remote.cjs');
  if (target === 'fleet') {
    if (sub === 'oauth-login') {
      process.stderr.write(
        'oauth-login --target fleet is refused: slot state can only live on one host at a time.\n' +
        'Pick a single target (--target ubu1 or --target ubu2).\n'
      );
      return 4;
    }
    if (sub === 'version') {
      // Per spec table: version + fleet → skip fan-out, print Mac version.
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    const r = remote.runFleet({ subcmd: sub, args: args.flags, opts: { version: VERSION } });
    return r.code;
  }
  // ubu1 | ubu2
  if (sub === 'oauth-login') {
    const slot = args.flags.slot;
    if (slot === undefined) {
      process.stderr.write('usage: oauth-login --slot <N> [--headless] [--target {mac|ubu1|ubu2}]\n');
      return 4;
    }
    const r = remote.runOauthLoginRemote({
      host: target,
      slot,
      headless: !!args.flags.headless,
    });
    return r.code;
  }
  const r = remote.runRemote({
    host: target,
    subcmd: sub,
    args: args.flags,
    opts: { version: VERSION },
  });
  return r.code;
}

function usage() {
  process.stderr.write(
    `browser-harness v${VERSION}\n` +
    `usage:\n` +
    `  harness probe [--target {mac|ubu1|ubu2|fleet}]                    check install + factory loadable\n` +
    `  harness selftest [--target {mac|ubu1|ubu2|fleet}]                 run F1-F8 structural fixtures\n` +
    `  harness oauth-login --slot N [--headless] [--target {mac|ubu1|ubu2}]   oauth flow (see docs/oauth-login.md)\n` +
    `  harness version [--target {mac|ubu1|ubu2}]                        print version (fleet → Mac version only)\n` +
    `\n` +
    `targets:\n` +
    `  mac (default)         run locally on this host\n` +
    `  ubu1 | ubu2           SSH-pipe payload to remote node (lib/remote.cjs); requires existing ssh keys\n` +
    `  fleet                 fan out across BROWSER_HARNESS_FLEET_HOSTS (default: ubu2). NA for oauth-login.\n` +
    `\n` +
    `env:\n` +
    `  BROWSER_HARNESS_ENGINE                 chromium|firefox|webkit (default: firefox)\n` +
    `  BROWSER_HARNESS_EXECUTABLE             path to browser binary (overrides bundled)\n` +
    `  BROWSER_HARNESS_STATE                  slot storage dir (default: ~/.browser-harness/state)\n` +
    `  BROWSER_HARNESS_FLEET_HOSTS            comma-separated host list for --target fleet (default: ubu2)\n` +
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
  const target = targetOf(args);

  let code = 4;
  // Remote dispatch: any sub that's a real subcommand (not help/version-on-mac)
  if (isRemoteTarget(target) && ['probe', 'selftest', 'oauth-login', 'version'].includes(sub)) {
    code = await dispatchRemote(target, sub, args);
    process.exit(code);
  }

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

// Exposed for selftest F8 (parser introspection). Must come BEFORE main()
// invocation so `require('./harness.cjs')` from tests/selftest.cjs picks
// up the exports without triggering process.exit.
module.exports = { parseArgs, targetOf, isRemoteTarget, REMOTE_TARGETS, VERSION };

if (require.main === module) {
  main().catch(e => { process.stderr.write(`FATAL: ${e.stack || e.message}\n`); process.exit(2); });
}
