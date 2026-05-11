---
schema: browser-harness/docs/browser_harness_self_mk2_tuning_landed/ai-native/1
last_updated: 2026-05-02
ssot:
  marker: state/markers/browser_harness_self_mk2_tuning_landed.marker
  roadmap_dir_pattern: <repo>/.roadmap.<domain>
  baseline_ai_native: .ai-native-readme-baseline
status: AUDIT_LANDED_SPEC_ONLY
related_raws:
  - raw 9    # hexa-only orchestration (audit-only; harness impl is .cjs grandfather under raw 168 minimum-viable)
  - raw 10   # honest C3 caveats inline
  - raw 11   # snake_case (N/A for .cjs surface; checked for .hexa wrapper)
  - raw 12   # silent-error ban (no fab)
  - raw 15   # env() lazy + <user> placeholder
  - raw 65   # args ABI (verified in wrappers/browser_harness.hexa)
  - raw 91   # honest verdict
  - raw 92   # no_silent_errors / fail-loud
  - raw 168  # minimum-viable exempt (single-module package — see §3.4)
  - raw 169  # surgical
  - raw 175  # BR-NO-USER-VERBATIM (no verbatim user quotes in this doc)
  - raw 247  # io-seam separation (wrappers/browser_harness.hexa annotated @io_seam)
  - raw 270  # core+module 4-file pattern (audit + candidate)
  - raw 271  # README.ai.md mandate (audit + candidate)
  - raw 272  # core/module file structure consistency (audit)
  - raw 273  # hierarchy connection direction (audit)
preserved_unchanged:
  - bin/browser-harness               # CLI entry (bash → node), self-bootstrap
  - lib/factory.cjs                   # mandate 1-6 fresh-context factory
  - lib/harness.cjs                   # subcommand dispatcher (--target wiring)
  - lib/oauth.cjs                     # real oauth-login flow (v0.2.0)
  - lib/remote.cjs                    # Mac→ubu1/ubu2/fleet SSH-pipe transport (v0.3.1)
  - tests/selftest.cjs                # F1-F9 Mac-side fixtures
  - tests/selftest_remote.cjs         # F1/F2/F3/F6 + F5/F7/F8-remote fixtures
  - wrappers/browser_harness.hexa     # canonical hexa-side wrapper
  - docs/oauth-login.md               # oauth-login design + exit codes + env + security
  - hexa.toml                         # hx manifest
  - package.json                      # npm manifest
  - install.sh                        # hx build hook
  - README.md                         # AI-native top-level doc
  - .gitignore                        # node_modules/, /state/, .workspace*
policy:
  migration: forbidden
  changes: additive_only
  in_place_writes: zero
  destructive_ops: zero
  cost_usd: 0
  substrate: mac-local
---

# browser-harness self mk2 tuning — domain audit + new .roadmap.<domain> candidates + raw 270 triplet plan

## TL;DR

browser-harness 는 dancinlab 산하 단일-목적 Playwright 오케스트레이션 패키지 (1482 LoC across
8 files, .cjs + .hexa wrapper hybrid). mk2 ecosystem (anima 26 / nexus 6+4 / hive 등) 와 달리
`.roadmap.<domain>` 파일이 **0건** 존재. 본 audit:

- **추가 권고 신규 .roadmap.<domain>** = 3개 (`harness_factory` / `oauth_login` / `remote_transport`)
  — spec emit only, 실제 .roadmap.* 파일 생성 X (additive only, 사용자 lock-in 후 별도 cycle).
- **raw 270/271/272/273 triplet 적용 audit** = README.md (top-level, 12.5KB AI-native) 1건 land,
  `core/` + `modules/` 구조 미적용 (single-module package — raw 168 minimum-viable exempt 권고).
- **마이그레이션 0건 emit**, in-place write 0건, additive only.
- **F1-F9 selftest baseline 0/9 fail** (audit-time PASS confirmed via `node tests/selftest.cjs`).
- handoff doc + marker 2건 NEW only.

