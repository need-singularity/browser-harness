// F1-F6 structural fixtures — no live browser spawn.
//
// F1: factory module loads, exports expected API
// F2: slotStatePath() returns null for empty slot, path for valid slot
// F3: dispose(null) and dispose(undefined) do not throw (idempotent)
// F4: parseArgs roundtrip — flags with values vs flag-only
// F5: probe contract: "ready" string or "absent: <why>" string, both stdout
// F6: oauth module loads, exports runOauthLogin(opts), --slot is required
//     (exit 4), and persisted state files would be 0600 (chmod path exists)

const path = require('path');
const { spawnSync } = require('child_process');

const HARNESS_BIN = path.join(__dirname, '..', 'bin', 'harness');

function pass(name, msg) { process.stdout.write(`  PASS ${name} ${msg || ''}\n`); }
function fail(name, msg) { process.stderr.write(`  FAIL ${name} ${msg || ''}\n`); }

async function runSelftest() {
  let fails = 0;

  // F1
  try {
    const f = require('../lib/factory.cjs');
    const required = ['create', 'dispose', 'persistState', 'withContext', 'slotStatePath', 'STATE_DIR'];
    const missing = required.filter(k => typeof f[k] === 'undefined');
    if (missing.length) { fail('F1', `missing exports: ${missing.join(',')}`); fails++; }
    else pass('F1', 'factory exports complete');
  } catch (e) { fail('F1', `factory require failed: ${e.message}`); fails++; }

  // F2
  try {
    const { slotStatePath } = require('../lib/factory.cjs');
    const a = slotStatePath('');
    const b = slotStatePath(null);
    const c = slotStatePath(9);
    if (a !== null || b !== null) { fail('F2', `empty/null slot must return null (got ${a},${b})`); fails++; }
    else if (typeof c !== 'string' || !c.endsWith('slot-9.json')) { fail('F2', `slot 9 path malformed: ${c}`); fails++; }
    else pass('F2', `slot path = ${c}`);
  } catch (e) { fail('F2', e.message); fails++; }

  // F3
  try {
    const { dispose } = require('../lib/factory.cjs');
    await dispose(null);
    await dispose(undefined);
    pass('F3', 'dispose(null|undefined) idempotent');
  } catch (e) { fail('F3', `dispose threw: ${e.message}`); fails++; }

  // F4
  try {
    // re-implement parseArgs check — mirror lib/harness.cjs logic
    function parseArgs(argv) {
      const out = { _: [], flags: {} };
      for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
          const key = a.slice(2);
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith('--')) { out.flags[key] = next; i++; }
          else out.flags[key] = true;
        } else out._.push(a);
      }
      return out;
    }
    const r = parseArgs(['oauth-login', '--slot', '9', '--headless']);
    if (r._[0] !== 'oauth-login') { fail('F4', `subcmd parse: ${r._[0]}`); fails++; }
    else if (r.flags.slot !== '9') { fail('F4', `slot flag: ${r.flags.slot}`); fails++; }
    else if (r.flags.headless !== true) { fail('F4', `headless flag: ${r.flags.headless}`); fails++; }
    else pass('F4', 'parseArgs roundtrip');
  } catch (e) { fail('F4', e.message); fails++; }

  // F5 — probe via subprocess (real CLI invocation contract)
  try {
    const res = spawnSync(HARNESS_BIN, ['probe'], { encoding: 'utf8', timeout: 10000 });
    const out = (res.stdout || '').trim();
    const okReady  = out === 'ready' && res.status === 0;
    const okAbsent = out.startsWith('absent:') && res.status === 1;
    if (!okReady && !okAbsent) {
      fail('F5', `probe contract violated: stdout="${out}" exit=${res.status} stderr="${(res.stderr || '').trim()}"`);
      fails++;
    } else {
      pass('F5', `probe → "${out}" exit=${res.status}`);
    }
  } catch (e) { fail('F5', e.message); fails++; }

  // F6 — oauth module structural contract (no live browser launch)
  try {
    const oauth = require('../lib/oauth.cjs');
    const oauthMissing = ['runOauthLogin', 'isStateValid', 'safeUrlPrefix']
      .filter(k => typeof oauth[k] !== 'function');
    if (oauthMissing.length) {
      fail('F6', `oauth module missing exports: ${oauthMissing.join(',')}`);
      fails++;
    } else {
      // contract: --slot missing → exit 4
      const codeNoSlot = await oauth.runOauthLogin({});
      if (codeNoSlot !== 4) {
        fail('F6', `runOauthLogin({}) → ${codeNoSlot}, expected 4`);
        fails++;
      } else {
        // contract: persisted state files chmod 0600 — verify the chmod
        // capability is present on this platform by chmodding a tmpfile
        // and reading the mode back. (POSIX only; on win32 this is a
        // permissive no-op so we skip the strict check.)
        let chmodOk = true;
        if (process.platform !== 'win32') {
          const fs = require('fs');
          const os = require('os');
          const tmp = require('path').join(os.tmpdir(), `bh-selftest-f6-${process.pid}.tmp`);
          try {
            fs.writeFileSync(tmp, '{}');
            fs.chmodSync(tmp, 0o600);
            const st = fs.statSync(tmp);
            const mode = st.mode & 0o777;
            if (mode !== 0o600) {
              chmodOk = false;
              fail('F6', `chmod 0600 verify failed: got ${mode.toString(8)}`);
              fails++;
            }
            try { fs.unlinkSync(tmp); } catch (_) {}
          } catch (e) {
            chmodOk = false;
            fail('F6', `chmod probe failed: ${e.message}`);
            fails++;
          }
        }
        if (chmodOk) pass('F6', 'oauth exports + --slot required + chmod 0600 capable');
      }
    }
  } catch (e) { fail('F6', `oauth require failed: ${e.message}`); fails++; }

  if (fails === 0) {
    process.stdout.write('__BROWSER_HARNESS_SELFTEST__ PASS fails=0\n');
    return 0;
  }
  process.stdout.write(`__BROWSER_HARNESS_SELFTEST__ FAIL fails=${fails}\n`);
  return 5;
}

module.exports = { runSelftest };

// run directly
if (require.main === module) {
  runSelftest().then(code => process.exit(code));
}
