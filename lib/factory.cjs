// fresh-context factory — mandate 1-6
//
// M1: every create() returns a fresh BrowserContext (no state from prior runs)
// M2: dispose() must close context AND browser (no zombie processes)
// M3: each context starts with empty cookies/storage (slot isolation)
// M4: storage state per-slot under STATE_DIR/<slot>.json (opt-in load)
// M5: timeout enforced via context.setDefaultTimeout (default 30s)
// M6: clean exit codes — withContext() returns the user fn's result and
//     guarantees dispose runs even on throw

const path = require('path');
const fs = require('fs');
const os = require('os');

const STATE_DIR = process.env.BROWSER_HARNESS_STATE
  || path.join(os.homedir(), '.browser-harness', 'state');

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function slotStatePath(slot) {
  if (slot === undefined || slot === null || slot === '') return null;
  return path.join(STATE_DIR, `slot-${slot}.json`);
}

async function create(opts = {}) {
  const { chromium, firefox, webkit } = require('playwright-core');
  const engineName = opts.engine || process.env.BROWSER_HARNESS_ENGINE || 'firefox';
  const engineMap = { chromium, firefox, webkit };
  const engine = engineMap[engineName];
  if (!engine) throw new Error(`unknown engine: ${engineName}`);

  const headless = opts.headless !== undefined ? !!opts.headless : true;
  const launchOpts = { headless };
  if (process.env.BROWSER_HARNESS_EXECUTABLE) {
    launchOpts.executablePath = process.env.BROWSER_HARNESS_EXECUTABLE;
  }

  const browser = await engine.launch(launchOpts);

  const ctxOpts = {};
  const sp = slotStatePath(opts.slot);
  if (sp && fs.existsSync(sp)) ctxOpts.storageState = sp;

  const context = await browser.newContext(ctxOpts);
  context.setDefaultTimeout(opts.timeoutMs || 30000);

  return {
    browser,
    context,
    slot: opts.slot,
    statePath: sp,
  };
}

async function dispose(handle) {
  if (!handle) return;
  try { if (handle.context) await handle.context.close(); } catch (_) {}
  try { if (handle.browser) await handle.browser.close(); } catch (_) {}
}

async function persistState(handle) {
  if (!handle || !handle.statePath) return null;
  ensureStateDir();
  await handle.context.storageState({ path: handle.statePath });
  return handle.statePath;
}

async function withContext(opts, fn) {
  const handle = await create(opts);
  try {
    return await fn(handle);
  } finally {
    await dispose(handle);
  }
}

module.exports = { create, dispose, persistState, withContext, slotStatePath, STATE_DIR };
