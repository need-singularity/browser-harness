# oauth-login (v0.2.0)

`browser-harness oauth-login --slot N [--headless]` performs an interactive
OAuth login against a configured authorization endpoint and persists the
resulting browser storage state (cookies + localStorage) into a slot file
under `~/.browser-harness/state/slot-<N>.json` (file mode 0600).

The intended target — derived from the audit trail (see "Audit references"
below) — is the Anthropic Claude OAuth flow used by `claude auth login
--claudeai`. The flow uses PKCE and a redirect to
`https://platform.claude.com/oauth/code/callback`. The harness opens the
authorize URL in a real browser (Playwright via `playwright-core`) and
waits for the user to click "Allow". On callback the storage state is
persisted to the slot file so subsequent runs reuse it.

## Slot semantics

`slot N` selects a per-account isolation namespace. The factory writes
the storage state file to:

```
${BROWSER_HARNESS_STATE:-~/.browser-harness/state}/slot-<N>.json
```

Two invocations with the same `--slot N` share storage state (so a
successful login persists across runs). Two invocations with different
`--slot` values are fully isolated — distinct cookie jars, distinct
localStorage. This matches the per-host, per-slot Claude account
isolation pattern used elsewhere in the fleet (e.g. `CLAUDE_CONFIG_DIR=
~/.claude-claude<N>`).

## Flow

1. Resolve slot state path. If `--slot` missing → exit 4.
2. Validate existing state if present (`isStateValid`). If valid AND
   non-expired → exit 52 (idempotent no-op).
3. If `--headless=true`: short-circuit. Manual user click cannot be
   automated by Anthropic security design (audit `browser_harness_oauth_login`
   raw 91 verdict). Exit 51 with fallback suggestion.
4. Otherwise: launch chromium engine headed via `factory.withContext({
   slot, engine: 'chromium', headless: false, timeoutMs: ... })`.
5. Navigate to the configured `BROWSER_HARNESS_OAUTH_START_URL` (no
   default in v0.2.0 — must be supplied by caller; this avoids hardcoding
   the Anthropic PKCE URL with embedded client_id, which can rotate).
   If unset → exit 1 with structured error.
6. Wait for navigation to the success URL pattern
   (`BROWSER_HARNESS_OAUTH_SUCCESS_PATTERN`, regex; default
   `^https?://platform\\.claude\\.com/oauth/code/callback`).
7. On success: `factory.persistState(handle)` writes the state file.
   `chmod 0600` the file. Exit 0.
8. On user-click timeout (`BROWSER_HARNESS_OAUTH_TIMEOUT_MS`, default
   300000 = 5 min) → exit 1 with `oauth-login: timeout waiting for user
   consent`.
9. On any other browser/launch error → exit 1 with the exception message.

## Exit codes

| Code | Meaning |
|---|---|
| 0  | login successful, storageState persisted (mode 0600) |
| 1  | login failed (network, missing OAUTH_START_URL, browser launch error, timeout, success pattern not matched) |
| 4  | usage error (missing `--slot`) |
| 51 | manual interaction required but `--headless=true` — caller should retry without `--headless` OR fall back to manual TTY (`CLAUDE_CONFIG_DIR=~/.claude-claude<N> claude auth login --claudeai`) OR reuse a refresh-token slot |
| 52 | already logged in — slot state file present and structurally valid, no flow run |

(`50` is removed — the flow is no longer "not implemented".)

## Env

| Var | Default | Effect |
|---|---|---|
| `BROWSER_HARNESS_OAUTH_START_URL` | (none — required) | the OAuth authorize URL to navigate to |
| `BROWSER_HARNESS_OAUTH_SUCCESS_PATTERN` | `^https?://platform\\.claude\\.com/oauth/code/callback` | regex matched against `page.url()` to declare success |
| `BROWSER_HARNESS_OAUTH_TIMEOUT_MS` | `300000` (5 min) | ceiling on the user-click phase |
| `BROWSER_HARNESS_OAUTH_ENGINE` | `chromium` | Playwright engine used for the headed browser (chromium recommended — Anthropic OAuth gate has historically been chromium-friendliest) |

## Failure modes

- **OAuth provider HTML changed** — covered by waiting on URL pattern
  rather than a CSS selector for the "Allow" button. The button itself
  may be React-rendered after a session check (audit
  `browser_harness_headless_experiment` raw 10 verdict_correction). The
  harness does NOT click anything — it waits for the user.
- **Pattern never matches** — exit 1 after timeout with the last URL.
- **Network fail / DNS / launch error** — exit 1 with exception message.
- **Headless + manual click required** — exit 51, never silently log
  into nothing.

## Security

- Storage state file is chmod 0600 immediately after `persistState`.
  F6 verifies this where the platform supports it (POSIX). On Windows
  (not currently supported) the chmod is a no-op.
- The state file can contain bearer tokens, session cookies, refresh
  tokens. Treat as equivalent to an active credential. Slot files live
  under `~/.browser-harness/state/` which inherits the user's home
  directory permissions (typically 0755 — readable by other local users
  unless `~` is locked down). Operators on shared hosts should set
  `BROWSER_HARNESS_STATE` to a directory under a 0700 path.
- The harness does NOT log the storage state contents, the OAuth code,
  or any URL query string containing `code=`. URL prefixes are truncated
  to scheme+host+path before logging.
- The harness does NOT take screenshots or record video.

## Audit references

- `~/.hive/state/fix_audit/browser_harness_oauth_experiment.jsonl` —
  slot survey, PKCE host = `claude.com/cai/oauth/authorize`, manual
  Allow click required, recommended tier hierarchy.
- `~/.hive/state/fix_audit/browser_harness_oauth_login.jsonl` — confirms
  reach-only is automatable; user consent click + code paste cannot be
  automated per Anthropic security design (raw 91 verdict).
- `~/.hive/state/fix_audit/browser_harness_headless_experiment.jsonl` —
  raw 10 verdict_correction: headless cannot complete OAuth without a
  user identity; the "Allow" button is React-rendered post auth-check.

## Open / TODO

- The exact OAuth start URL is **not hardcoded**. Callers must supply
  `BROWSER_HARNESS_OAUTH_START_URL` (typically obtained by running
  `claude auth login --claudeai` in non-tty mode and capturing the
  emitted URL). When unset the flow exits 1 immediately rather than
  guessing — this fail-loud behaviour is required by the task contract.
- State validity check (`isStateValid`) currently only verifies the
  file is present, parseable JSON, and contains at least one cookie or
  origin. It does NOT check token expiry — that requires per-provider
  knowledge. A future v0.3.x may add provider plugins.
