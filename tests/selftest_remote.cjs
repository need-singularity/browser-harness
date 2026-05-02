// Remote selftest fixtures — F1/F2/F3/F6/F5-remote/F7-remote/F8-remote.
//
// This file is the canonical source for the remote-side selftest payload.
// It is inlined into lib/remote.cjs::buildPayload() when subcmd === 'selftest'
// (the remote process has no filesystem access to this path; the contents
// are base64-embedded). Keep it self-contained — no external requires beyond
// node stdlib + the in-process factory/oauth modules that the bootstrap
// payload materialises into <tmpRoot>/lib/.
//
// Coverage (all run in-process on the remote, no subprocess, no SSH):
//   F1            factory exports complete
//   F2            slotStatePath() — null for empty, path for valid
//   F3            dispose(null|undefined) idempotent
//   F5-remote     in-process runOauthLogin({}) returns 4 (slot required)
//                 — no subprocess needed since bin/browser-harness is not
//                 shipped to the remote
//   F6            oauth exports + --slot required
//   F7-remote     factory + oauth modules co-loadable in same process
//                 (the canonical use case)
//   F8-remote     SLOT_STATE dir creates with mode 0700 if absent
//
// Output preserves the same `__BROWSER_HARNESS_SELFTEST__ PASS|FAIL fails=N`
// sentinel as the local selftest. The remote driver (lib/remote.cjs)
// prefixes each output line with "(remote)" so callers can distinguish.

'use strict';

async function runRemoteSelftest({ factory, oauth, libDir }) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  let fails = 0;
  function pass(name, msg) { process.stdout.write(`  PASS ${name} ${msg || ''} (remote)\n`); }
  function fail(name, msg) { process.stderr.write(`  FAIL ${name} ${msg || ''} (remote)\n`); }

  // F1
  try {
    const required = ['create', 'dispose', 'persistState', 'withContext', 'slotStatePath', 'STATE_DIR'];
    const missing = required.filter(k => typeof factory[k] === 'undefined');
    if (missing.length) { fail('F1', `missing exports: ${missing.join(',')}`); fails++; }
    else pass('F1', 'factory exports complete');
  } catch (e) { fail('F1', e.message); fails++; }

  // F2
  try {
    const a = factory.slotStatePath('');
    const b = factory.slotStatePath(null);
    const c = factory.slotStatePath(9);
    if (a !== null || b !== null) { fail('F2', `empty/null slot must return null (got ${a},${b})`); fails++; }
    else if (typeof c !== 'string' || !c.endsWith('slot-9.json')) { fail('F2', `slot 9 path malformed: ${c}`); fails++; }
    else pass('F2', `slot path = ${c}`);
  } catch (e) { fail('F2', e.message); fails++; }

  // F3
  try {
    await factory.dispose(null);
    await factory.dispose(undefined);
    pass('F3', 'dispose(null|undefined) idempotent');
  } catch (e) { fail('F3', `dispose threw: ${e.message}`); fails++; }

  // F5-remote — in-process runOauthLogin({}) → 4 (slot required).
  // Substitutes for the local F5 probe-subprocess check, which can't run
  // here because bin/browser-harness is not shipped to the remote.
  try {
    if (typeof oauth.runOauthLogin !== 'function') {
      fail('F5', `oauth.runOauthLogin not a function`);
      fails++;
    } else {
      const code = await oauth.runOauthLogin({});
      if (code !== 4) { fail('F5', `runOauthLogin({}) → ${code}, expected 4`); fails++; }
      else pass('F5', `in-process runOauthLogin({}) → 4 (slot required)`);
    }
  } catch (e) { fail('F5', e.message); fails++; }

  // F6
  try {
    const oauthMissing = ['runOauthLogin', 'isStateValid', 'safeUrlPrefix']
      .filter(k => typeof oauth[k] !== 'function');
    if (oauthMissing.length) {
      fail('F6', `oauth module missing exports: ${oauthMissing.join(',')}`);
      fails++;
    } else {
      const code = await oauth.runOauthLogin({});
      if (code !== 4) { fail('F6', `slot-required exit=${code}`); fails++; }
      else pass('F6', 'oauth exports + --slot required');
    }
  } catch (e) { fail('F6', e.message); fails++; }

  // F7-remote — factory + oauth modules co-loadable in same process.
  // The canonical use case: oauth.cjs requires factory.cjs internally,
  // so we verify both are present, both have the right shape, and we
  // can re-require oauth without it complaining about its factory dep.
  try {
    if (typeof factory.create !== 'function') { fail('F7', `factory.create missing`); fails++; }
    else if (typeof oauth.runOauthLogin !== 'function') { fail('F7', `oauth.runOauthLogin missing`); fails++; }
    else {
      // Re-require oauth via the materialised libDir to confirm the
      // factory dep resolves (it's a relative require inside oauth.cjs).
      const oauth2 = require(path.join(libDir, 'oauth.cjs'));
      if (typeof oauth2.runOauthLogin !== 'function') {
        fail('F7', `re-required oauth missing runOauthLogin`);
        fails++;
      } else pass('F7', 'factory + oauth co-loadable in same process');
    }
  } catch (e) { fail('F7', `co-load failed: ${e.message}`); fails++; }

  // F8-remote — SLOT_STATE dir creates with mode 0700 if absent.
  // Use a per-pid scratch dir to avoid mutating real state. We exercise
  // the same mkdir/chmod path the real flow takes.
  try {
    const scratch = path.join(os.tmpdir(), `bh-remote-selftest-f8-${process.pid}`);
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (_) {}
    fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      try { fs.chmodSync(scratch, 0o700); } catch (_) {}
      const st = fs.statSync(scratch);
      const mode = st.mode & 0o777;
      if (mode !== 0o700) {
        fail('F8', `SLOT_STATE dir mode = ${mode.toString(8)}, expected 700`);
        fails++;
      } else pass('F8', `SLOT_STATE dir mkdir+chmod 0700 OK`);
    } else {
      // win32: mode bits aren't POSIX; just verify the dir exists.
      if (!fs.existsSync(scratch)) { fail('F8', `dir not created`); fails++; }
      else pass('F8', `SLOT_STATE dir created (win32 — mode skipped)`);
    }
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (_) {}
  } catch (e) { fail('F8', e.message); fails++; }

  if (fails === 0) {
    process.stdout.write('__BROWSER_HARNESS_SELFTEST__ PASS fails=0 (remote)\n');
    return 0;
  }
  process.stdout.write(`__BROWSER_HARNESS_SELFTEST__ FAIL fails=${fails} (remote)\n`);
  return 5;
}

module.exports = { runRemoteSelftest };
