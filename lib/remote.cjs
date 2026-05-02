// remote.cjs — Mac → ubu1/ubu2/fleet SSH-pipe transport (v0.3.1)
//
// Purpose: invoke browser-harness subcommands on a remote Linux host
// without requiring browser-harness to be installed there. The Mac is the
// authoritative source of code; the remote is treated as a generic
// Node+playwright runner. The payload is self-contained — factory.cjs
// and oauth.cjs are inlined into a bootstrap script that is piped to
// `ssh <host> 'node -'`.
//
// Flow:
//   1) Preflight (ssh `command -v node && npx playwright --version`)
//      → fail loud (exit 1) if absent.
//   2) Build payload: a Node script that materialises factory.cjs +
//      oauth.cjs into a per-pid tmpdir on the remote, sets
//      BROWSER_HARNESS_STATE = ~/.browser-harness/state, mkdir -p that
//      dir, then dispatches to the requested subcommand.
//   3) For oauth-login, callers handle SCP of slot-N.json before/after
//      invocation (this module is transport-agnostic; SCP lives in
//      runOauthLoginRemote below).
//   4) For --target=fleet, fan out across BROWSER_HARNESS_FLEET_HOSTS
//      (default "ubu2"), aggregate exits.
//
// Constraints:
//   - SSH only. Existing-keys auth. NO password handling.
//   - spawnSync, default 600s timeout.
//   - Payload uses `playwright` OR `playwright-core` (whichever the
//     remote has — `playwright` re-exports playwright-core's launchers,
//     so the factory's require('playwright-core') is wrapped to fall
//     back to require('playwright')).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DEFAULT_SSH_TIMEOUT_MS = 600 * 1000;
const DEFAULT_SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];
const DEFAULT_FLEET = ['ubu2'];

// --- payload builder -------------------------------------------------------

function _readLib(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

function _readTest(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'tests', name), 'utf8');
}

// Re-exported for selftest F9 (structural — confirms runRemoteSelftest
// is a real function shipped from tests/selftest_remote.cjs).
const { runRemoteSelftest } = require('../tests/selftest_remote.cjs');