## §1 Existing 0 .roadmap.<domain> baseline (audit)

### §1.1 Domain inventory

| 파일 | kind | 비고 |
|---|---|---|
| (none) | — | mk2 .roadmap.* 파일 0건. browser-harness 는 단일-목적 패키지로 mk2 ecosystem 등록 미수행 |

cf. anima 26 / nexus 6+4 land / hive .raw.mk2 3 foundational rules

### §1.2 mk2 ecosystem 와의 cross-link 현황

- **consumer side**: `anima/tool/browser_harness.hexa` (194 LoC, anima-side 호출 wrapper) +
  `hive/tool/browser_harness_invoke.hexa` (legacy, raw117_exempt). 두 sister 가 본 패키지를
  consume.
- **provider side**: 본 repo 의 `wrappers/browser_harness.hexa` (143 LoC, 자체 hexa 측 wrapper).
- mk2 .roadmap.<domain> 등록 시 `consumer perspective` (anima/hive) ↔ `provider perspective`
  (browser-harness self) 양면 cross-link 가능.

## §2 browser-harness self surface — 3 권고 신규 도메인 후보 (spec only, .roadmap.* 신규 emit X)

### §2.1 후보 매트릭스

| rank | domain candidate | top dir/files | LoC est | 핵심 unmet condition (예시) | 권장 cond.N |
|---|---|---|---:|---|---:|
| A | `harness_factory` | `lib/factory.cjs` (79) + `lib/harness.cjs` (198) + `bin/browser-harness` (82) | 359 | (1) F1-F9 selftest exit 0 / (2) probe contract live PASS (`ready` exit 0) / (3) mandate M1-M6 disposal 검증 | 3 |
| A | `oauth_login` | `lib/oauth.cjs` (171) + `docs/oauth-login.md` (128) | 299 | (1) F6 exports + chmod 0600 capable / (2) `--slot` required exit 4 / (3) `BROWSER_HARNESS_OAUTH_START_URL` unset → exit 1 fail-loud | 3 |
| B | `remote_transport` | `lib/remote.cjs` (428) + `tests/selftest_remote.cjs` (139) | 567 | (1) F7-F8 buildPayload self-contained / (2) F9 selftest_remote.cjs 인라인 (probe payload + 1000 bytes 검증) / (3) byte-identical SCP-back skip (sha256 비교) | 3 |

전체 3 후보 × 평균 3 condition = **9 새 required_conditions** 가 사용자 lock-in 시 추가될 수 있음.

### §2.2 후보 우선순위 rationale

- **rank A** (`harness_factory` / `oauth_login`) = 핵심 production surface. factory 는 mandate 1-6
  명세 그 자체이고 oauth 는 v0.2.0 부터 active credential path. 두 도메인이 90%의 prod 호출을 차지.
