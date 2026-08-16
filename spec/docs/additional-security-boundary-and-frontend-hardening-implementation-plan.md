# 追加レビュー指摘 Security / Boundary / Frontend Hardening 実装計画

## 0. 文書情報

- Plan status: `proposed`
- Document created: 2026-08-16
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Planning baseline branch: `main`
- Planning baseline HEAD: `38cbc411078613b1062302e493beaf2db17281d1`
- Planning baseline worktree: dirty
- Implementation authorization: not started
- Related program: [Codebase Review Remediation Program](../.archived/codebase-review-remediation-program-index.md)

この文書は、追加レビュー33件を現行コードで再検証した結果から、実装根拠が成立した15件を
Terraが一件ずつ実装できるchange setへ落とした計画である。既存programの5計画は別レビューの
28件を対象としており、本書はそれらを上書きせず、依存関係だけを明示する。

計画作成時点のworktreeにはユーザー所有の未コミット変更がある。特に
`api/modules/nightworkers/run-orchestration/stop-task-run.ts`と
`tests/worker-tools/services-worker-tools-06.test.ts`は本書の後続ticketとwrite setが重なる。
Terraは`ADD-T0`でaccepted baselineを確定するまで、これらを変更してはならない。

## 1. 結論と対象範囲

### 1.1 実装対象

| Finding | 判定 | 優先度 | 実装ticket | 採用する修正核 |
| --- | --- | --- | --- | --- |
| `SEC-1` | 条件付き妥当 | P1 | `SEC-T4` | clone sourceをprotocol/source policyで検証し、許可されていないlocal pathを拒否する |
| `SEC-2` | 妥当 | P1 | `SEC-T1` | API、Supervisor、LLM、Pinoの全log sinkでsecretを保存前にredactする |
| `SEC-6` | 妥当 | P2 | `SEC-T2` | `/api/*`へroute共通body上限を追加する |
| `SEC-8` | 妥当 | P2 | `SEC-T3` | WebSocket接続後の受信message rateを接続単位で制限する |
| `MOD-1` | 条件付き妥当 | P1 | `ARC-T1`〜`ARC-T5` | 確認済みrole逆依存を解消し、再発をarchitecture guardで止める |
| `MOD-5` | 妥当 | P1 | `ARC-T1`〜`ARC-T5` | `api/services`からCoding Agent role moduleへのtype/value/dynamic importを0件にする |
| `FE-1` | 妥当 | P1 | `FE-T1` | chat送信失敗時に、その送信で追加したoptimistic messageだけをrollbackする |
| `FE-5` | 妥当 | P1 | `FE-T2`, `FE-T3` | realtime buffer/streamをboundedにし、activity初期取得をpage化する |
| `FE-6` | 妥当 | P2 | `FE-T4` | routeに不要なsession queryとWebSocket接続を起動しない |
| `FE-7` | 妥当 | P2 | `FE-T5` | Run/Task lifecycle predicateを意味別の共通contractへ集約する |
| `FE-9` | 妥当 | P3 | `FE-T6` | Composer draft保存をdebounceし、成功時の古いtimer再書込を防ぐ |
| `FE-10` | 妥当 | P2 | `FE-T7` | ThreadTimelineの全件結合・全件sort後sliceをwindow-firstへ変更する |
| `FE-11` | 妥当 | P2 | `FE-T8` | realtime delta dedupeの全clearをbounded LRUへ置換する |
| `FE-12` | 妥当 | P3 | `FE-T9` | `resolveNextActiveSessionId`の重複定義を1箇所へ統合する |
| `FE-13` | 妥当 | P2 | `FE-T10` | Mission Pilot command失敗時に競合安全なoptimistic rollbackを行う |

Criticalとして扱う項目はない。P1は通常releaseより先に解消するが、既存programのP0 ticketを
追い越してはならない。

### 1.2 指摘文をそのまま採用しない補正

1. `SEC-1`の`ext::`即時RCEという説明は現行Git既定値では再現しなかった。一方、
   `clone_git_repo`がsource種別を検証せず、許可外のlocal repository pathをcloneできること、
   および専用のbounded Git runnerを使っていないことは実在する。したがってsource policyだけを採用する。
2. `MOD-1`のcycle path件数は診断値であり、0件化を完了条件にしない。現行依存に存在する
   `api/services -> api/modules/codingAgent`の逆向きedgeを0件にし、そのedgeを再作成できないことを
   architecture testで保証する。
3. `FE-7`はstatusの意味を一つの`isActive`へ潰さない。実行中、停止可能、terminal、Task処理中を
   別predicateとして定義し、現行挙動を維持する。
4. `FE-5`のactivity historyは「全履歴を自動取得し続ける」状態を解消する。利用者が明示的に
   「さらに読み込む」を実行した履歴まで無条件に捨てることは目的にしない。

`MOD-5`のplanning baseline inventoryは次の8 fileである。Terraは`ADD-T0`で再検索し、増減があれば
`ARC-T1`〜`ARC-T4`のwrite setを実装前に更新する。

| 現行source | Import種別 | 解消ticket |
| --- | --- | --- |
| `api/services/conversation-context/state-card-projection.ts` | type import | `ARC-T1` |
| `api/services/runner/types.ts` | type import | `ARC-T1` |
| `api/services/tool-policy/types.ts` | type import | `ARC-T1` |
| `api/services/worker-tools/dispatcher.ts` | type + dynamic value import | `ARC-T1`, `ARC-T2` |
| `api/services/worker-tools/run-check.ts` | value import | `ARC-T2` |
| `api/services/worker-tools/completion-check.ts` | value import | `ARC-T2` |
| `api/services/execution/worker-process-manager.ts` | dynamic value import | `ARC-T3` |
| `api/services/supervisor/prompt-tool-registry.ts` | value import | `ARC-T4` |

### 1.3 対象外と禁止する便乗変更

以下は今回の実装根拠にしない。

| Finding群 | 扱い | 禁止する便乗変更 |
| --- | --- | --- |
| `SEC-3` | 容易なOpenAI key流出chainは不成立。hook `allowedEnv`の強化は別計画 | loopback endpointやlocal providerを一律禁止しない |
| `SEC-4`, `SEC-5`, `SEC-9` | exploit chain不成立 | MCP CSRF対策、external write path全面変更、任意MCP serverへの一律egress denyを本書へ追加しない |
| `SEC-7` | non-production E2E bypassとして限定済み | production挙動を変える根拠にしない |
| `MOD-2`, `MOD-3`, `MOD-4`, `MOD-7`, `MOD-9`, `MOD-10` | 一部tech debtはあるが本指摘の一括修正は過大 | DB全面repository化、shared移動、命名一括変更、barrel一括削除を行わない |
| `MOD-6`, `MOD-8` | 現行ownershipで不成立 | pure domain logicや`agentsShare`を指摘だけで移動しない |
| `FE-2` | `verifying`はschema上存在するがproduction writer未確認 | producerなしでstatus遷移やUI lockへ`verifying`を追加しない |
| `FE-3` | eventごとのinvalidateは実在するが原因・修正案が不十分 | `staleTime`追加だけで完了扱いしない |
| `FE-4` | route-level error handlingが存在する | 緊急のErrorBoundary追加を本計画へ混ぜない |
| `FE-8` | typed router改善余地はある | 全route loader化や不要なloader新設を行わない |

## 2. 既存計画との依存関係

| 本書ticket | 先行または調整対象 | 固定ルール |
| --- | --- | --- |
| `SEC-T2` | 既存`E-T1`の一般REST error envelope | `E-T1`完了済みならそのfactoryを使う。未完なら`E-T1`を先に実行し、別形式の413 payloadを作らない |
| `SEC-T4` | 既存`A-T5`のbounded Git runner | runnerを二重実装しない。どちらを先に行う場合も最終ownerを`api/services/execution`にする |
| `ARC-T2`〜`ARC-T4` | 既存`C-T2`, `C-T3`のCoding Agent host port/composition | `api/composition/coding-agent`が未作成なら`C-T2`, `C-T3`を先に完了する |
| `FE-T4` | 既存`D-T0`, `D-T1`のrepository/settings Query化 | canonical query keyとsettings query optionsを再定義しない。`enabled` optionだけを公開contractへ追加する |
| `FE-T5` | 既存Area BのRun transition変更 | transition semanticsは変更せず、公開status集合の参照へ置換するだけにする |

