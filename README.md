# browser-harness

Playwright-based browser automation harness. Fresh-context factory + probe + selftest.
Designed for AI-native invocation: machine-parseable contract sentinels, deterministic
resolver priority, no hidden global state.

## Install

```bash
# 1. Install hexa-lang (ships `hexa` + `hx` package manager)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/dancinlab/hexa-lang/main/install.sh)"

# 2. Install browser-harness
hx install browser-harness          # global, pulls latest from registry
```

## Run

```bash
browser-harness probe                                    # check install + factory loadable
browser-harness selftest                                 # run F1-F9 structural fixtures
browser-harness oauth-login --slot N [--headless]        # oauth flow (see docs/oauth-login.md)
browser-harness version                                  # print version (fleet → Mac version only)
browser-harness help                                     # usage
```

All subcommands above accept `[--target {mac|ubu1|ubu2|fleet}]` (oauth-login: mac|ubu1|ubu2 only).

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
| `BROWSER_HARNESS_NO_BOOTSTRAP` | `0` | `1` disables auto `npm ci` (CI hermetic mode; fail loud if deps missing) |
| `BROWSER_HARNESS_FLEET_HOSTS` | `ubu2` | comma-separated host list for `--target fleet` |
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

`browser-harness selftest` runs without launching a browser AND without making any SSH call. F1-F9:

| ID | Asserts |
|---|---|
| F1 | `lib/factory.cjs` exports complete (`create`, `dispose`, `persistState`, `withContext`, `slotStatePath`, `STATE_DIR`) |
| F2 | `slotStatePath()` — null for empty/null slot, `slot-<N>.json` for valid |
| F3 | `dispose(null)` and `dispose(undefined)` idempotent (no throw) |
| F4 | `parseArgs` flag-with-value vs flag-only roundtrip |
| F5 | `probe` subprocess returns `ready\n` exit 0 OR `absent: …\n` exit 1 |
| F6 | `lib/oauth.cjs` exports `runOauthLogin`, `isStateValid`, `safeUrlPrefix`; `runOauthLogin({})` returns 4 (slot required); chmod 0600 capable on POSIX |
| F7 | `lib/remote.cjs` exports `runRemote`, `runOauthLoginRemote`, `runFleet`, `preflight`, `buildPayload`, `fleetHosts`; `buildPayload(...)` returns a self-contained Node script (`'use strict';` header + inlined `factory.cjs` + `oauth.cjs`) |
| F8 | `--target` arg parsed correctly: default → `mac`; `ubu1`/`ubu2`/`fleet` → `isRemoteTarget()===true`; bare `--target` (no value) falls back to `mac` |
| F9 | `tests/selftest_remote.cjs` ships, `lib/remote.cjs` exports `runRemoteSelftest`, AND `buildPayload({subcmd:'selftest'})` inlines the fixture (and only that subcmd does — `probe`/`oauth-login`/`version` payloads stay small) |

Exit 0 on `fails=0`, exit 5 otherwise. Final line is the sentinel.

Remote-side selftest (`browser-harness selftest --target ubu*`) runs symmetric coverage in-process on the remote: F1/F2/F3/F6 (same as bundled today) PLUS F5-remote (in-process `runOauthLogin({}) → 4`, no subprocess needed since `bin/browser-harness` is not shipped), F7-remote (factory + oauth co-loadable in same process — the canonical use case), F8-remote (SLOT_STATE dir creates with mode 0700 if absent). Same `__BROWSER_HARNESS_SELFTEST__ PASS fails=N (remote)` sentinel; lines prefixed with `(remote)`.

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
- `v0.2.1` — bootstrap switched from `npm install` to `npm ci` (with fallback to `npm install` only when `package-lock.json` absent). Eliminates the `hx update browser-harness` friction where the post-install lockfile regeneration left `package-lock.json` locally-modified, which then made `git pull --ff-only` refuse to apply the update. `npm ci` reads but never writes the lockfile, so the working tree stays clean across invocations.
- `v0.3.0` — `lib/remote.cjs` Mac→ubu1/ubu2/fleet SSH-pipe transport; `--target {mac|ubu1|ubu2|fleet}` flag added to `probe`, `selftest`, `version`, `oauth-login`. Self-contained Node payload (factory.cjs + oauth.cjs inlined as base64) piped to `ssh <host> 'node -'`; preflight asserts node + playwright on the remote (npx cache discovered automatically; falls back to one-shot tmpdir install). `oauth-login --target ubu*` SCPs slot-N.json over before launch and pulls the updated state back on success/idempotent (mode 0600); failure leaves Mac state untouched. `--target fleet` fans out across `BROWSER_HARNESS_FLEET_HOSTS` (default `ubu2`); `oauth-login --target fleet` is refused. F7 (remote module) + F8 (target parsing) added to selftest. Bash exit-50 stub message superseded.
- `v0.3.1` — symmetric remote selftest + exit-52 SCP-skip via content hash. (1) `tests/selftest_remote.cjs` ships and is inlined into the SSH payload by `lib/remote.cjs::buildPayload()` when `subcmd === 'selftest'`. Remote coverage now matches the local F1-F8 surface as F1/F2/F3/F6 (bundled today) + **F5-remote** (in-process `runOauthLogin({}) → 4` — no subprocess needed since `bin/browser-harness` isn't shipped) + **F7-remote** (factory + oauth co-loadable in the same process — the canonical use case) + **F8-remote** (SLOT_STATE dir creates with mode 0700 if absent). F4 stays CLI-side (parseArgs is a Mac concern); F7/F8 don't apply to the remote payload itself (the remote never inspects `--target`). Same `__BROWSER_HARNESS_SELFTEST__ PASS fails=N (remote)` sentinel; output lines prefixed with `(remote)`. F9 added to local selftest as a structural guard (fixture exists + `runRemoteSelftest` exported + payload references it for the selftest subcmd only). (2) `runOauthLoginRemote` now skips the SCP-back when the remote returned exit 52 AND the local + remote slot files are byte-identical (sha256 compared via `ssh <host> shasum -a 256 <path>`). Logs `remote.cjs: slot-<N> state byte-identical, skipped SCP-back`. When local has no prior state but remote returned 52, still SCPs back (preserve a pre-seeded remote). Exit 0 always SCPs back.

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
│   ├── harness.cjs                subcommand dispatcher (--target wiring)
│   ├── factory.cjs                fresh-context factory (M1-M6)
│   ├── oauth.cjs                  real oauth-login flow (v0.2.0)
│   └── remote.cjs                 Mac→ubu1/ubu2/fleet SSH-pipe transport (v0.3.0)
├── docs/
│   └── oauth-login.md             oauth-login design + exit codes + env + security
├── tests/
│   ├── selftest.cjs               F1-F9 (Mac-side; default `--target mac`)
│   └── selftest_remote.cjs        F1/F2/F3/F6 + F5-remote/F7-remote/F8-remote (inlined into SSH payload)
└── wrappers/
    └── browser_harness.hexa       optional hexa-side wrapper
```

## License

MIT.
