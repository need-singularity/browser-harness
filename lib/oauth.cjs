// oauth-login implementation — v0.2.0
//
// Real OAuth login flow. Uses factory.withContext for the browser session;
// persists storageState via factory.persistState on success.
//
// Contract: see docs/oauth-login.md.
//
// Exit semantics (returned, not process.exit'd — caller does that):
//   0  login successful, storageState persisted (mode 0600)
//   1  login failed (network, missing OAUTH_START_URL, browser launch
//      error, timeout, success pattern not matched)
//   4  usage (missing --slot)        ← raised by caller, not here
//   51 manual interaction required but --headless=true
//   52 already logged in (storageState valid, idempotent no-op)

const fs = require('fs');
const path = require('path');
const factory = require('./factory.cjs');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const DEFAULT_SUCCESS_PATTERN =
  '^https?://platform\\.claude\\.com/oauth/code/callback';
const DEFAULT_ENGINE = 'chromium';

// --- helpers ---------------------------------------------------------------

function err(msg) { process.stderr.write(`oauth-login: ${msg}\n`); }

function safeUrlPrefix(u) {
  // strip query/fragment so we never log code=… etc.
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch (_) { return '<unparseable>'; }
}

function isStateValid(statePath) {
  // structural: file exists, parseable JSON, at least one cookie OR
  // at least one origin with localStorage entries. Token expiry is NOT
  // validated (per-provider concern; documented in docs/oauth-login.md).
  if (!statePath || !fs.existsSync(statePath)) return false;
  let raw;
  try { raw = fs.readFileSync(statePath, 'utf8'); }
  catch (_) { return false; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) { return false; }
  const hasCookies = Array.isArray(parsed.cookies) && parsed.cookies.length > 0;
  const hasOrigins =
    Array.isArray(parsed.origins) &&
    parsed.origins.some(o => Array.isArray(o.localStorage) && o.localStorage.length > 0);
  return hasCookies || hasOrigins;
}

function chmod0600(p) {
  try { fs.chmodSync(p, 0o600); return true; }
  catch (_) { return false; }
}

// --- main flow -------------------------------------------------------------

async function runOauthLogin(opts) {
  const slot = opts && opts.slot;
  if (slot === undefined || slot === null || slot === '') {
    err('usage: oauth-login --slot <N> [--headless]');
    return 4;
  }
  const headless = !!(opts && opts.headless);
  const statePath = factory.slotStatePath(slot);

  // (1) idempotent short-circuit
  if (isStateValid(statePath)) {
    chmod0600(statePath);
    process.stdout.write(`oauth-login: already logged in slot=${slot} state=${statePath}\n`);
    return 52;
  }

  // (2) headless guard — manual click cannot be automated
  if (headless) {
    err(
      `manual user consent required, but --headless=true. Slot=${slot}.\n` +
      `  fallback 1 (manual TTY): CLAUDE_CONFIG_DIR=~/.claude-claude<N> claude auth login --claudeai\n` +
      `  fallback 2 (re-run headed): browser-harness oauth-login --slot ${slot}\n` +
      `  fallback 3 (refresh-token reuse): copy a valid slot-<M>.json over slot-${slot}.json`
    );
    return 51;
  }

  // (3) start URL — NEVER hardcoded; caller supplies via env
  const startUrl = process.env.BROWSER_HARNESS_OAUTH_START_URL;
  if (!startUrl) {
    err(
      'BROWSER_HARNESS_OAUTH_START_URL is not set. ' +
      'Capture the authorize URL from `claude auth login --claudeai` ' +
      '(non-tty mode emits it on stdout) and re-export.'
    );
    return 1;
  }

  const successPatternStr =
    process.env.BROWSER_HARNESS_OAUTH_SUCCESS_PATTERN || DEFAULT_SUCCESS_PATTERN;
  let successRe;
  try { successRe = new RegExp(successPatternStr); }
  catch (e) {
    err(`invalid BROWSER_HARNESS_OAUTH_SUCCESS_PATTERN regex: ${e.message}`);
    return 1;
  }

  const timeoutMs = parseInt(
    process.env.BROWSER_HARNESS_OAUTH_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10
  );
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    err(`invalid BROWSER_HARNESS_OAUTH_TIMEOUT_MS: ${process.env.BROWSER_HARNESS_OAUTH_TIMEOUT_MS}`);
    return 1;
  }

  const engine = process.env.BROWSER_HARNESS_OAUTH_ENGINE || DEFAULT_ENGINE;

  process.stdout.write(
    `oauth-login: launching headed ${engine} for slot=${slot}; ` +
    `start=${safeUrlPrefix(startUrl)}; success=/${successPatternStr}/; ` +
    `timeout=${timeoutMs}ms\n`
  );
  process.stdout.write(`oauth-login: complete the consent flow in the browser window.\n`);

  let resultCode = 1;
  try {
    await factory.withContext(
      { slot, engine, headless: false, timeoutMs },
      async (h) => {
        const page = await h.context.newPage();
        try {
          await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        } catch (e) {
          err(`navigation to start URL failed: ${e.message}`);
          throw e;
        }
        // Wait for the user to click Allow → URL transitions to success pattern.
        try {
          await page.waitForURL(successRe, { timeout: timeoutMs });
        } catch (e) {
          err(
            `timeout (${timeoutMs}ms) waiting for OAuth callback. ` +
            `last url prefix=${safeUrlPrefix(page.url())}`
          );
          throw e;
        }
        process.stdout.write(
          `oauth-login: callback observed at ${safeUrlPrefix(page.url())}\n`
        );
        const persisted = await factory.persistState(h);
        if (!persisted) {
          err('persistState returned null — slot path missing?');
          throw new Error('persistState_failed');
        }
        chmod0600(persisted);
        process.stdout.write(
          `oauth-login: slot=${slot} state persisted at ${persisted} (mode 0600)\n`
        );
        resultCode = 0;
      }
    );
  } catch (e) {
    if (resultCode === 0) return 0; // shouldn't happen but defensive
    err(`flow failed: ${e.message || e}`);
    return 1;
  }
  return resultCode;
}

module.exports = { runOauthLogin, isStateValid, safeUrlPrefix };
