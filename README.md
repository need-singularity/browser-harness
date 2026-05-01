# browser-harness

Playwright-based browser automation harness. Fresh-context factory + probe + selftest.
Designed for AI-native invocation: machine-parseable contract sentinels, deterministic
resolver priority, no hidden global state.

```sh
hx install need-singularity/browser-harness
browser-harness probe        # → ready
```

## Install

| Method | Command | Notes |
|---|---|---|
| hx (canonical) | `hx install need-singularity/browser-harness` | clones + runs `install.sh` + symlinks `~/.hx/bin/browser-harness` |
| hx update | `hx update browser-harness` | git pull; deps auto-resync on next invocation (see "Update tracking") |
| direct git | `git clone https://github.com/need-singularity/browser-harness && cd browser-harness && ./install.sh` | manual path |

`hx install need-singularity/browser-harness@<sha>` is **not** supported by current
`hx` (regex `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$` rejects `@`). Pin to a tag/sha by
manually checking out inside `~/.hx/packages/browser-harness/` if needed.

## CLI surface

```
browser-harness <subcommand> [options]
```

| Subcommand | Behavior | Exit | Sentinel (stdout) |
|---|---|---|---|
| `probe` | check installability + factory loadable | 0 ready / 1 absent | `ready` or `absent: <why>` |
| `selftest` | F1-F6 structural fixtures (no live browser) | 0 PASS / 5 FAIL | `__BROWSER_HARNESS_SELFTEST__ PASS\|FAIL fails=<N>` |
| `oauth-login --slot N [--headless]` | OAuth flow → slot-isolated storageState (see `docs/oauth-login.md`) | 0 / 1 / 4 / 51 / 52 | `oauth-login: …` (per-result) |
| `version` | print version | 0 | `<X.Y.Z>` |
| `help` | usage | 0 | — |

Exit code conventions: `0` PASS, `1` absent/probe-fail/oauth-fail, `2` fatal,
`4` usage, `5` selftest fail, `51` oauth manual-required-but-headless,
`52` oauth idempotent-already-logged-in.

## Env

| Var | Default | Effect |
|---|---|---|
| `BROWSER_HARNESS_ENGINE` | `firefox` | `chromium` \| `firefox` \| `webkit` (selects Playwright engine) |
| `BROWSER_HARNESS_EXECUTABLE` | (auto) | path to browser binary; bypasses bundled |
| `BROWSER_HARNESS_STATE` | `~/.browser-harness/state` | per-slot storage state dir |
| `BROWSER_HARNESS_HOME` | (unset) | override resolver root for hexa wrappers |
| `BROWSER_HARNESS_NO_BOOTSTRAP` | `0` | `1` disables auto `npm install` (CI hermetic mode; fail loud if deps missing) |
| `BROWSER_HARNESS_OAUTH_START_URL` | (required for `oauth-login`) | the OAuth authorize URL to navigate to |
| `BROWSER_HARNESS_OAUTH_SUCCESS_PATTERN` | `^https?://platform\.claude\.com/oauth/code/callback` | regex matched against `page.url()` to declare success |
| `BROWSER_HARNESS_OAUTH_TIMEOUT_MS` | `300000` | ceiling on the user-click phase (oauth-login) |
| `BROWSER_HARNESS_OAUTH_ENGINE` | `chromium` | Playwright engine for the headed oauth-login window |
| `NODE` | `$(command -v node)` | override Node binary path |

## Update tracking

`hx update` does `git pull --ff-only` and refreshes the shim, but does **not**
re-run `install.sh`. The CLI handles dep drift itself by checking on every
invocation:

```
trigger npm install if any of:
  - node_modules/ missing
  - node_modules/playwright-core/ missing
  - package.json newer than node_modules/.package-lock.json
  - package-lock.json newer than node_modules/.package-lock.json
```

The cost is a single `stat` per invocation when in sync (cheap). Bootstrap
runs in ~2s on a warm npm cache. Set `BROWSER_HARNESS_NO_BOOTSTRAP=1` to
disable (CI / immutable images).

## Programmatic use (Node)

```js
const factory = require('/Users/<user>/.hx/packages/browser-harness/lib/factory.cjs');

await factory.withContext({ slot: 9, engine: 'firefox', headless: true }, async (h) => {
  const page = await h.context.newPage();
  await page.goto('https://example.com');
  // ...
});
// dispose() runs even on throw — mandate M6
```