// Build a self-contained Node script. The remote `node -` reads it from
// stdin. We pass subcmd + args + opts as a JSON literal embedded in the
// script (NOT via argv, because `node -` consumes argv differently).
function buildPayload({ subcmd, args, opts }) {
  const factorySrc = _readLib('factory.cjs');
  const oauthSrc = _readLib('oauth.cjs');
  // base64 to keep template strings clean & avoid escaping headaches
  const f64 = Buffer.from(factorySrc, 'utf8').toString('base64');
  const o64 = Buffer.from(oauthSrc, 'utf8').toString('base64');
  // Inline the remote-side selftest fixture only when needed (keeps the
  // payload small for non-selftest subcommands).
  const s64 = subcmd === 'selftest'
    ? Buffer.from(_readTest('selftest_remote.cjs'), 'utf8').toString('base64')
    : '';
  const payloadCtx = JSON.stringify({ subcmd, args: args || [], opts: opts || {} });

  // Bootstrap script. Notes:
  // - Materialises factory.cjs + oauth.cjs into a per-pid tmpdir under
  //   the remote's os.tmpdir().
  // - Forces BROWSER_HARNESS_STATE = ~/.browser-harness/state and
  //   mkdir -p that dir (matches Mac convention).
  // - Wraps require('playwright-core') to fall back to require('playwright')
  //   (npx-installed remotes typically have full `playwright`).
  // - Dispatches: probe, selftest (structural — re-implemented inline
  //   since tests/selftest.cjs is not shipped), version, oauth-login.
  return `
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const CTX = ${payloadCtx};

// 1) materialise lib modules
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-harness-payload-'));
const libDir = path.join(tmpRoot, 'lib');
fs.mkdirSync(libDir, { recursive: true });
fs.writeFileSync(path.join(libDir, 'factory.cjs'), Buffer.from(${JSON.stringify(f64)}, 'base64'));
fs.writeFileSync(path.join(libDir, 'oauth.cjs'),   Buffer.from(${JSON.stringify(o64)}, 'base64'));
${s64 ? `fs.writeFileSync(path.join(libDir, 'selftest_remote.cjs'), Buffer.from(${JSON.stringify(s64)}, 'base64'));` : ''}

// 2) state dir
const stateDir = process.env.BROWSER_HARNESS_STATE
  || path.join(os.homedir(), '.browser-harness', 'state');
fs.mkdirSync(stateDir, { recursive: true });
process.env.BROWSER_HARNESS_STATE = stateDir;

// 3) playwright resolution. Strategy:
//    a) try require.resolve('playwright-core') / require.resolve('playwright')
//       on the default module path (global install / project deps).
//    b) discover npx cache (~/.npm/_npx/<hash>/node_modules) — common on
//       remotes that have only run \`npx playwright …\`.
//    c) fall back: npm install --prefix <tmpRoot> playwright-core into
//       the per-pid tmpdir.
//   Whatever hits, prepend that node_modules dir to NODE_PATH and
//   re-init module paths so subsequent require('playwright-core') works.
const Module = require('module');
function _addNodePath(p) {
  const cur = process.env.NODE_PATH || '';
  process.env.NODE_PATH = cur ? (p + path.delimiter + cur) : p;
  Module._initPaths();
}
let _pwResolved = false;
try { require.resolve('playwright-core'); _pwResolved = true; } catch (_) {}
if (!_pwResolved) { try { require.resolve('playwright'); _pwResolved = true; } catch (_) {} }
if (!_pwResolved) {
  // probe npx cache
  const npxRoot = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(npxRoot)) {
    try {
      const dirs = fs.readdirSync(npxRoot);
      for (const d of dirs) {
        const nm = path.join(npxRoot, d, 'node_modules');
        if (fs.existsSync(path.join(nm, 'playwright-core')) || fs.existsSync(path.join(nm, 'playwright'))) {
          _addNodePath(nm);
          try { require.resolve('playwright-core'); _pwResolved = true; break; }
          catch (_) {
            try { require.resolve('playwright'); _pwResolved = true; break; }
            catch (_) {}
          }
        }
      }
    } catch (_) {}
  }
}
if (!_pwResolved) {
  // last resort: install playwright-core into tmpRoot (slow; warn)
  process.stderr.write('remote: playwright-core not found; installing into tmpdir (~30s, one-shot)...\\n');
  try {
    execSync('npm install --prefix ' + JSON.stringify(tmpRoot) + ' playwright-core --no-audit --no-fund --silent --no-progress', { stdio: ['ignore', 'inherit', 'inherit'] });
    _addNodePath(path.join(tmpRoot, 'node_modules'));
    try { require.resolve('playwright-core'); _pwResolved = true; } catch (_) {}
  } catch (e) {
    process.stderr.write('remote: tmpdir npm install failed: ' + e.message + '\\n');
  }
}
// Alias playwright-core → playwright if only the latter is present
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request === 'playwright-core') {
    try { return _origResolve.call(this, 'playwright-core', parent, ...rest); }
    catch (_) {
      try { return _origResolve.call(this, 'playwright', parent, ...rest); }
      catch (_) { /* fall through to original error */ }
    }
  }
  return _origResolve.call(this, request, parent, ...rest);
};

// 4) cleanup
function cleanup() {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
}
process.on('exit', cleanup);

// 5) dispatch
async function main() {
  const factory = require(path.join(libDir, 'factory.cjs'));
  const oauth = require(path.join(libDir, 'oauth.cjs'));

  switch (CTX.subcmd) {
    case 'probe': {
      try { require.resolve('playwright-core'); }
      catch (_) {
        try { require.resolve('playwright'); }
        catch (_) { process.stdout.write('absent: playwright-core not installed\\n'); return 1; }
      }
      try { require(path.join(libDir, 'factory.cjs')); }
      catch (e) { process.stdout.write('absent: factory load failed: ' + e.message + '\\n'); return 1; }
      process.stdout.write('ready\\n');
      return 0;
    }
    case 'selftest': {
      // remote selftest — F1/F2/F3/F6 (bundled today) PLUS F5-remote
      // (in-process runOauthLogin → 4), F7-remote (factory + oauth
      // co-loadable in same process), F8-remote (SLOT_STATE dir mode 0700).
      // F4 stays CLI-side (parseArgs check on the Mac).
      // The fixture is shipped from tests/selftest_remote.cjs and inlined
      // into <libDir>/selftest_remote.cjs by the bootstrap above.
      const { runRemoteSelftest } = require(path.join(libDir, 'selftest_remote.cjs'));
      return await runRemoteSelftest({ factory, oauth, libDir });
    }
    case 'version': {
      // Inlined — caller passed it via opts.version
      process.stdout.write((CTX.opts.version || 'unknown') + '\\n');
      return 0;
    }
    case 'oauth-login': {
      const slot = CTX.args.slot;
      const headless = !!CTX.args.headless;
      return await oauth.runOauthLogin({ slot, headless });
    }
    default:
      process.stderr.write('remote: unknown subcmd: ' + CTX.subcmd + '\\n');
      return 4;
  }
}

main().then(code => { cleanup(); process.exit(code); })
      .catch(e => { process.stderr.write('REMOTE_FATAL: ' + (e.stack || e.message) + '\\n'); cleanup(); process.exit(2); });
`;
}