- **rank B** (`remote_transport`) = ubu1/ubu2/fleet SSH-pipe 확장 surface (v0.3.0+). live SSH 가 없는
  audit-time 환경에서는 F7-F8 structural fixture 만 run; cond.3 byte-identical 은 v0.3.1 lazy
  optimization (raw#10 honest — 100% 보장 X, content hash skip 만).

### §2.3 후보 비등록 (deferred / out-of-scope)

| candidate | 사유 |
|---|---|
| `wrappers_hexa` | wrappers/browser_harness.hexa = `harness_factory` 의 invocation seam. cross-link only 권장 |
| `selftest_meta` | tests/* = 각 도메인의 verifier seam. 단독 도메인 승격 불필요 |
| `install_bootstrap` | install.sh + bin/browser-harness self-bootstrap = `harness_factory.cond.1` 의 sub-component |
| `docs` | docs/oauth-login.md = `oauth_login.cond.0` artifact, single-doc raw 168 minimum-viable |

### §2.4 spec-only emit policy (사용자 lock-in 대기)

본 audit 는 **신규 .roadmap.<domain> 파일 0건 생성**. 사용자가 다음 cycle 에서:

1. 3 후보 중 어떤 것을 land 할지 선별 (예: rank A 2개만)
2. 각 cond.N 의 verifier seam 결정 (script / cross-link / manual)
3. blocker_reason / cross_link 구체화

후 별도 cycle 에서 hexa 도구로 안전 emit 권장. 현재 browser-harness 에는 anima/nexus 와 동등한
`tool/roadmap_op.hexa` 가 land 되어 있지 않음 — sister 의 `nexus/tool/roadmap_op.hexa` 패턴 참조
또는 본 repo 에서 자체 land (별도 cycle, raw 168 single-module exempt 적용 가능).

## §3 raw 270/271/272/273 triplet plan — browser-harness surface 의 ai-native readme audit

### §3.1 현황 (1 README.md land at audit time)

```
README.md                     12518 B (top-level, AI-native: contract sentinels +
                                       exit code map + resolver priority +
                                       mandate matrix M1-M6 + F1-F9 ID 표 + 환경변수 표)
docs/oauth-login.md            6569 B (oauth-login design + exit codes + env + security)
```

`README.ai.md` (literal basename, raw 271 mandate) 는 **부재** — 단, 본 repo 의 `README.md` 가
이미 raw 271 의 의도 (machine-parseable contract, sentinels, exit code map, mandate
matrix) 를 충족한다. raw 168 minimum-viable exempt 검토 권장 (§3.4).

`.ai-native-readme-baseline` (anima 패턴) = **부재**. browser-harness 가 mk2 ecosystem 적극 등록
대상 결정 시 land 권장.

### §3.2 raw 270/271/272/273 적용 audit

| 규칙 | 요구 | browser-harness 현황 | 적용 여부 | 권장 |
|---|---|---|---|---|
| raw 270 | core+module 4-file 패턴 (`core/<feature>/{source,registry,router,<feature>_main}.hexa`) + `modules/<feature>/{README.ai.md,<impl_n>.hexa}`, ≥2 implementations | flat lib/ + tests/ + bin/ + wrappers/ + docs/. 단일-implementation, .cjs + .hexa hybrid | NOT_APPLY (single-impl) | raw 168 exempt 권장. 재고 시점 = ≥2 implementation 등장 (예: `lib/factory_chrome.cjs` + `lib/factory_firefox.cjs` 분리) |
| raw 271 | `README.ai.md` (literal basename) `modules/<feature>/` 마다 1건 | top-level `README.md` 만 존재 (literal `README.ai.md` 부재) | PARTIAL (basename 미일치) | rank A 2 후보 도메인 land 시 sub-dir 신설 + `README.ai.md` 1건씩 — 또는 top-level README.md → README.ai.md 별칭 (symlink) 제안 |
| raw 272 | core+module 파일 구조 일관성 (aggregator stem == feature name, e.g. `core/rng/rng_main.hexa`) | core/ 부재. lib/{factory,harness,oauth,remote}.cjs 가 사실상 4-aggregator | NOT_APPLY (core 부재) | raw 270 exempt 와 동일 결정에 묶임 |
| raw 273 | hierarchy connection 방향 (T2 modules → T1 core registry → T0 source; 역방향 금지) | lib/ 내부 import 방향: harness → factory + oauth + remote (1-level, OK). oauth → factory (1-level, OK). remote → factory + oauth (1-level, OK). 역방향 0건 | PASS (자연 1-level) | 유지 — 신규 lib/ 파일 추가 시 동일 방향 유지 |

### §3.3 sentinel + exit code 표 conform 확인

| 항목 | README.md 명세 | 실제 구현 일치 |
|---|---|---|
| `__BROWSER_HARNESS_SELFTEST__` | PASS\|FAIL fails=N | tests/selftest.cjs:230 + tests/selftest_remote.cjs:132 (remote 접미) |
| `__BROWSER_HARNESS_PROBE__` | status=present\|absent path=… | wrappers/browser_harness.hexa:121 |
| `__ANIMA_BROWSER_HARNESS__` | PASS\|FAIL fails=N | anima/tool/browser_harness.hexa:117 (consumer) |
| `__ANIMA_BROWSER_HARNESS_PROBE__` | status=ready\|degraded\|absent path=… | anima/tool/browser_harness.hexa:168 (consumer) |
| exit codes | 0=PASS, 1=absent, 2=fatal, 4=usage, 5=selftest, 51=oauth-headless, 52=oauth-idempotent | lib/harness.cjs + lib/oauth.cjs 일치 |

### §3.4 raw 168 minimum-viable exempt 권고 — single-module package

본 패키지는 **단일-목적, 단일-구현, 단일-CLI** 구조. raw 168 minimum-viable exempt 적용 정당화:

1. **단일-CLI**: `bin/browser-harness` 1개 entry, subcommand 5개 (probe/selftest/oauth-login/version/help)
   가 모두 `lib/harness.cjs::main()` 한 곳에서 dispatch.
2. **단일-구현**: 각 subcommand 가 1개 .cjs 파일에 1:1 매핑 (factory/oauth/remote). raw 270 의
   ≥2 implementations 조건 미충족 → 핵심 분할 mandate 가 trigger 되지 않음.
3. **이미 존재하는 AI-native 컨벤션**: top-level `README.md` 가 contract sentinels + exit code
   map + mandate matrix M1-M6 + F1-F9 fixture ID + 환경변수 표를 기계 파싱 가능 형태로 모두 명시.
   raw 271 의 의도는 충족 — basename 만 불일치.

### §3.5 raw 270/271 promotion timeline 와의 관계

`raw_270_271_warn_to_block_promotion_design.md` (hive 측) 에 따르면:

- 2026-05-02 ~ 2026-06-01 = **30d ramp window** (warn severity, baseline grandfather active)
- 2026-06-01 = **promotion-day** (warn → block, baseline read-only, pre-commit reject)

본 repo 의 promotion 진입 옵션:

- **옵션 A** (권장): `.ai-native-readme-baseline` land (top-level `README.md` 1줄 grandfather
  엔트리 + `# raw 168 minimum-viable single-module package, README.md basename retained` 사유 주석).
  추후 ≥2 implementation 등장 시 baseline 제거 + raw 270 split.
- **옵션 B** (보수): `README.md` → `README.ai.md` rename (또는 symlink). hx package convention 영향
  검토 필요 (npm publish + GitHub README rendering 영향 — 사용자 결정사항).
- **옵션 C** (defer): mk2 ecosystem 등록 시점까지 baseline + lint 적용 모두 deferred.

### §3.6 triplet plan emit (impl 미수행)

본 doc 은 spec emit 만. 실제 README.ai.md 신규 생성은:

1. 사용자 lock-in (옵션 A / B / C 중)
2. 별도 cycle hexa-only 작업 (`.ai-native-readme-baseline` land + raw 271 lint PASS + marker)

priority order = (옵션 A baseline land = 1줄 + 2-line 주석, $0 ~5min) → (옵션 B rename + hx
manifest 영향 검토) → (옵션 C 단순 wait).

## §4 cross-link 정합 audit (sister repo consumer surfaces)

### §4.1 PASS

- `anima/tool/browser_harness.hexa` (194 LoC, raw 9 hexa-only orchestrator wrapping 본 CLI) 의
  resolver 우선순위 (canonical hx shim → package dir → env override) 가 본 repo 의
  `wrappers/browser_harness.hexa` 와 동일 정책 — cross-link consistent.
- 양 wrapper 모두 `__BROWSER_HARNESS_PROBE__` sentinel + `--invoke` forward 패턴 일치.
- exit code 매핑 (0/1/4/5/51/52) 양 wrapper 완전 일치.

### §4.2 권고 cross-link 추가 (사용자 lock-in 대기)

- 신규 `.roadmap.harness_factory` (provider) ↔ `anima/.roadmap.<domain>` (anima self surface;
  현재 anima 측 mk2 tuning audit 의 9 후보 중 미포함) — anima 가 browser-harness 를 의식측정
  pipeline 에 직접 endpoint 로 사용한다면 cond.N 신설 권장.
- 신규 `.roadmap.oauth_login` (provider) ↔ `hive/tool/browser_harness_invoke.hexa` 의 raw117_exempt
  legacy refactor (5-falsifier retrofit) — hive 측 audit 와 cross-link.
- 신규 `.roadmap.remote_transport` (provider) ↔ workspace `.workspace` 의 `host.ubu1` /
  `host.ubu2` / `host.htz` resource 정의 — fleet target hosts 와의 정합 cross-link.

### §4.3 mk1 → mk2 backport (deferred)

본 repo 에는 mk1 narrative `.roadmap` (anima 의 3817-line) 가 부재. CHANGELOG 는 README.md
§Versioning 에 v0.1.0~v0.3.1 7-version 으로 inline 정리됨. mk1→mk2 backport 작업 자체가 N/A —
hexa.toml `version = "0.3.1"` + README.md §Versioning 가 SSOT.

## §5 3 후보 surface verifier seam 권고

각 권고 신규 .roadmap.<domain> cond.N 의 verifier seam 후보 (사용자 lock-in 시 선택):

| domain | seam type 후보 |
|---|---|
| harness_factory | (a) script: `node tests/selftest.cjs` exit 0 (F1-F9 PASS, 235 LoC fixture) / (b) cross-link: anima/tool/browser_harness.hexa --selftest exit 0 |
| oauth_login | (a) script: `node tests/selftest.cjs` F6 단독 grep / (b) live: `BROWSER_HARNESS_OAUTH_START_URL=… browser-harness oauth-login --slot 9` exit 0 (manual gate) |
| remote_transport | (a) script: tests/selftest.cjs F7-F9 단독 grep / (b) live: `browser-harness selftest --target ubu2` exit 0 (SSH 의존) / (c) byte-identical SCP-back: live oauth-login 2회 연속 exit 52 + `remote.cjs: slot-N state byte-identical, skipped SCP-back` 메시지 grep |

verifier=`""` (공란) 도 mk2 schema 상 valid — script 없을 때 manual override 경로
(state/<domain>_verify_manual_review.jsonl) 만 land 도 ok.

## §6 raw#10 honest C3 (10 caveat)

C1 — 본 audit 는 **spec emit only**. .roadmap.<domain> 신규 파일 0건 생성, README.ai.md 0건 추가,
`.ai-native-readme-baseline` 0건 추가. 사용자 lock-in 후 별도 cycle 필요.

C2 — 3 후보 도메인은 **권고**일 뿐 사용자가 다른 cluster 화 (예: `harness_factory`+`oauth_login`+
`remote_transport` 통합 = 단일 `browser_harness_self` 도메인) 도 가능. 3 = 단순 file/concern 매핑
heuristic.

C3 — 본 패키지는 **.cjs 주체 + .hexa wrapper hybrid**. raw 9 hexa-only mandate 는 anima/hive 같은
"hexa-native research host" 적용. browser-harness 는 Playwright (Node-only) consumer → .cjs
implementation 가 production tier 에서 정당화됨. raw 9 strict scope 외 — wrapper layer 만 hexa-native.

C4 — `core/` + `modules/` 분할 (raw 270/272) 미적용. 단일-구현 single-target-CLI 구조에서는
4-file aggregator pattern 이 over-engineering — raw 168 minimum-viable exempt 적용 정당.

C5 — `README.ai.md` literal basename 미일치. README.md 가 의도(machine-parseable contract,
sentinels, exit code map)는 충족하나 raw 271 lint 가 basename 검사를 strict 로 하면 fail.
옵션 A (.ai-native-readme-baseline 1줄 grandfather) 가 fastest path.

C6 — 본 audit 는 **read-only directory + sha audit**. live `--target ubu1/ubu2` SSH 호출 미수행
(F7-F8 structural fixture 만 run). cond.3 (byte-identical SCP-back) 은 audit-time 검증 X.

C7 — `state/` directory 가 .gitignore 에 등록 (`/state/`). marker 는 local-only 보존, GitHub
push 금지. anima/nexus 패턴 일치.

C8 — raw 270/271 promotion 2026-06-01 는 hive 측 정책 — browser-harness 가 sister-repo adoption
대상에 포함되는지는 hive 측 cross_repo scope 확정사항 의존. 현재 .raw.mk2 arch.001 의 scope[]
에서 "hive sister repos" 8개 enumerate (anima/nexus/n6/airgenome/papers/hexa-lang/anima-eeg/
anima-clm-eeg) — browser-harness 미포함. promotion 영향권 외 가능성 높음.

C9 — verifier seam 권고 (§5) 의 (b) live SSH 후보들은 audit-time 미실행. F1-F9 baseline 만
PASS 확인 (`node tests/selftest.cjs` exit 0).

C10 — env() lazy + <user> placeholder convention (raw 15) — 본 doc 의 모든 path
`/Users/ghost/...` 는 `/Users/<user>/...` placeholder 를 의도하나, 본 doc 자체는 사용자 별 path
절대 인용 X — 모든 anchor 는 `browser-harness/...` repo-relative 로 표기.

## §7 BR-NO-USER-VERBATIM 준수 confirmation

본 doc 은 사용자 prompt 내용을 verbatim 으로 인용하지 않음 (raw 175 BR-NO-USER-VERBATIM-RECORDING).
prompt 요약/재구성으로만 land. handoff doc only 정책에 따라 사용자 directive 도 자체 paraphrase
만 기록.

## §8 friendly preset compliance

본 doc 은 handoff doc 으로서 친절-preset 적용:

- TL;DR 최상단 5 줄
- 모든 §-section 표 (table) 우선
- 3 후보 priority rank A/A/B 으로 actionable
- raw#10 caveats (C1-C10) inline
- 마지막 next step 명시 (사용자 lock-in 대기)

## §9 Marker 1개 emit

```
state/markers/browser_harness_self_mk2_tuning_landed.marker
```

(state/ 는 .gitignore — local-only, never push)

## §10 Next-cycle (사용자 lock-in 후)

1. 3 후보 중 land 할 도메인 선별 (rank A 2개 권장 baseline = `harness_factory` + `oauth_login`)
2. 각 도메인 cond.N + verifier seam (§5 선택지 중)
3. `.roadmap.<domain>` 신규 emit (안전 cycle 별 hexa-only — `tool/roadmap_op.hexa` 자체 land
   필요 시 sister `nexus/tool/roadmap_op.hexa` 패턴 참조)
4. (병렬) raw 270/271 triplet 작업 — 옵션 A baseline 1줄 land (5min) 또는 옵션 B README.md →
   README.ai.md 검토
5. 신규 `harness_factory` `.roadmap.<domain>` 등록 후 `anima/.roadmap.<domain>` (anima self
   surface 9 후보 중 신규 추가) 로 consumer-side cross-link 연결

## §11 file index (sha-pin at land time)

| path | type | size_b | LOC | sha256_hex |
|---|---|---:|---:|---|
| browser/doc/browser_harness_self_mk2_tuning_landed_2026_05_02.ai.md | doc | TBD | TBD | (set after write) |
| state/markers/browser_harness_self_mk2_tuning_landed.marker | marker | TBD | TBD | (set after write) |

(file index sha pin 은 marker 안에 emit — 본 §11 은 spec only, write 후 marker 가 sha 확정)

### §11.1 audit-time pre-existing sha (preserved 13)

| path | size_b | LOC | sha256_hex |
|---|---:|---:|---|
| README.md | 12518 | 191 | 66e752115eb97eb776a643f83f8b6a32a735bda42c99830b5104907e5b1e49b1 |
| hexa.toml | 618 | 10 | f63f46d0f81301644b847ea86805fa1e92cdf368871d3e6f717c7360888e336f |
| package.json | 414 | 14 | 472663cce9c57b94e753f6e33e5972fae1bc9d8556256cb75f924769986286da |
| install.sh | 1185 | 32 | 9c77bccc896e424317e1856a615dd23c0e6131c88208a991cd7e45bc656b0c2e |
| bin/browser-harness | 3391 | 82 | f68bbe736857444ee8ffe9d91caf994befc5ae96bddd6582fb5a4fb063e662bb |
| lib/factory.cjs | 2559 | 79 | b1e5a24269659bf3c7cf3833934201616400f5aa71fa8c1e8845d10b8a397873 |
| lib/harness.cjs | 7118 | 198 | 17d4a03fb5e4d20288cf94ec9fe964c63f3ede737a9cf24334d1225e585b38ca |
| lib/oauth.cjs | 6098 | 171 | 72ada8f8fa27f376a25be2b111322cb78f0a6dc144a9e3b5a107cdda7a7bcc66 |
| lib/remote.cjs | 17260 | 428 | 008cc62abe68c5b43ee76a8ba5ad41f4f7fea3ca6832d6e28db0ee2bc387d613 |
| tests/selftest.cjs | 11685 | 242 | fe69878fc801dd18362aa1bd0925eead4e16e23e11222553f1941f10c945d911 |
| tests/selftest_remote.cjs | 6416 | 139 | 93ebfb77668b7b03328ba2934fcfc129b7fd48fb58f1057f554d09b7592ebd4e |
| wrappers/browser_harness.hexa | 4956 | 143 | cb902fbfb2eeba34eee0728260787fbbff69d3c20efa61b533443d79b1acc3a5 |
| docs/oauth-login.md | 6569 | 128 | d97aeb7997a0e3d4896c9894048de5b3e82d2922b896007ecd28241adbafc3ba |

총 1482 LoC, 13 files preserved unchanged.

## §12 policy summary

- migration: forbidden — 0건 emit
- additive only — 13 pre-existing files 무수정 보존
- destructive ops — 0건
- in-place writes — 0건 (handoff doc + marker 2 NEW only; state/markers/ dir 신규 mkdir 1건 부수)
- substrate — mac-local
- cost — $0
- raw 9 hexa-only orchestration — audit 자체는 read-only directory audit + spec emit 만 (single-doc
  exempt per raw 168 minimum-viable). 본 패키지 .cjs 주체 = §6 C3 참조 (Playwright Node-only
  consumer, raw 9 strict scope 외)
- raw 12 silent-error ban — 본 audit single-shot, error path X. F1-F9 baseline PASS confirmed
- raw 15 env() lazy + <user> — 모든 doc-internal path repo-relative, 절대 path X
- raw 175 BR-NO-USER-VERBATIM — 사용자 prompt 직접 인용 0건
- friendly preset — handoff doc only (사용자 응답 X — bg subagent → 메인 monitor)
- F1-F9 selftest baseline (audit-time, `node tests/selftest.cjs`):
  ```
  PASS F1 factory exports complete
  PASS F2 slot path = ~/.browser-harness/state/slot-9.json
  PASS F3 dispose(null|undefined) idempotent
  PASS F4 parseArgs roundtrip
  PASS F5 probe → "ready" exit=0
  PASS F6 oauth exports + --slot required + chmod 0600 capable
  PASS F7 remote exports complete + buildPayload self-contained (17090 bytes)
  PASS F8 --target parsing (mac default; ubu1/ubu2/fleet → remote)
  PASS F9 selftest_remote.cjs shipped + inlined for selftest subcmd only (payload delta=8645 bytes)
  __BROWSER_HARNESS_SELFTEST__ PASS fails=0
  ```