| Export | Signature | Mandate |
|---|---|---|
| `create(opts)` | `→ {browser, context, slot, statePath}` | M1 fresh context per call |
| `dispose(handle)` | `→ void` | M2 close ctx + browser, idempotent on null |
| `persistState(handle)` | `→ statePath \| null` | M4 write storage state per slot |
| `withContext(opts, fn)` | `→ <fn return>` | M6 dispose-on-throw |
| `slotStatePath(slot)` | `→ string \| null` | M3 slot isolation path |

Mandate enforcement (1-6):

1. Fresh `BrowserContext` per `create()` — no state leak between runs.
2. `dispose()` closes context and browser; idempotent on `null`/`undefined`.
3. Empty cookies/storage by default; opt-in via `slot` parameter.
4. Slot storage at `BROWSER_HARNESS_STATE/slot-<N>.json`.
5. Default timeout 30s via `context.setDefaultTimeout`; override with `opts.timeoutMs`.
6. `withContext()` runs `dispose()` in `finally` — clean exit even on throw.

## Hexa-side wrapper

For hexa scripts that prefer io-seam separation over direct shell:

```sh
hexa run ~/.hx/packages/browser-harness/wrappers/browser_harness.hexa --invoke probe
hexa run ~/.hx/packages/browser-harness/wrappers/browser_harness.hexa --invoke selftest
```

Resolver priority (deterministic, top-down):

```
1. $BROWSER_HARNESS_HOME/bin/{harness,browser-harness}
2. ~/.hx/bin/browser-harness                                  ← canonical
3. ~/.hx/packages/browser-harness/bin/browser-harness
4. ~/.hx/packages/browser-harness/bin/harness                 ← legacy alias
5. ~/.local/bin/browser-harness
```

Wrapper sentinel: `__BROWSER_HARNESS_PROBE__ status=<present|absent> path=<resolved>`.

## Selftest contract

`browser-harness selftest` runs without launching a browser. F1-F6:

| ID | Asserts |
|---|---|
| F1 | `lib/factory.cjs` exports complete (`create`, `dispose`, `persistState`, `withContext`, `slotStatePath`, `STATE_DIR`) |
| F2 | `slotStatePath()` — null for empty/null slot, `slot-<N>.json` for valid |
| F3 | `dispose(null)` and `dispose(undefined)` idempotent (no throw) |
| F4 | `parseArgs` flag-with-value vs flag-only roundtrip |
| F5 | `probe` subprocess returns `ready\n` exit 0 OR `absent: …\n` exit 1 |
| F6 | `lib/oauth.cjs` exports `runOauthLogin`, `isStateValid`, `safeUrlPrefix`; `runOauthLogin({})` returns 4 (slot required); chmod 0600 capable on POSIX |

Exit 0 on `fails=0`, exit 5 otherwise. Final line is the sentinel.

CI integration (any orchestrator):

```sh
out=$(browser-harness selftest 2>&1)
echo "$out" | grep -q "__BROWSER_HARNESS_SELFTEST__ PASS fails=0" || { echo "$out"; exit 1; }
```

## Versioning

- `v0.1.0` — initial; `bin/harness` entry
- `v0.1.1` — entry rename `bin/browser-harness` (matches hx auto-detect convention `bin/<pkg-name>`); `bin/harness` kept as symlink for back-compat; self-bootstrap on existence check
- `v0.1.2` — dep-drift detection (lockfile mtime); shipped `wrappers/browser_harness.hexa`
- `v0.2.0` — real `oauth-login` (`lib/oauth.cjs`); slot-isolated storageState persistence (mode 0600); exit codes 0/1/4/51/52 (50 removed); `BROWSER_HARNESS_OAUTH_*` env surface; F6 added to selftest. See `docs/oauth-login.md`.

## Layout

```
browser-harness/
├── hexa.toml                      hx manifest (name, version, entry)
├── package.json                   npm manifest (playwright-core dep)
├── install.sh                     hx build hook (fresh install only)
├── bin/
│   ├── browser-harness            CLI entry (bash → node); self-bootstraps deps
│   └── harness                    symlink → browser-harness (legacy)
├── lib/
│   ├── harness.cjs                subcommand dispatcher
│   ├── factory.cjs                fresh-context factory (M1-M6)
│   └── oauth.cjs                  real oauth-login flow (v0.2.0)
├── docs/
│   └── oauth-login.md             oauth-login design + exit codes + env + security
├── tests/
│   └── selftest.cjs               F1-F6
└── wrappers/
    └── browser_harness.hexa       optional hexa-side wrapper
```

## License

MIT.