// --- ssh transport ---------------------------------------------------------

function _ssh(host, remoteCmd, { input, timeoutMs } = {}) {
  const args = [...DEFAULT_SSH_OPTS, host, remoteCmd];
  return spawnSync('ssh', args, {
    input: input || undefined,
    encoding: 'utf8',
    timeout: timeoutMs || DEFAULT_SSH_TIMEOUT_MS,
  });
}

function _scp(src, dest, { timeoutMs } = {}) {
  const args = [...DEFAULT_SSH_OPTS, src, dest];
  return spawnSync('scp', args, {
    encoding: 'utf8',
    timeout: timeoutMs || DEFAULT_SSH_TIMEOUT_MS,
  });
}

function preflight(host) {
  // Assert remote has node + (playwright OR playwright-core via npx).
  // We accept either `npx playwright --version` or `npx playwright-core --version`.
  const r = _ssh(
    host,
    "command -v node && node --version && (npx --no-install playwright --version 2>/dev/null || npx playwright --version 2>/dev/null || npx playwright-core --version 2>/dev/null) | head -1",
    { timeoutMs: 60 * 1000 }
  );
  if (r.status !== 0) {
    return {
      ok: false,
      msg: `preflight failed for host=${host}: exit=${r.status} stderr=${(r.stderr || '').trim()}`,
    };
  }
  const lines = (r.stdout || '').split('\n').filter(Boolean);
  // expect: [node-path, node-version, playwright-version-line]
  const nodePath = lines[0] || '';
  const nodeVer = lines[1] || '';
  const pwVer = lines[lines.length - 1] || '';
  if (!nodePath || !nodeVer) {
    return { ok: false, msg: `preflight: node not found on ${host}` };
  }
  if (!pwVer || !/\d/.test(pwVer)) {
    return { ok: false, msg: `preflight: playwright not found on ${host} (stdout=${r.stdout || ''})` };
  }
  return { ok: true, nodeVer, pwVer };
}

// --- main entry ------------------------------------------------------------