先行ticketの実装が本書の前提と異なる場合は、adapterや互換層を推測で追加しない。本書を更新して
write setとownershipを再確定する。

## 3. 共通不変条件

1. ユーザー文言やerror messageをregex/keywordで意味分類しない。URL scheme、path containment、status、
   schema、byte数などの構造的不変条件だけをhostで判定する。
2. Git、log、WebSocket、RESTの失敗はtyped codeを持ち、成功payloadへ偽装しない。
3. Logging redactionは保存・console出力・truncationより前に行う。redaction前の本文を別fieldへ残さない。
4. clone targetは常に登録Project root内に置く。local sourceだけが明示的な
   `externalAllowedPaths`を利用でき、target許可へ転用しない。
5. `api/services`はrole非依存であり、Coding Agentのroute、service、repository、runtime、public indexを
   static/type/dynamic importしない。
6. Coding Agent固有tool orchestrationは`api/modules/codingAgent`が所有し、agent非依存の実行primitiveだけを
   `api/services`から利用する。
7. optimistic rollbackは自分が書いたcache object/idだけを戻す。後着のserver/realtime stateを巻き戻さない。
8. realtime処理は、利用者操作なしに時間経過だけで増え続けるmemoryを持たない。
9. route URLにsession idがない画面で、暗黙に最初のTaskを選択してsession detailを取得しない。
10. status predicateの集約は挙動維持refactorである。producer、transition、Composer lock条件を追加しない。
11. 各ticketはred test、production変更、限定test、typecheck/architectureの順に実施する。
12. ticketのwrite setと既存dirty fileが重なる場合、accepted baseline確定まで停止する。

## 4. 推奨実装順

| 順序 | Ticket | 理由 |
| ---: | --- | --- |
| 0 | `ADD-T0` | dirty worktree、先行計画、対象symbolの現状を固定する |
| 1 | `SEC-T1` | 全後続ticketの診断logへsecretを残さない |
| 2 | `SEC-T2`, `SEC-T3` | 独立したrequest resource境界を小さい差分で閉じる |
| 3 | `SEC-T4` | 既存`A-T5`のGit runner contract確定後にsource policyを実装する |
| 4 | `ARC-T1` | role非依存type/schemaを先に提供する |
| 5 | `ARC-T2`, `ARC-T3`, `ARC-T4` | role固有tool、worker exit、tool schemaの順に逆依存を除去する |
| 6 | `ARC-T5` | 全移行後にexemptionを削除し、再発guardを有効化する |
| 7 | `FE-T1`, `FE-T10` | cache rollback規約を先に固定する |
| 8 | `FE-T8`, `FE-T2` | dedupeとlocal realtime memoryをboundedにする |
| 9 | `FE-T3` | API page contractとFrontend cacheを同じchange setで移行する |
| 10 | `FE-T4`, `FE-T5`, `FE-T9` | route/query、status、helper重複を挙動維持で整理する |
| 11 | `FE-T6`, `FE-T7` | Composer IOとTimeline計算量を個別に最適化する |
| 12 | `ADD-T99` | 全限定test成功後に統合gateを直列実行する |

`SEC-T2`と`SEC-T3`、`FE-T1`と`FE-T10`はwrite setが重ならない場合だけ並行可能である。
それ以外は表の順で行う。

## 5. Terra共通実行プロトコル

各ticketを一件ずつTerraへ渡し、次を省略しない。

1. `git rev-parse HEAD`と`git status --short`を保存する。
2. ticketのwrite setに未コミット差分があれば、そのfileを変更せず停止し、重複fileを報告する。
3. ticketに記載したproduction symbolと近接testを読み、既に解消済みなら実装せず、根拠とtest結果を報告する。
4. 最初にred testを追加し、production変更前に想定理由で失敗することを確認する。
5. write set外が必要になった場合、現在ticketを拡張せずplan amendmentを作る。
6. production変更後、ticket限定test、`bun run typecheck`、必要なarchitecture checkを実行する。
7. `git diff --check`、`git diff --stat`、対象findingの`rg`監査を行う。
8. 変更file、red/green結果、未検証事項、既存差分との関係を報告する。
9. acceptanceを一つでも満たせない場合は`完了`と報告しない。

## 6. 実装ticket台帳

### ADD-T0: accepted baselineと競合を固定する

- Findings: 全件
- Priority: P0 preparation
- Write set: production codeなし。実装branchの作業記録だけ
- Read set: 本書の全write set、関連既存計画、`package.json`

#### 実行

1. 次を記録する。

   ```bash
   git rev-parse HEAD
   git status --short --branch
   git diff --name-only
   bun run check:architecture
   bun run typecheck
   ```

2. `stop-task-run.ts`、`services-worker-tools-06.test.ts`、既存5計画書の未コミット差分について、
   本実装へ含めるaccepted baselineか、別作業の未完了差分かを区別する。
3. `node_modules/.bin/madge`は計画時点で存在しない。network installをbaseline条件にせず、
   cycle件数はレビュー時診断値としてだけ保存する。
4. 後述する各`rg`監査を実行し、現行件数をticket報告へ添付する。

#### Done

- 各ticketの競合fileと先行ticket状態が分かる。
- baseline failureを本実装のregressionとして誤認しない。

#### Stop condition

- write setに未確定のユーザー差分がある。
- 先行ticketが同じcontractを別ownerへ実装している。

---

### SEC-T1: 全runtime log sinkのsecret redaction

- Finding: `SEC-2`
- Priority: P1
- Depends on: `ADD-T0`
- Production write set:
  - `api/services/security/secret-redaction.ts`
  - `api/lib/logger.ts`
  - `api/routes/settings-runtime.ts`
  - `api/modules/securityScan/security-scan-settings.service.ts`
- Test write set:
  - `tests/middleware.logger.test.ts`
  - 新規`tests/logger-secret-redaction.test.ts`

#### Red test

fixture secretをprocess env、LLM top-level key、provider endpoint `apiKey`、Security Scan tokenへ設定し、
以下の出力にraw値、URL encode値、base64値が残ることをproduction変更前に確認する。

- `logHttpEvent`の`message`とnested `meta`
- `logEvent`の`message`とnested `meta`
- `appendSupervisorTrace`のevent/payload
- `appendLlmTrace`の`systemPrompt`、`userPrompt`、`rawContent`、`providerDebug`
- `llmLogger.info()`/`logger.error()`へ渡すstring/object/Error

testは実在credentialを使わず、`nw_test_secret_...`形式のfixtureだけを使う。

#### Contract

1. `secret-redaction.ts`へsource別runtime secret registryを追加する。
   - `replaceRuntimeSecretValues(sourceId, values)`は当該sourceのsnapshotを置換する。
   - 空値と6文字未満は保持しない。
   - getterは値そのものを外部へ公開せず、`redactRuntimeSecretText`と
     `redactRuntimeSecretRecord`だけを公開する。
2. runtime redactionは次をsecret value集合へ含める。
   - `isSecretEnvironmentKey`または`isRegistryCredentialEnvironmentKey`に一致するprocess env値
   - `SECRET_SETTING_KEYS`の値
   - `providerEndpoints[*].apiKey`
   - Security Scan provider token
3. `settings-runtime.ts`はsettings読込・保存・process env反映時に`llm-settings` sourceを置換する。
4. Security Scan settings serviceは読込・保存時に`security-scan` sourceを置換する。
5. registryはlog出力、error、diagnosticへsecret件数以外を公開しない。test reset APIは
   `NODE_ENV=test`でもproductionと同じ処理を通せるよう、source置換で空配列を渡して行う。

#### Production実装

1. `logHttpEvent`/`logEvent`はchannel、method、path、message、metaをredactしてから`inlineMeta`へ渡す。
2. `appendSupervisorTrace`はeventとpayloadをredactしてからJSON化する。
3. `appendLlmTrace`はevent/payloadをredactしてからbyte計測・field truncation・全体上限を適用する。
4. Pinoは`hooks.logMethod`または同等の一つの入口でstring/object/Errorをsanitiseし、
   direct callerを迂回させない。`logger` aliasも同じinstanceを参照する。
5. Errorは非enumerableな`name`、`message`、`stack`、`cause`を明示的なrecordへ写してからredactする。
6. cyclic objectは例外にせず`[REDACTED]`または明示的なcircular markerへ変換する。
7. secret valueをredaction前の`original*` fieldへ保持しない。byte数だけは保持してよい。

#### Acceptance