function runRemote({ host, subcmd, args, opts }) {
  const pre = preflight(host);
  if (!pre.ok) {
    process.stderr.write(`remote: ${pre.msg}\n`);
    return { code: 1, stdout: '', stderr: pre.msg };
  }
  if (subcmd === 'probe') {
    // Special: surface remote node + playwright versions in the success line
    // (per smoke spec: "ready (remote=ubu2 node=<ver> playwright=<ver>)")
    const payload = buildPayload({ subcmd, args, opts });
    const r = _ssh(host, 'node -', { input: payload });
    const out = (r.stdout || '').trim();
    if (r.status === 0 && out === 'ready') {
      const decorated = `ready (remote=${host} node=${pre.nodeVer} playwright=${pre.pwVer})\n`;
      process.stdout.write(decorated);
      return { code: 0, stdout: decorated, stderr: r.stderr || '' };
    }
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return { code: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  }
  const payload = buildPayload({ subcmd, args, opts });
  const r = _ssh(host, 'node -', { input: payload });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return {
    code: r.status === null ? 1 : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

// --- oauth-login remote orchestration -------------------------------------

function runOauthLoginRemote({ host, slot, headless }) {
  // 1) compute Mac-side state path
  const stateDir = process.env.BROWSER_HARNESS_STATE
    || path.join(os.homedir(), '.browser-harness', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const localStatePath = path.join(stateDir, `slot-${slot}.json`);
  const remoteStatePath = `~/.browser-harness/state/slot-${slot}.json`;

  // 2) ensure remote state dir
  const mk = _ssh(host, 'mkdir -p ~/.browser-harness/state && chmod 0700 ~/.browser-harness 2>/dev/null; echo OK', {});
  if (mk.status !== 0) {
    process.stderr.write(`remote: failed to mkdir remote state dir on ${host}: ${(mk.stderr || '').trim()}\n`);
    return { code: 1 };
  }

  // 3) push state file if it exists locally
  if (fs.existsSync(localStatePath)) {
    const up = _scp(localStatePath, `${host}:${remoteStatePath}`);
    if (up.status !== 0) {
      process.stderr.write(`remote: scp push failed: ${(up.stderr || '').trim()}\n`);
      return { code: 1 };
    }
  }

  // 4) run oauth-login on remote
  const r = runRemote({
    host,
    subcmd: 'oauth-login',
    args: { slot, headless },
    opts: {},
  });

  // 5) on success (0) OR idempotent (52), pull the (possibly updated) state back.
  //    Optimisation (v0.3.1): for exit 52 the remote state is often byte-
  //    identical to the local copy → SCP-back is wasted work. Compare sha256
  //    of (local) vs (remote via `ssh <host> shasum -a 256 <path>`) and skip
  //    the SCP+chmod when they match. When local has no prior state but
  //    remote returned 52, still SCP back (the user pre-seeded the remote
  //    some other way — preserve it locally). For exit 0, always SCP back.
  if (r.code === 0 || r.code === 52) {
    let skipScp = false;
    if (r.code === 52 && fs.existsSync(localStatePath)) {
      const localHash = _sha256File(localStatePath);
      const remoteHash = _remoteSha256(host, remoteStatePath);
      if (localHash && remoteHash && localHash === remoteHash) {
        skipScp = true;
        process.stdout.write(
          `remote.cjs: slot-${slot} state byte-identical, skipped SCP-back\n`
        );
      }
    }
    if (!skipScp) {
      const tmp = path.join(os.tmpdir(), `browser-harness-pull-slot-${slot}-${process.pid}.json`);
      const dn = _scp(`${host}:${remoteStatePath}`, tmp);
      if (dn.status === 0 && fs.existsSync(tmp)) {
        try {
          fs.copyFileSync(tmp, localStatePath);
          fs.chmodSync(localStatePath, 0o600);
          process.stdout.write(`oauth-login: state pulled back to ${localStatePath} (mode 0600)\n`);
        } catch (e) {
          process.stderr.write(`remote: failed to install pulled state: ${e.message}\n`);
        } finally {
          try { fs.unlinkSync(tmp); } catch (_) {}
        }
      } else {
        process.stderr.write(`remote: scp pull failed: ${(dn.stderr || '').trim()}\n`);
      }
    }
  }
  // On failure (anything else), Mac state is untouched.
  return r;
}

// --- content-hash helpers (v0.3.1 SCP-skip) -------------------------------

function _sha256File(p) {
  try {
    const buf = fs.readFileSync(p);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch (_) { return null; }
}

function _remoteSha256(host, remotePath) {
  // shasum is POSIX-portable (BSD + GNU coreutils both ship it). Output
  // form: "<hex>  <path>". We extract the hex prefix.
  const r = _ssh(host, `shasum -a 256 ${remotePath} 2>/dev/null || true`, { timeoutMs: 30 * 1000 });
  if (r.status !== 0) return null;
  const out = (r.stdout || '').trim();
  if (!out) return null;
  const m = out.match(/^([0-9a-f]{64})\b/);
  return m ? m[1] : null;
}

// --- fleet fan-out ---------------------------------------------------------

function fleetHosts() {
  const env = process.env.BROWSER_HARNESS_FLEET_HOSTS;
  if (!env) return DEFAULT_FLEET.slice();
  return env.split(',').map(s => s.trim()).filter(Boolean);
}

function runFleet({ subcmd, args, opts }) {
  const hosts = fleetHosts();
  let aggregate = 0;
  const results = [];
  for (const host of hosts) {
    process.stdout.write(`---- fleet host=${host} ----\n`);
    const r = runRemote({ host, subcmd, args, opts });
    results.push({ host, code: r.code });
    if (r.code !== 0) aggregate = r.code || 1;
  }
  process.stdout.write(`---- fleet aggregate ----\n`);
  for (const { host, code } of results) {
    process.stdout.write(`  host=${host} code=${code}\n`);
  }
  return { code: aggregate, results };
}

module.exports = {
  runRemote,
  runOauthLoginRemote,
  runFleet,
  preflight,
  buildPayload,
  fleetHosts,
  runRemoteSelftest,
};