- 全sinkでraw/URL encoded/base64 fixture secretが0件。
- `authorization`、`cookie`、`apiKey`等のkey値が`[REDACTED]`になる。
- ordinary message、timestamp、level、request id、provider名は保持される。
- redaction後のLLM traceが既存2 MiB上限を超えない。
- `rg -n "console\.(log|warn|error)" api`の既存直接出力はinventoryだけ行い、本ticketで無関係な
  console呼び出しを全面移行しない。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/middleware.logger.test.ts tests/logger-secret-redaction.test.ts
bun run typecheck
```

---

### SEC-T2: `/api/*`共通request body limit

- Finding: `SEC-6`
- Priority: P2
- Depends on: `ADD-T0`, 既存`E-T1`
- Production write set:
  - 新規`api/security/nightworkers-request-policy.ts`
  - `api/app.ts`
- Test write set:
  - `tests/hono-security-regressions.test.ts`
  - `tests/routes.security-hardening.test.ts`

#### Red test

1. `Content-Length`付き33 MiB JSONがroute handlerへ到達する現行failureを固定する。
2. Content-Lengthなしのchunked bodyが32 MiBを超えた場合もhandlerへ到達する現行failureを固定する。
3. 5画像の最大request相当payloadが上限未満で受理されるpositive caseを追加する。

#### Contract

- `NIGHTWORKERS_API_MAX_BODY_BYTES = 32 * 1024 * 1024`を共通定数とする。
- 根拠は`PROMPT_IMAGE_MAX_COUNT=5`、各`dataUrl`最大5,100,000文字にJSON overheadを加えても
  32 MiB未満であること。route個別のより小さい上限は維持する。
- 超過responseはHTTP 413、code `REQUEST_BODY_TOO_LARGE`。一般REST error envelopeは既存`E-T1`の
  factoryだけを使う。

#### Production実装

1. Hono `bodyLimit`を`/api/*`へ、API rate limiterの後、CSRFとroute登録の前に適用する。
2. `/mcp/nightworkers`とWebSocket upgradeは対象外にする。
3. Content-Lengthとstreamed byte countの双方で上限を強制する。
4. Security Scanの64 KiB個別limitを削除・緩和しない。
5. bodyを読まないGET/HEADの挙動とresponse streamingへ影響させない。

#### Acceptance

- 32 MiB以下はrouteへ到達し、超過はroute handler実行前に413になる。
- Content-Length偽装または欠落でもstream上限を超えられない。
- WebSocket upgrade、MCP endpoint、Security Scan個別上限の既存testが成功する。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/hono-security-regressions.test.ts tests/routes.security-hardening.test.ts
bun run typecheck
```

---

### SEC-T3: WebSocket接続単位の受信rate limit

- Finding: `SEC-8`
- Priority: P2
- Depends on: `ADD-T0`
- Production write set:
  - `api/security/nightworkers-websocket-policy.ts`
  - `api/app.ts`
- Test write set:
  - `tests/websocket-security.test.ts`
  - `tests/rate-limiter.test.ts`

#### Red test

- 同一connectionから60秒内に121 messageを送り、全messageがparse/dispatchされる現行failureを固定する。
- 2 connectionが相互のquotaを消費しないpositive caseを追加する。
- malformed JSONとbinary/oversize messageでもrate counterの順序が一定であることをtest化する。

#### Contract

- `NIGHTWORKERS_WS_MESSAGE_RATE_WINDOW_MS = 60_000`
- `NIGHTWORKERS_WS_MESSAGE_RATE_LIMIT = 120`
- error code: `WEBSOCKET_RATE_LIMIT_EXCEEDED`
- close code: `1008`
- counter単位: WebSocket connection。upgrade時IP limiterとは別物とする。
- counter時点: text/binaryを問わず`onMessage`到着直後。byte上限検査、JSON parse、command実行より前。

#### Production実装

1. `nightworkers-websocket-policy.ts`へclock注入可能なfixed-window limiter factoryを追加する。
2. `upgradeWebSocket` callbackごとにlimiter instanceを一つ作る。
3. quota超過時は可能なら一度だけtyped error frameを送り、`1008`でcloseし、そのmessageを
   parse、subscribe、command dispatchへ渡さない。
4. close/error時にtimerやlistenerを残さない。limiterがlazy timestampだけならtimerを作らない。
5. non-production `x-nightworkers-e2e` headerは接続後message quotaをbypassしない。

#### Acceptance

- 120件までは受理、121件目はdispatchされずcloseされる。
- connection Aの121件目がconnection Bをcloseしない。
- fake clockでwindow境界の直前/直後を決定的に検証できる。
- 既存128 KiB上限、origin、upgrade rate limitが維持される。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/websocket-security.test.ts tests/rate-limiter.test.ts
bun run typecheck
```

---

### SEC-T4: clone source policyと共通bounded Git runner

- Finding: `SEC-1`
- Priority: P1
- Depends on: `ADD-T0`, 既存`A-T5`
- Production write set:
  - `api/services/execution/git-command-runner.ts`（`A-T5`で既に作成済みなら再作成しない）
  - 新規`api/services/worker-tools/git-source-policy.ts`
  - `api/services/worker-tools/clone-git-repo.ts`
  - `api/services/worker-tools/import-project.ts`
  - `api/services/worker-tools/dispatcher.ts`
- Test write set:
  - `tests/worker-tools/services-worker-tools-01.test.ts`
  - `tests/worker-tool-dispatcher-extra-coverage.test.ts`
  - 新規`tests/worker-tools/git-source-policy.test.ts`

#### Red test

production変更前に次を固定する。

- 許可外のabsolute local repository pathがcloneできてしまう。
- `file://` sourceが外部path許可なしでcloneできる。
- `http://`、`git://`、`ext::`、unknown scheme、URL userinfoがpolicyで拒否されずGitへ渡る。
- Git subprocessが共通runnerを通らない。

#### Source contract

`parseGitSource(input, context)`は次のdiscriminated resultだけを返す。

```ts
type AuthorizedGitSource =
  | { kind: "remote_https"; normalized: string; allowedProtocols: ["https"] }
  | { kind: "remote_ssh"; normalized: string; allowedProtocols: ["ssh"] }
  | { kind: "local"; canonicalPath: string; allowedProtocols: ["file"] };
```

1. remoteで許可するのは`https://`、`ssh://`、scp-like `user@host:path`のみ。
2. `http://`、`git://`、`file://`以外のunknown scheme、Git remote helper形式、`ext::`を拒否する。
3. HTTPS URLはuserinfoを拒否する。SSH URLは通常のusername（例:`ssh://git@host/path`）を許可するが、
   password部分を拒否する。scp-likeの`git@host:path`も許可する。
4. local sourceはabsolute path、`./`、`../`、`file://`だけをlocalとして扱う。曖昧なbare pathを
   remote/localへ推測しない。
5. local sourceをrealpathでcanonicalizeし、Project root内は既存path policy、Project root外は
   `externalAllowedPaths`で明示許可された場合だけ許可する。
6. clone targetは従来どおりProject root内限定とし、`externalAllowedPaths`をtarget判定へ渡さない。
7. `ref`はtrim後1〜1024文字、NUL/controlなし、先頭`-`なしを構造検証する。clone後に
   `git rev-parse --verify <ref>^{commit}`でcommitへ解決し、解決済みhashをdetached checkoutする。

#### Runner contract

1. `api/services/execution/git-command-runner.ts`をGit subprocessの唯一のagent非依存ownerにする。
2. shellを使わず`spawn`/`execFile`のargvで実行し、timeout、stdout/stderr各上限、AbortSignal、
   exit code/signalをtyped resultへする。
3. 全実行で`GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=Never`を設定する。
4. HTTPS sourceでは`GIT_ALLOW_PROTOCOL=https`、SSH sourceでは`GIT_ALLOW_PROTOCOL=ssh`、
   authorized local sourceでは`GIT_ALLOW_PROTOCOL=file`を設定する。一回の呼出しで複数protocolを許可しない。
5. timeout/overflow後にchild processを残さない。
6. command logはcredentialを含むsourceを受け入れず、`SEC-T1`のredactionを通す。

#### Production実装

1. `CloneGitRepoInput`と`ImportProjectInput`へ`externalAllowedPaths?: string[]`を追加する。
2. dispatcherは`safetyPolicy.externalAllowedPaths`をsource policyへ渡す。
3. `import_project`から`cloneGitRepoTool`へ同値を透過する。
4. 現在の`execFileAsync`/`runGit`を削除し、共通runnerをdependency injection可能にしてtestする。
5. source policy成功後にだけtemp dir作成、target clear、Git spawnを行う。
6. policy failure codeを`UNSUPPORTED_GIT_SOURCE`、local path拒否を`ACCESS_DENIED`、ref不正を
   `INVALID_GIT_REF`とする。

#### Acceptance

- `ext::`等はGit process起動前に拒否される。
- HTTPS/SSHは正しいprotocol envでrunnerへ渡る。
- local sourceは外部path許可なしで拒否、明示許可ありで成功する。
- overwrite時もsource policy failureではtarget内容を消さない。
- existing template registryのHTTPS importと許可済みlocal fixtureが成功する。
- `rg -n "execFileAsync\(\"git\"|spawn\(\"git\"" api/services/worker-tools/clone-git-repo.ts`が0件。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/worker-tools/services-worker-tools-01.test.ts tests/worker-tool-dispatcher-extra-coverage.test.ts tests/worker-tools/git-source-policy.test.ts
bun run typecheck
bun run check:architecture
```

---

### ARC-T1: role非依存type/schemaの正本化

- Findings: `MOD-1`, `MOD-5`
- Priority: P1
- Depends on: `ADD-T0`
- Production write set:
  - 新規`shared/schemas/nightworkers/safety-policy.schema.ts`
  - `shared/schemas/nightworkers/repository-task.schema.ts`
  - `api/modules/codingAgent/runtime/types.ts`
  - `api/services/tool-policy/types.ts`
  - `api/services/runner/types.ts`
  - `api/services/worker-tools/dispatcher.ts`
  - `api/services/conversation-context/state-card-projection.ts`
  - `api/modules/codingAgent/runtime/native-api-runner/native-api-mode.ts`
- Test write set:
  - `tests/role-module-boundary.test.ts`
  - `tests/services.conversation-state-card-projection.test.ts`
  - 新規`tests/safety-policy-contract.test.ts`

#### Red test

- `api/services`のtype-only importでも`api/modules/codingAgent`を参照したら失敗するfixtureを
  `role-module-boundary.test.ts`へ追加する。
- `safetyPolicySchema`の既存parse結果と新schemaが一致するcharacterizationを追加する。

#### Production実装

1. `safetyPolicySchema`を新しいshared fileへ移し、`AgentSafetyPolicy`を`z.infer`から導出する。
2. `repository-task.schema.ts`は互換re-exportしてよいが、定義を複製しない。
3. Coding Agent runtimeはshared typeをimport/re-exportし、service callerはshared typeを直接importする。
4. `NativeApiStateCardRole`はagent非依存のconversation projection contract名
   `StateCardProjectionRole`へ変更してservice側で所有する。Coding Agent側は既存import互換のtype aliasをre-exportする。
5. type-only importだから許容する例外を残さない。

#### Acceptance

- safety policyのruntime schemaとTypeScript typeが一つの正本から生成される。
- `api/services/{tool-policy,runner,worker-tools,conversation-context}`からCoding Agent importが0件。
- API/OpenAPIのSafetyPolicy shapeに互換差分がない。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/role-module-boundary.test.ts tests/task-git-workspace-schema.test.ts tests/services.conversation-state-card-projection.test.ts tests/safety-policy-contract.test.ts
bun run typecheck
```

---

### ARC-T2: Coding Agent固有worker toolをrole moduleへ戻す

- Findings: `MOD-1`, `MOD-5`
- Priority: P1
- Depends on: `ARC-T1`, 既存`C-T2`, `C-T3`
- Production write set:
  - 新規`api/services/worker-tools/role-tool-port.ts`
  - `api/services/worker-tools/dispatcher.ts`
  - `api/services/worker-tools/index.ts`
  - `api/services/worker-tools/run-check.ts`
  - `api/services/worker-tools/run-verification.ts`
  - `api/services/worker-tools/completion-check.ts`
  - 新規`api/modules/codingAgent/tools/coding-agent-worker-tools.ts`
  - 新規`api/modules/codingAgent/tools/run-check.tool.ts`
  - 新規`api/modules/codingAgent/tools/completion-check.tool.ts`
  - `api/modules/codingAgent/runtime/native-api-runner/native-api-tool-dispatcher.ts`
  - `api/modules/codingAgent/runtime/native-api-runner/native-api-context-still.ts`
  - `api/modules/codingAgent/mcp/nightworkers-codex-mcp.ts`
- Test write set:
  - `tests/worker-tool-dispatcher-extra-coverage.test.ts`
  - `tests/worker-tools/services-worker-tools-06.test.ts`
  - `tests/coding-agent-completion-check-tool.test.ts`
  - `tests/coding-agent-run-check-evidence-scope.test.ts`
  - `tests/run-check-runner.test.ts`
  - `tests/coding-agent-test-inventory-snapshot.test.ts`

#### Stop condition

`tests/worker-tools/services-worker-tools-06.test.ts`には計画時点で未コミット差分がある。
`ADD-T0`でaccepted baselineになっていない限り着手しない。

#### Red test

1. generic dispatcherをCoding Agent handlerなしで`completion_check`等へ呼ぶと、role moduleをdynamic importせず
   `ROLE_TOOL_UNAVAILABLE`を返すtestを追加する。
2. Coding Agent native/MCP pathではreal handlerが呼ばれるcharacterizationを追加する。
3. Review agentのgeneric `search_files`/`read_file`/`run_command`がhandlerなしで維持されることを固定する。

#### Port contract

```ts
interface WorkerRoleToolPort {
  runCheck(input: RoleRunCheckInput): Promise<WorkerToolResult<unknown>>;
  runVerification(input: RoleRunVerificationInput): Promise<WorkerToolResult<unknown>>;
  completionCheck(input: RoleCompletionCheckInput): Promise<WorkerToolResult<unknown>>;
  collectTestInventory(input: RoleInventoryInput): Promise<WorkerToolResult<unknown>>;
  recordTestConditionMapping(input: RoleMappingInput): Promise<WorkerToolResult<unknown>>;
}
```

- portはrole名やCoding Agent repository typeを持たず、worker toolの構造input/resultだけを持つ。
- generic dispatcherは`roleTools?: WorkerRoleToolPort`を受け、対象toolで未注入ならtyped failureを返す。
- Coding Agent role moduleがreal adapterを作り、native runnerとMCP compositionが注入する。

#### Production実装

1. 現`run-check.ts`からcommand実行、structured reporter、output parseなどのagent非依存primitiveだけを
   serviceに残す。
2. acceptance evidence、verification document、completion readiness、test inventory/mappingの意味判断を
   `api/modules/codingAgent/tools`へ移す。
3. `completion-check.ts`のdefault import/default dependencyを削除し、Coding Agent adapterが
   `runCompletionCheck`を直接呼ぶ。
4. dispatcherの`collect_test_inventory`、`record_test_condition_mapping` dynamic importを削除する。
5. `run_verification`もCoding Agent adapter経由にし、generic serviceがrole-specific evidenceを記録しない。
6. `api/services/worker-tools/index.ts`はagent非依存primitiveだけをexportする。role wrapperをserviceから
   compatibility re-exportせず、既存internal test/importをCoding Agent ownerへ移す。
7. external tool protocolのtool name、result shape、retryable flag、LLM summary文言を維持する。

#### Acceptance

- `api/services/worker-tools`からCoding Agent static/type/dynamic importが0件。
- native-api runnerとCodex MCPの5 toolが従来どおり成功する。
- Review agentはrole toolを取得せず、既存allowlistのgeneric toolだけを実行できる。
- role tool unavailableをgeneric command failureへ読み替えない。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/worker-tool-dispatcher-extra-coverage.test.ts tests/worker-tools/services-worker-tools-06.test.ts tests/coding-agent-completion-check-tool.test.ts tests/coding-agent-run-check-evidence-scope.test.ts tests/run-check-runner.test.ts tests/coding-agent-test-inventory-snapshot.test.ts tests/codex-nightworkers-mcp-setup.test.ts
bun run typecheck
```

---

### ARC-T3: worker exit reconciliationをcomposition eventへ反転する

- Findings: `MOD-1`, `MOD-5`
- Priority: P1
- Depends on: `ARC-T1`, 既存`C-T3`
- Production write set:
  - 新規`api/services/execution/worker-exit-events.ts`
  - `api/services/execution/worker-process-manager.ts`
  - `api/composition/coding-agent/coding-agent-host-adapter.ts`
  - `api/composition/coding-agent/index.ts`
  - `api/app.ts`
  - `api/server.ts`
- Test write set:
  - `tests/worker-process-isolation.test.ts`
  - 新規`tests/coding-agent-worker-exit-composition.test.ts`
  - `tests/role-module-boundary.test.ts`

#### Red test

- `worker-process-manager.ts`がchild exit時にCoding Agent public indexをdynamic importすることを
  architecture fixtureで失敗させる。
- fake child exitでlost run noticeが一回だけ発行されるcharacterizationを追加する。

#### Event contract

```ts
type WorkerExitNotice = {
  workerKind: "task-run-worker" | "queue-worker";
  ownerPid: number | null;
  lostRuns: Array<{ runId: string; ownerPid: number }>;
};
```

- serviceは`subscribeWorkerExit(listener): () => void`とpublishだけを所有する。
- event busは同期snapshot配信とし、listener Promise failureを個別logして他listenerを止めない。
- Coding Agent compositionがsubscribeし、`interruptCodingAgentRunsAfterWorkerExit`を呼ぶ。
- subscription登録はhost起動につき一回、test/host shutdownでdispose可能、二重登録はidempotentにする。

#### Production実装

1. `trackWorker`からCoding Agent dynamic importを削除し、lost runsをgeneric eventへpublishする。
2. composition adapterがCoding Agent application commandへ変換する。`api/server.ts`のserver生成時に
   subscriptionを一度登録し、`close()`でisolated worker shutdown後にdisposeする。
3. role command failure logはcomposition側で行い、run idとcodeだけを記録する。
4. worker process managerはCoding Agentのstatus、repository、runtimeを知らない。

#### Acceptance

- worker exit後のCoding Agent interruption behaviorが維持される。
- listenerが0件でもworker cleanupは例外にならない。
- 同一hostで二重初期化してもinterruption commandは一回だけ。
- `worker-process-manager.ts`に`codingAgent`文字列/importが0件。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/role-module-boundary.test.ts tests/worker-process-isolation.test.ts tests/coding-agent-worker-exit-composition.test.ts
bun run typecheck
```

---

### ARC-T4: 共通worker tool schema/descriptionの一元化

- Findings: `MOD-1`, `MOD-5`
- Priority: P2
- Depends on: `ARC-T1`
- Production write set:
  - 新規`shared/modules/workerTools/nightworkers-shared-tool-contracts.ts`
  - `shared/modules/codingAgent/todo-contract.ts`
  - `api/modules/codingAgent/tools/todo-list.ts`
  - `api/modules/codingAgent/mcp/nightworkers-tool-schemas.ts`
  - `api/modules/codingAgent/mcp/nightworkers-tool-manifest.ts`
  - `api/services/supervisor/prompt-tool-registry.ts`
- Test write set:
  - `tests/codex-nightworkers-mcp-setup.test.ts`
  - 新規`tests/supervisor-tool-registry-contract.test.ts`
  - `tests/role-module-boundary.test.ts`

#### Red test

- `read_current_specification`、`import_project`、`todo_list`のSupervisor/Codex schema snapshotが
  同じshared contractから生成されていない現状を固定する。
- `prompt-tool-registry.ts -> codingAgent/mcp` importをarchitecture testで失敗させる。

#### Production実装

1. 両roleで同じ意味を持つinput Zod schema、JSON Schema変換、description定数だけを
   `shared/modules/workerTools`へ移す。
2. `codingAgentTodoListCommandSchema`の構造定義はshared worker tool contractへ移し、
   `shared/modules/codingAgent/todo-contract.ts`は移行期間のtype/schema re-exportだけを持つ。
3. Coding Agent manifestとtodo toolはshared contractをimportし、外部互換が必要なsymbolだけをre-exportする。
4. Supervisor registryはshared contractを直接importする。
5. Coding Agent固有tool、route、repository、completion判断をsharedへ移さない。
6. Supervisorだけが除外する`todo_list operation=list`等のpresentation差分はshared schemaをcloneして
   構造的に絞り、元objectをmutateしない。

#### Acceptance

- 3 toolのfield、required、enum、descriptionが既存互換を保つ。
- `prompt-tool-registry.ts`からCoding Agent importが0件。
- shared moduleにrole判定、route、repository、runtime codeがない。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/codex-nightworkers-mcp-setup.test.ts tests/role-module-boundary.test.ts tests/supervisor-tool-registry-contract.test.ts
bun run typecheck
```

---

### ARC-T5: role逆依存guardと例外削除

- Findings: `MOD-1`, `MOD-5`
- Priority: P1
- Depends on: `ARC-T1`〜`ARC-T4`
- Production write set:
  - `scripts/check-module-boundaries.mjs`
  - `.agent-ontology/boundary-policy.json`
- Test write set:
  - `tests/role-module-boundary.test.ts`

#### Production実装

1. `api/services/**`から次へのstatic、type-only、dynamic importを禁止する。
   - `api/modules/codingAgent/**`
   - Coding Agent public index経由のre-export
2. `prompt-tool-registry`の既存exemptionを削除する。
3. import specifierをliteral文字列として解析し、source本文の単純substringだけで判定しない。
4. fixtureでrelative depth、index import、dynamic import、type-only importが全てfailすることを追加する。
5. Madgeを新規dependencyに追加しない。既存architecture checkerをCI gateの正本にする。

#### Acceptance

次の監査が0件で、architecture checkが成功する。

```bash
rg -n 'modules/codingAgent|modules/coding-agent' api/services -g '*.ts'
```

review時のcycle path数が減少したかは参考値として記録してよいが、無関係なFrontend cycleやtype-only
cycleを本ticketで一括修正しない。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/role-module-boundary.test.ts
bun run check:architecture
bun run typecheck
```

---

### FE-T1: chat optimistic messageの競合安全rollback

- Finding: `FE-1`
- Priority: P1
- Depends on: `ADD-T0`
- Production write set:
  - `src/modules/nightworkers/hooks/nightWorkersChatActions.ts`
- Test write set:
  - `tests/nightworkers-chat-actions.test.ts`

#### Red test

非2xx、network throw、AbortErrorで`optimistic-user-*`がcacheに残る現行failureを固定する。
失敗中に同内容のserver messageまたは別optimistic messageが到着するrace caseも追加する。

#### Production実装

1. `appendOptimisticUserMessage`の返値をbooleanから次へ変更する。

   ```ts
   type OptimisticChatAppend =
     | { appended: false }
     | { appended: true; message: TaskMessage; submitKey: string };
   ```

2. catchで`message.id`が一致する一件だけをfunctional `setQueryData`で除去する。
3. confirmed messageはcontentが同じでもidが異なるため除去しない。
4. failure時、`lastSubmitRef.current`がこの`submitKey`と一致する場合だけnullに戻し、即時retryを許可する。
5. success時はserver response/realtimeの既存optimistic置換を維持する。
6. AbortErrorも送信失敗としてoptimistic messageを除去する。Composer draftのabort挙動は本ticketで変えない。

#### Acceptance

- failed/aborted messageがtimelineへghostとして残らない。
- raceで到着したconfirmed messageや後続送信をrollbackしない。
- 同一promptの1500 ms duplicate suppressionは成功中だけ維持され、失敗後はretryできる。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/nightworkers-chat-actions.test.ts
bun run typecheck
```

---

### FE-T2: realtime local bufferとstream previewをboundedにする

- Finding: `FE-5`
- Priority: P1
- Depends on: `FE-T8`
- Production write set:
  - `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
  - `src/modules/nightworkers/hooks/useNightWorkersRealtime.ts`
  - `src/modules/nightworkers/realtime/nightWorkersRealtimeProjector.ts`
  - `src/modules/nightworkers/realtimeEvents.ts`
  - 新規`src/modules/nightworkers/realtime/realtime-buffer-policy.ts`
- Test write set:
  - `tests/nightworkers-realtime-effects.test.ts`
  - `tests/nightworkers.realtime-events.test.ts`
  - `tests/nightworkers-workspace-hook-extra-coverage.test.ts`

#### Policy constants

- `MAX_BUFFERED_RUN_EVENTS_PER_RUN = 500`
- `MAX_BUFFERED_RUNS = 2`
- `MAX_STREAMING_PREVIEW_CHARS = 256_000`
- `RUN_DETAILS_RECONCILE_INTERVAL_MS = 250`
- overflow marker: `\n…[stream preview truncated]…\n`

#### Red test

- 3 runへ各501 eventを投影して`bufferedEventsByRun`が増え続ける。
- REST `runDetails.events`へ永続化済みeventが到着してもbufferから除去されない。
- terminal update、task切替、errorでstreaming textが残る。
- assistant finalが来ないdelta列でstream textが無制限に増える。

#### Production実装

1. buffer追加時はevent id/seqでdedupeし、各runの最新500件だけを保持する。
2. active latest runが変わったら、新runと直前run以外のkeyを削除する。
3. `latestRunDetails.events`更新時、そのREST snapshotに含まれるid、またはsnapshot最大seq以下のbuffer eventを削除する。
4. 通常eventの`runDetails` invalidateはrun単位で250 msに一回へcoalesceする。seq gap、terminal、cap超過は
   待たず即時invalidateし、その後のpending timerをcancelする。
5. stream previewは末尾を優先して256,000文字へ切り詰め、markerを一度だけ付ける。
6. assistant/system completion、`task_run_updated` terminal、WebSocket error、explicit cancel、
   active task変更で該当streamを削除する。
7. active task変更時は旧taskのbuffer/streamを全削除する。reconnectだけでは削除しない。

#### Acceptance

- 利用者操作なしの長時間実行でrun bufferは最大2×500件、streamはtaskあたり256,000文字以下。
- REST catch-up後に同一eventがbufferとsnapshotへ二重保持されない。
- terminal直前の表示eventを失わず、REST refetchで最終snapshotへ収束する。
- invalidate coalescingはgap/terminal時の即時reconcileを妨げない。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/nightworkers-realtime-effects.test.ts tests/nightworkers.realtime-events.test.ts tests/nightworkers-workspace-hook-extra-coverage.test.ts
bun run typecheck
```

---

### FE-T3: activity replayをcursor page化する

- Finding: `FE-5`
- Priority: P1
- Depends on: `FE-T2`, 既存`D-T0`
- Production write set:
  - `shared/schemas/nightworkers/activity-message.schema.ts`
  - `api/modules/nightworkers/routes/run-route-task-definitions.ts`
  - `api/modules/nightworkers/nightworkers.activity-persistence.repository.ts`
  - `api/modules/nightworkers/nightworkers.basic.service.ts`
  - `api/modules/nightworkers/nightworkers.routes.ts`
  - `src/modules/nightworkers/nightWorkersCommands.ts`
  - `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
  - `src/modules/nightworkers/realtime/nightWorkersRealtimeProjector.ts`
  - `src/modules/nightworkers/components/ThreadTimeline.tsx`
- Test write set:
  - `tests/nightworkers.activity.repository.test.ts`
  - `tests/nightworkers.activity-transcript.test.ts`
  - `tests/nightworkers-routes-extra-coverage.test.ts`
  - `tests/nightworkers-realtime-effects.test.ts`
  - `tests/thread-timeline-window.test.ts`

#### API contract

query:

```ts
{
  afterSeq?: number;   // realtime/catch-up用
  beforeSeq?: number;  // 過去page用
  limit?: number;      // default 200, min 1, max 200
  channel?: "chat" | "pilot_thought" | "artifact" | "internal";
}
```

`afterSeq`と`beforeSeq`は同時指定不可。responseは既存`events`/`artifacts`にadditiveな`pageInfo`を加える。

```ts
type ActivityReplayPageInfo = {
  oldestSeq: number | null;
  newestSeq: number | null;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};
```

#### Repository semantics

1. cursorなしは最新200件をDBで`seq DESC` + `limit + 1`取得し、responseだけASCへ戻す。
2. `beforeSeq`は`seq < beforeSeq`の最新pageを同様に返す。
3. `afterSeq`は`seq > afterSeq`をASCで最大limit返す。
4. `hasMore*`は追加1件または存在queryで計算し、全件count/全件loadをしない。
5. repositoryへ`listActivityArtifactsByIdsForTask(taskId, artifactIds)`を追加し、返却eventから参照される
   artifactだけをDBで取得する。`listActivityArtifactsForTask`で全artifactを読んでからfilterしない。
6. 同一seq tieは`createdAt`, `id`を安定sort keyに加える。

#### Frontend実装

1. `fetchTaskActivityEvents`へcursor/limit inputを追加する。
2. `useInfiniteQuery`で初回は最新page、`hasMoreBefore`時だけ「さらに読み込む」で`beforeSeq`を取得する。
3. pagesはtimelineへ古い順でflattenし、event idでdedupeする。
4. realtime eventは最新pageだけへ追加する。過去pageを全mapしない。
5. artifact idを持つrealtime eventでは最新pageだけinvalidate/refetchし、既読過去pageを捨てない。
6. task切替時はquery keyが変わり、旧task pageを新taskへ混ぜない。

#### Acceptance

- 初回requestがactivity全件をDB/JSON/React cacheへロードしない。
- 201件fixtureで初回200件、load-more後に残り1件を重複なく表示する。
- page取得中にrealtime eventが到着しても欠落・重複しない。
- `afterSeq`既存consumerとOpenAPI validationが維持される。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/nightworkers.activity.repository.test.ts tests/nightworkers.activity-transcript.test.ts tests/nightworkers-routes-extra-coverage.test.ts tests/nightworkers-realtime-effects.test.ts tests/thread-timeline-window.test.ts
bun run typecheck
```

---

### FE-T4: route-aware workspace query/realtime profile

- Finding: `FE-6`
- Priority: P2
- Depends on: 既存`D-T0`, `D-T1`
- Production write set:
  - `src/modules/nightworkers/routing/WorkbenchRoutePage.tsx`
  - `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
  - `src/modules/nightworkers/hooks/useNightWorkersRealtime.ts`
  - `src/modules/nightworkers/hooks/useNightWorkersProjectFiles.ts`
  - `src/modules/settings/llm-settings-query.ts`（既存`D-T1`が作成）
  - `src/modules/settings/useLlmSettings.ts`
- Test write set:
  - `tests/nightworkers-workspace-hook-extra-coverage.test.ts`
  - `tests/nightworkers-active-session.test.ts`
  - `tests/nightworkers-shell-smoke.test.tsx`

#### Profile contract

```ts
type WorkspaceLoadProfile =
  | { kind: "shell" }
  | { kind: "settings" }
  | { kind: "session"; sessionId: string };
```

- `session` routeだけがsession detail query、project files、WebSocketを有効にする。
- `settings`はsettings queryとshell navigationに必要なrepository/task一覧だけを有効にする。
- `shell`はrepository/task一覧と対象画面自身が所有するqueryだけを有効にする。
- repository一覧、Task一覧、implementation queueはsidebar/queue badgeのshell共通snapshotとして全profileで取得する。
  それ以外のsession resourceはsession profileだけで取得する。

有効化matrixを次で固定する。

| Resource | shell | settings | session |
| --- | --- | --- | --- |
| repositories / tasks / implementation queue | on | on | on |
| LLM settings query | off | on | on |
| session runs / Git closeout / messages | off | off | on |
| Task Operator / Plan Mode / LLM usage | off | off | on |
| activity / review / background processes | off | off | on |
| project files / run details | off | off | on |
| NightWorkers WebSocket | off | off | on |

overview、queue、project detail各画面が所有するqueryはこのhookへ移さず、各画面のroute inputで有効化する。

#### Red test

route kindごとにqueryFn spyとWebSocket factory countを記録し、overview/settings/project detailでも
session runs、messages、activity、review、files、run details、WebSocketが起動する現行failureを固定する。

#### Production実装

1. `WorkbenchRoutePage`がroute stateからprofileを構築してhookへ渡す。
2. session profileの初期active idはURLの`sessionId`とする。存在確認前に最初のTaskへfallbackしない。
3. non-session profileでは既存active idを表示用に保持してもよいが、session detail queryの`enabled`はfalseにする。
4. `resolveNextActiveSessionId`による先頭Task自動選択はsession URLがないrouteでは実行しない。
5. `useNightWorkersRealtime({ enabled })`を追加し、false時はconnection objectを作成せずstatusを
   `disconnected`へする。
6. project files hookも`enabled`を受け、false時にdirectory/file/diff requestを行わない。
7. settings query optionsはprofileから`enabled`を受ける。D-T1のcache identityを変更しない。

#### Acceptance

- overview/settings/queue/project detail mountでWebSocket factory callが0件。
- session routeはURLのTaskだけを取得・subscribeする。
- settings routeでSettings UIに必要なqueryは動き、session queryは0件。
- route切替で旧connectionがunsubscribe/disposeされ、新sessionだけをsubscribeする。
- sidebar、Task作成、project navigationの既存behavior testが成功する。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/nightworkers-workspace-hook-extra-coverage.test.ts tests/nightworkers-active-session.test.ts tests/nightworkers-shell-smoke.test.tsx
bun run typecheck
```

---

### FE-T5: Run/Task lifecycle predicateの意味別集約

- Finding: `FE-7`
- Priority: P2
- Depends on: `ADD-T0`, Area B transition baseline
- Production write set:
  - `shared/schemas/nightworkers/run.schema.ts`
  - `shared/schemas/nightworkers/repository-task.schema.ts`
  - `src/modules/nightworkers/realtimeEvents.ts`
  - `src/modules/nightworkers/hooks/useNightWorkersWorkspaceModel.ts`
  - `src/modules/nightworkers/workbenchSessionSelectors.ts`
  - `src/modules/nightworkers/components/NightWorkersShell.tsx`
  - `src/modules/nightworkers/components/NightWorkersShellThreadPanel.tsx`
  - `src/modules/nightworkers/components/TaskConsolePage.tsx`
  - `src/modules/nightworkers/components/ArtifactPane.tsx`
  - `api/modules/nightworkers/run-orchestration/stop-task-run.ts`
- Test write set:
  - `tests/nightworkers-active-session.test.ts`
  - `tests/nightworkers.realtime-events.test.ts`
  - `tests/nightworkers.workbench-selectors.test.ts`
  - 新規`tests/stop-task-run-status-contract.test.ts`

#### Stop condition

`stop-task-run.ts`には計画時点で未コミット差分がある。accepted baseline確定前は変更しない。

#### Shared contract

別々の意味を次のsymbolで固定する。

- `RUN_EXECUTING_STATUSES`: `running`, `context_compiling`, `finalizing`
- `LEGACY_RUN_EXECUTING_ALIASES`: `compiling_context`。read互換のみでwriterへ追加しない
- `RUN_STOPPABLE_STATUSES`: `running`, `context_compiling`, `finalizing`
- `RUN_TERMINAL_STATUSES`: `completed`, `needs_review`, `needs_human`, `failed`, `blocked`, `timed_out`, `cancelled`
- `TASK_PROCESSING_STATUSES`: 現行UIの`running`, `context_compiling`, `finalizing`
- `LEGACY_PROCESSING_STATUS_ALIASES`: `compiling_context`。Frontend read互換だけに適用する
- predicates: `isRunExecutingStatus`, `isRunStoppableStatus`, `isRunTerminalStatus`,
  `isTaskProcessingStatus`

`verifying`はschemaに残すが、writer未確認のためいずれの集合へも本ticketだけでは追加しない。

#### Red/characterization test

全schema statusを行、全predicateを列にしたtable testを先に追加し、現行consumerの結果を固定する。
特に`needs_review`はterminalだがstoppableでないこと、`compiling_context`はlegacy UI表示だけで
backend stop対象でないことを明示する。

#### Production実装

1. 定数はschema literalと型整合する`as const satisfies`で定義し、string配列を各componentに複製しない。
2. realtime mergeはterminal/executing predicateを参照する。
3. UI spinner、stop button、session groupは目的に対応する別predicateを参照する。
4. backend stop guardは`isRunStoppableStatus`だけを参照する。
5. Composer入力lockは現行どおり送信pending中心とし、Run statusでlockする変更を行わない。

#### Acceptance

- 対象fileのactive/terminal status literal集合が共通contract参照へ置換される。
- 各statusのUI group、spinner、stop可否、realtime terminal処理が変更前tableと一致する。
- 新しいstatus writer/transition/migrationを追加していない。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/nightworkers-active-session.test.ts tests/nightworkers.realtime-events.test.ts tests/nightworkers.workbench-selectors.test.ts tests/stop-task-run-status-contract.test.ts
bun run typecheck
```

---

### FE-T6: Composer draft IOのdebounceとtimer世代管理

- Finding: `FE-9`
- Priority: P3
- Depends on: `ADD-T0`
- Production write set:
  - `src/modules/nightworkers/components/Composer.tsx`
  - 新規`src/modules/nightworkers/components/usePersistedComposerDraft.ts`
- Test write set:
  - `tests/composer-coverage.test.tsx`
  - `tests/frontend-composer-actions.test.tsx`

#### Contract

- debounce: 250 ms
- promptのReact stateは即時更新し、localStorageだけをdebounceする。
- flush契機: textarea blur、`pagehide`、component unmount、storage key変更前。
- clear契機: submit開始時の現行clear。pending timer cancelとgeneration incrementを先に行う。
- restore契機: non-Abort failureの現行restore。直ちに保存し、新generationを開始する。
- AbortError時にdraftを復元しない現行behaviorは維持する。

#### Red test

- 10 keystrokeで10回localStorage writeされる現行挙動。
- submit成功後に古いdebounce timerがdraftを復活させるrace。
- storage key切替時に旧Taskのdraftが新Taskへ書かれるrace。
- prompt以外のrenderで`resizeComposerTextArea`が毎回走る挙動。

#### Production実装

1. storage keyごとのgenerationとpending timerをhookに閉じ込める。
2. timer callbackはschedule時generation/keyがcurrentと一致する場合だけwriteする。
3. `clearDraft`はtimer cancel → generation更新 → localStorage removeの順に行う。
4. `restoreDraft`はtimerをcancelし同期writeしてからprompt stateを戻す。
5. `useLayoutEffect`のresize dependencyを`[prompt]`に限定し、window resize listenerは維持する。
6. localStorage例外はUI送信を失敗させない。

#### Acceptance

- 連続入力は250 ms内1 write。
- blur/unmountで最後の入力が失われない。
- submit成功/Abort後に古いtimerでdraftが復活しない。
- non-Abort failureではprompt、images、draftが従来どおり復元される。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/composer-coverage.test.tsx tests/frontend-composer-actions.test.tsx
bun run typecheck
```

---

### FE-T7: ThreadTimelineをwindow-first mergeへ変更する

- Finding: `FE-10`
- Priority: P2
- Depends on: `FE-T3`
- Production write set:
  - `src/modules/nightworkers/components/ThreadTimeline.tsx`
  - `src/modules/nightworkers/components/ThreadTimelineActivityModel.ts`
  - `src/modules/nightworkers/activityTranscript.ts`
  - `src/modules/nightworkers/realtimeEvents.ts`
  - 新規`src/modules/nightworkers/components/thread-timeline-window.ts`
- Test write set:
  - `tests/thread-timeline-window.test.ts`
  - `tests/thread-timeline-component-extra-coverage.test.tsx`
  - `tests/thread-timeline-activity-model-coverage.test.ts`

#### Red/characterization test

1. messages/events各10,000件で現在のvisible last 100 id/orderをsnapshotする。
2. timestamp同値、unprojected user message、activity transcriptあり/なし、debug on/offを固定する。
3. helperへ比較回数counterを注入し、visible100件のために20,000件を全sortする現行failureを固定する。
   wall clock時間をassertionにしない。

#### Production実装

1. repository/query/realtimeが各inputを時系列ASCで供給することをtestで証明する。
   ASCでないsourceが見つかった場合は当該source ownerで一度だけ安定順へ正規化し、combined arrayの
   full sortへfallbackしない。
2. sorted sourceの末尾からtwo-pointerで必要window分だけmergeする
   `mergeChronologicalWindow`をpure helperとして実装する。
3. timestamp tieは現行のsource order/index ruleを維持する。
4. activity transcriptが存在する場合、fallback `timelineItems`を構築しない。存在しない場合だけ
   message/event pathを構築する。
5. historyをさらに読む場合は`FE-T3`のpage取得後、増えたwindowだけをmergeする。
6. `measureArtifactPerf`のlabelとcount metadataを維持し、全件sort削除を観測可能にする。

#### Acceptance

- 全characterization caseでvisible item、order、id、Load more結果が一致する。
- last100表示のmerge比較回数がinput全件数ではなくwindow/source数に比例する。
- debug off時にdebug eventをvisible windowへ混ぜない。
- activity pageが追加されたときscroll/history windowが不正に最新へ飛ばない。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/thread-timeline-window.test.ts tests/thread-timeline-component-extra-coverage.test.tsx tests/thread-timeline-activity-model-coverage.test.ts
bun run typecheck
```

---

### FE-T8: realtime message key dedupeをbounded LRU化する

- Finding: `FE-11`
- Priority: P2
- Depends on: `ADD-T0`
- Production write set:
  - 新規`shared/schemas/nightworkers/realtime-limits.ts`
  - `api/services/realtime/nightworkers-ws.ts`
  - 新規`src/modules/nightworkers/realtime/bounded-message-key-cache.ts`
  - `src/modules/nightworkers/realtime/nightWorkersRealtimeProjector.ts`
  - `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`
- Test write set:
  - `tests/services.realtime-broker.test.ts`
  - `tests/nightworkers-realtime-effects.test.ts`
  - 新規`tests/bounded-message-key-cache.test.ts`

#### Contract

- server replay window: `NIGHTWORKERS_REALTIME_REPLAY_MESSAGES_PER_TASK = 240`
- client dedupe capacity: `NIGHTWORKERS_REALTIME_DEDUPE_CAPACITY = 480`
- server/clientはshared constantを参照し、magic numberを複製しない。
- client cacheはinsertion-ordered `Map<string, true>`を使い、capacity超過時に最古1件ずつevictする。
- cache hit時はkeyを末尾へ移動してLRUとする。

#### Red test

- 5,001件目でSet全体がclearされ、直後のserver replay deltaが再適用される現行failureを固定する。
- reconnect同一taskとtask切替の挙動を分けてtestする。

#### Production実装

1. `Set` refをbounded cacheへ置換する。
2. 同じTaskのreconnectではcacheを保持する。
3. active Task idが実際に変わった場合だけcacheをclearする。
4. server replay TTL/240件の挙動は維持し、client容量をserver windowの2倍にする。
5. dedupe keyを作れないmessageは従来どおり適用し、content文字列で推測dedupeしない。

#### Acceptance

- 5,001件処理後も直近480 keyが残り、replay240件が二重appendされない。
- memoryは480 key以下。
- task Bの同じkeyをtask Aのcacheで誤って抑止しない。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/services.realtime-broker.test.ts tests/nightworkers-realtime-effects.test.ts tests/bounded-message-key-cache.test.ts
bun run typecheck
```

---

### FE-T9: `resolveNextActiveSessionId`の重複除去

- Finding: `FE-12`
- Priority: P3
- Depends on: `FE-T4`
- Production write set:
  - `src/modules/nightworkers/hooks/useNightWorkersWorkspaceModel.ts`
  - `src/modules/nightworkers/hooks/nightWorkersMutationHelpers.ts`
  - `src/modules/nightworkers/hooks/useNightWorkersMutations.ts`
- Test write set:
  - `tests/nightworkers-active-session.test.ts`
  - `tests/nightworkers-mutations-hook-extra-coverage.test.ts`
  - `tests/useNightWorkersWorkspace.test.tsx`

#### Production実装

1. canonical definitionは`useNightWorkersWorkspaceModel.ts`に残す。
2. mutation helperはcanonical functionをimportし、local definitionを削除する。
3. mutation helperからのre-exportも残さず、`useNightWorkersMutations.ts`はcanonical moduleを直接importする。
   既存mock testもcanonical moduleをmockするよう更新する。
4. `FE-T4`でroute fallback semanticsが変わった後の確定signatureを使う。先に実装しない。

#### Acceptance

```bash
rg -n "function resolveNextActiveSessionId" src/modules/nightworkers
```

の定義が1件で、current id保持、missing id fallback、empty listの既存testが成功する。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/nightworkers-active-session.test.ts tests/nightworkers-mutations-hook-extra-coverage.test.ts tests/useNightWorkersWorkspace.test.tsx
bun run typecheck
```

---

### FE-T10: Mission Pilot optimistic control rollback

- Finding: `FE-13`
- Priority: P2
- Depends on: `ADD-T0`
- Production write set:
  - `packages/mission-pilot/src/frontend/useMissionPilotControls.ts`
- Test write set:
  - `tests/mission-pilot-frontend-realtime.test.ts`
  - 新規`tests/mission-pilot-frontend-controls.test.tsx`

#### Red test

- play/stop非2xx、network throw、response JSON parse failureで`starting`/`stopping`がcacheに残る。
- command失敗前に同versionまたはより新しいrealtime summaryが到着するrace。
- rollback後のrefetchも失敗するcase。

#### Production実装

1. command前に`previousSummary`、`commandSummary`、生成した`optimisticSummary` objectを保持する。
2. cacheへその`optimisticSummary` object参照を設定する。
3. catchのfunctional updaterは、currentが同一object参照の場合だけ`commandSummary`へ戻す。
4. currentが別object、または同等以上versionのserver/realtime summaryなら保持する。
5. rollback直後にcontrol queryをinvalidate/refetchする。refetch failureでもrollback済みsnapshotを残す。
6. task messages invalidationとerror stateは維持する。public `play`/`stop`がerrorを内部stateへ格納する現行APIも維持する。
7. success mergeは`mergeMissionPilotControl`のversion ruleを維持する。

#### Acceptance

- command失敗後にUIが`starting`/`stopping`へ張り付かない。
- 後着realtime stateを古いsnapshotで巻き戻さない。
- success、failure、realtime race、refetch failureの全testが決定的に成功する。

#### Verification

```bash
node scripts/run-vitest.mjs run tests/mission-pilot-frontend-realtime.test.ts tests/mission-pilot-frontend-controls.test.tsx
bun run typecheck
```

---

### ADD-T99: 統合検証と計画closeout

- Findings: 全件
- Depends on: 実装対象ticket全完了
- Write set: 必要なtest expectationと本書のstatus/evidence欄のみ。production修正を混ぜない

#### Preflight

1. 全ticketの限定testが個別にgreenである。
2. worktreeに別processの変更が増えていない。
3. coverage processが他で実行中でない。

#### Static audits

```bash
rg -n 'modules/codingAgent|modules/coding-agent' api/services -g '*.ts'
rg -n 'execFileAsync\("git"|spawn\("git"' api/services/worker-tools/clone-git-repo.ts
rg -n 'function resolveNextActiveSessionId' src/modules/nightworkers
rg -n 'size > 5000|\.clear\(\)' src/modules/nightworkers/realtime
```

期待値は順に0件、0件、1件、全clear実装0件。test cleanupの`clear()`は対象外なので、最後の結果は
symbol contextを確認する。

#### Gates

```bash
bun run check:docs
bun run check:architecture
bun run typecheck
bun run lint
node scripts/run-vitest.mjs run
bun run test:coverage
node scripts/verify.mjs full
```

`test:coverage`は単独で実行する。external service、OS sandbox、GUI不足で実行できないgateは
`未検証`と記録し、passへ読み替えない。

#### Completion criteria

1. Finding表の15件が対応ticketとgreen testを持つ。
2. `api/services -> codingAgent` importがtype/value/dynamicを含め0件。
3. log fixture secretが全sinkで0件。
4. clone source/target/protocolがstructural policyとexternal path authorityを守る。
5. REST/WS resource limitが境界値testを持つ。
6. optimistic cacheはfailure/raceでserver stateへ収束する。
7. realtime memoryは利用者操作なしに設定上限を超えない。
8. non-session routeがsession query/WebSocketを起動しない。
9. lifecycle predicate集約後もtransition/UI挙動がcharacterization tableと一致する。
10. 全gate結果と未検証事項を報告する。
11. 実装完了後、本書を`spec/.archived`へ移し、`spec/docs`へ完了計画を残さない。

## 7. Terraへのticket依頼テンプレート

Terraへは次の形式で一件ずつ渡す。

```text
このticketだけを実装してください: <TICKET-ID>

正本:
spec/docs/additional-security-boundary-and-frontend-hardening-implementation-plan.md

必須手順:
1. ADD-T0のaccepted baselineとticketのDepends onを確認する。
2. ticket本文のwrite set、red test、contract、acceptanceを全文読む。
3. write setに既存差分があれば変更せず停止する。
4. red testを先に追加し、想定理由の失敗を記録する。
5. write set外へ広げず実装する。
6. 限定test、typecheck、指定architecture checkを実行する。
7. diff check、変更file、red/green結果、未検証事項を報告する。

禁止:
- 対象外findingの便乗修正
- 未確定contractの推測実装
- 既存dirty差分の復元・上書き
- test削除、skip、上限緩和によるgreen化
- acceptance未達での完了報告
```
