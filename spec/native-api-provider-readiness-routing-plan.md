# Native/API Provider Readiness Routing 実装計画

## 1. 目的

`native-api-runner` が弱い local model や接続不可 provider を毎 turn 律儀に踏んで停止して見える問題を減らす。

この計画で扱う改善:

1. provider readiness を route selection に反映する。
2. primary / fallback の重複 route を dedupe する。
3. provider route attempt ごとに短い timeout を持たせる。
4. model / phase に応じて tool exposure を制御する。
5. 弱い local model 向けに tool result budget / quality recovery / evidence carry-over を追加する。

目標は、Codex SDK lane へ fallback せずに native/API lane のまま進行性を上げること。

## 2. 背景

直近の native/API run では次の状態が観測された。

- implementation route の primary と fallback が同じ `openai-default` / `gemma-4-12b-it-4bit` になっていた。
- Gemma は `tool_choice=required` で `required_tool_call_missing` 400 を返す場合がある。
- 同じ Gemma fallback が続くため、同じ失敗を二重に払っていた。
- Qwen fallback endpoint は `Unable to connect` で、実質的に遅延だけを増やしていた。
- Azure fallback は成功し、実際に tool call を返していた。
- provider turn の `toolCount` は 20 で、Gemma 12B には tool surface が広い。
- route attempt 単位の timeout がなく、run 全体の signal を共有しているため、Gemma timeout が長く見える。

`../codex` 側の設計を見ると、Codex 本体は次の性質を持つ。

- tool choice は基本 `auto`。
- tool call が返れば tool を実行し、assistant message だけなら turn 完了として扱う。
- turn-scoped `ModelClientSession` で retries / incremental input / `previous_response_id` / auto-compact を扱う。
- OSS provider は起動時 readiness を確認する導線を持つ。
- tool exposure は turn context / tool router / deferred tools で制御される。

NightWorkers native/API は実装レーンで `tool_choice=required` を使うため、弱いモデルが本文だけ返して作業したふりをする問題は減る。一方で、弱いモデルや不通 provider を避ける routing / readiness / timeout / tool surface 制御が必要になる。

## 3. 非目標

- Codex SDK lane へ fallback しない。
- SchemaFirst supervisor loop へ fallback しない。
- `tool_choice=required` を全面撤去しない。
- Supervisor decision provider に用途別の細かい SystemContext や route 判断を移さない。
- ユーザー文言を keyword / regex で分類して route を変えない。
- local-llm の API contract をこの計画の第一段階で変更しない。
- contextStill / Todo / closeout gate の責務を routing 層へ混ぜない。

## 4. 目標状態

### 4.1 readiness

enabled な endpoint でも、直近 health が unreachable の場合は native/API route 候補から一時的に外す。

例外:

- health 状態が unknown の場合は候補に残してよい。
- user が明示 routeOverride した場合は、health warning を出したうえで試行してよい。
- Azure のように health probe が completion API を使う provider は、短い probe timeout を使う。

readiness は `enabled` の代替ではない。`enabled` は設定上使ってよいか、readiness は今使えるかを表す。

### 4.2 dedupe

route candidates は次の key で重複排除する。

```text
providerEndpointId + model + providerId
```

primary と fallback が同じ key の場合は primary を残し、fallback を削除する。

synthesized fallback でも同じ key を再追加しない。

### 4.3 per-attempt timeout

native/API provider turn では、run 全体 timeout とは別に route attempt timeout を使う。

初期値:

- local / openai-compatible endpoint: 300 秒
- fallback local endpoint: 300 秒
- Azure / OpenAI hosted endpoint: 120 秒
- user task の timeoutSeconds がそれより短い場合は短い方を使う

attempt timeout で失敗した場合は、run 全体を止めず次 route へ進む。

### 4.4 tool exposure

implementation mode で常に全 tool を出すのをやめる。

tool exposure は少なくとも次の軸で制御する。

- executionMode
- current Todo taskType
- provider/model capability profile
- current phase

Gemma など弱い local model では、inspection phase の tool surface を小さくする。

例:

```text
inspection:
- read_current_specification
- list_dir
- read_file
- search_files
- git_status
- git_diff
- todo_list
- context_decision
- new_context
- finalize_answer

implementation:
- inspection tools
- apply_patch
- replace_content
- import_project
- run_verification

closeout / review:
- read/search/git/run_verification
- context_compile
- compile_eval
- register_candidates
- todo_list
- finalize_answer
```

ただし tool を消しすぎて作業不能にしない。弱モデル向け profile は最初に小さく出し、必要な tool がない場合に `new_context` または次 turn で広げられる構造にする。

## 5. 対象ファイル

主対象:

- `api/services/structured-llm/role-routing.ts`
- `api/services/structured-llm/request.ts`
- `api/services/structured-llm/provider-health.ts`
- `api/services/structured-llm/providers.ts`
- `api/services/structured-llm/types.ts`
- `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`

テスト対象:

- `tests/structured-llm/services-structured-llm-02.test.ts`
- `tests/structured-llm/provider-health.test.ts`
- `tests/services.native-api-request-adapter.test.ts`
- `tests/services.native-api-runner.test.ts`
- `tests/services.native-api-runner-startup.test.ts`

## 6. 実装方針

### Phase 1: route candidate dedupe

対象:

- `api/services/structured-llm/role-routing.ts`
- `tests/structured-llm/services-structured-llm-02.test.ts`

実装:

1. `ResolvedStructuredLlmRoute` に route key helper を追加する。
2. `resolveStructuredLlmRoleRouteCandidates(...)` で explicit primary / fallback を構築した後、route key で dedupe する。
3. dedupe で落とした fallback は diagnostics に残す。
4. `applyRoutePolicy(...)` の synthesized fallback も同じ route key で seen 管理する。

検証:

- primary と fallback が同じ endpoint/model の場合、候補は1件になる。
- endpoint は同じだが model が違う場合は残る。
- explicit fallback と synthesized fallback が重複しない。
- 既存の `routePolicy.disallowed=codex` は維持される。

### Phase 2: provider readiness を route selection に入れる

対象:

- `api/services/structured-llm/provider-health.ts`
- `api/services/structured-llm/role-routing.ts`
- `api/services/structured-llm/request.ts`
- `tests/structured-llm/provider-health.test.ts`
- `tests/structured-llm/services-structured-llm-02.test.ts`

実装:

1. provider health の結果を短時間 cache できる service を追加する。
2. `StructuredLlmRoutePolicy` に readiness filter を追加する。
   - `skipUnreachableEndpoints?: boolean`
   - `healthCacheTtlMs?: number`
   - `healthProbeTimeoutMs?: number`
3. native/API runner からは `skipUnreachableEndpoints: true` を指定する。
4. health unknown は route 候補に残す。
5. health unreachable は route 候補から外し、diagnostics に `readiness.unreachable` を残す。
6. routeOverride は原則尊重する。ただし diagnostics と event で warning を残す。

検証:

- Qwen endpoint の health が unreachable の場合、fallback 候補から外れる。
- health unknown の endpoint は候補に残る。
- health reachable の endpoint は候補に残る。
- routeOverride は unreachable でも候補に残る。

### Phase 3: native/API per-attempt timeout

対象:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`
- `api/services/structured-llm/providers.ts`
- `api/services/structured-llm/types.ts`
- `tests/services.native-api-runner.test.ts`
- `tests/structured-llm/services-structured-llm-02.test.ts`

実装:

1. `RawToolTurnCallOptions` に `attemptTimeoutMs` を追加する。
2. `buildNativeApiProviderRequests(...)` で route ごとの timeout を決める。
3. provider attempt loop で attempt ごとに `AbortController` を作る。
4. run 全体 signal と attempt signal を合成する。
5. attempt timeout は `provider_route_attempt_timeout` として routeAttempts に記録する。
6. timeout 後に次 route があれば fallback する。
7. run 全体 cancel / timeout は従来通り run 停止にする。

検証:

- primary local が attempt timeout しても fallback に進む。
- run 全体 signal が abort された場合は fallback せず cancelled になる。
- routeAttempts に attempt timeout と durationMs が残る。
- fallback succeeded の providerDebug に routeAttempts が残る。

### Phase 4: provider error classification

対象:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/structured-llm/providers.ts`
- `tests/services.native-api-runner.test.ts`

実装:

1. provider error message を分類する helper を追加する。
2. `required_tool_call_missing` は `tool_required_missing` として扱う。
3. `tool_required_missing` は同じ route key の再試行を skip する。
4. `Unable to connect` / `ECONNREFUSED` は `endpoint_unreachable` として扱う。
5. `loading model` / transient 503 は短い retry または readiness unknown として扱う。
6. classification を `routeAttempts[].reason` と event payload に出す。

検証:

- `required_tool_call_missing` 後、同一 endpoint/model fallback を踏まない。
- unreachable endpoint は `endpoint_unreachable` として記録される。
- transient loading は1回だけ retry される、または readiness に委ねられる。

### Phase 5: tool exposure profile

対象:

- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
- `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `tests/services.native-api-request-adapter.test.ts`
- `tests/services.native-api-runner.test.ts`

実装:

1. `getNativeApiToolDefinitions(...)` の input に context を追加する。
   - `executionMode`
   - `taskType`
   - `model`
   - `providerEndpointId`
   - `phase`
2. model capability profile を最小実装する。
   - `strong`
   - `weak_local`
   - `unknown`
3. Gemma 12B など weak local は inspection phase で reduced tool set を使う。
4. implementation phase では mutation tool を出すが、不要な contextStill / MCP catalog tool は絞る。
5. `toolCount` と profile を turn_started payload に出す。
6. tool が足りない場合の復旧ヒントを system prompt または tool result に出す。

検証:

- Gemma + inspection では toolCount が減る。
- Azure + implementation では必要な implementation tool が残る。
- review / runtime_debug では read/search/git/run_verification が残る。
- `finalize_answer` / `todo_list` / `new_context` は必要 mode で残る。

### Phase 6: UI / run heartbeat visibility

対象:

- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- run event / task run update 周辺
- `tests/services.native-api-runner.test.ts`

実装:

1. route fallback started / attempt timeout / readiness skip で run heartbeat を更新する。
2. `task_runs.updated_at` が provider wait 中も進むようにする。
3. event payload に current route attempt と next route を含める。
4. UI が停止ではなく fallback 待ちだと表示できる event を残す。

検証:

- route fallback event 後に `task_runs.updated_at` が更新される。
- attempt timeout event が task timeline に出る。
- readiness skip event が warning として出る。

## 7. `tool_choice` 方針

`required` は全面撤去しない。

初期方針:

- strong provider: implementation / review / runtime_debug は `required` を維持する。
- weak local + reduced tool set: `required` を維持してよい。
- weak local + full tool set: 避ける。
- planning / general_answer: `auto` を維持する。

将来案:

- model profile が weak local の場合、最初の turn だけ特定 tool を forced function にする。
  - inspection なら `read_current_specification` または `list_dir`
  - Todo closeout なら `todo_list`
- `required_tool_call_missing` が出た場合、同一 prompt で再試行せず、reduced tool set または別 provider に切り替える。

## 8. 推奨実装順

1. Phase 1 dedupe
2. Phase 4 error classification
3. Phase 3 per-attempt timeout
4. Phase 2 readiness filter + local context probe
5. Phase 7 tool result budget / discovery bounds
6. Phase 5 tool exposure profile
7. Phase 8 quality recovery / text tool-call diagnostics
8. Phase 6 heartbeat visibility
9. Phase 9 evidence handles / compaction bridge

理由:

- dedupe と error classification は小さく、即効性が高い。
- per-attempt timeout は Gemma の長時間占有を直接減らす。
- readiness は cache / probe / routeOverride の設計が少し広い。
- tool result budget は弱モデルの read/list/search 過多を抑えるため、tool exposure より先に入れる。
- tool exposure は挙動への影響が大きいため、ログで route と tool result budget の安定化を確認してから入れる。
- quality recovery は tool exposure 後の失敗形に合わせて入れる。

## 9. リスク

### 9.1 readiness false negative

health probe が失敗しても completion は通る provider があり得る。

対策:

- unknown は候補に残す。
- unreachable cache TTL を短くする。
- routeOverride は尊重する。
- readiness skip を diagnostics / event に残す。

### 9.2 tool surface を絞りすぎる

モデルが必要 tool を使えず停止する可能性がある。

対策:

- `todo_list` / `new_context` / `finalize_answer` は残す。
- reduced profile は inspection から始める。
- tool unavailable の model-visible error に「次 turn で expanded tools が必要」と出す。

### 9.3 timeout が短すぎる

local model のロード直後だけ遅い場合、成功前に切ってしまう。

対策:

- transient 503 / loading model は timeout とは別に扱う。
- health probe で warming 状態を見られる場合は readiness unknown にする。
- local attempt は 300 秒から始める。

## 10. 完了条件

- primary/fallback に同じ endpoint/model があっても同じ route を二重に踏まない。
- Qwen endpoint が unreachable の場合、native/API route で毎 turn 踏まない。
- Gemma attempt が長時間握っても attempt timeout で fallback へ進む。
- `required_tool_call_missing` が同一 model 再試行にならない。
- weak local inspection turn の toolCount が full implementation surface より小さい。
- routeAttempts に dedupe / readiness / timeout / classification の根拠が残る。
- oversized な read/list/search/run result は、model-visible な絞り込みヒント付きで縮約される。
- 同一 tool call の反復、unknown tool、malformed args は correction / backoff として記録され、無限に同じ turn を続けない。
- text に埋め込まれた tool call は直接実行せず、diagnostic と native tool-call 再発行ヒントとして扱われる。
- local endpoint の context window probe は best-effort で、失敗しても route 全体をブロックしない。
- ユーザー文言の keyword / regex classification は導入されていない。
- `bunx vitest run tests/structured-llm/services-structured-llm-02.test.ts tests/structured-llm/provider-health.test.ts tests/services.native-api-request-adapter.test.ts tests/services.native-api-runner.test.ts` が通る。

## 11. `../little-coder` レビューから追加する弱モデル対策

`../little-coder` は pi ベースの小型 local model 向け agent で、弱い LLM が長文 context / 広すぎる tool surface / malformed tool call で止まる問題への対策を多く持っている。

ただし NightWorkers では Codex 由来の native/API 改善を優先する。`little-coder` 由来の要素は、readiness / dedupe / per-attempt timeout / tool exposure を無効化しない範囲で追加する。

### 11.1 採用するもの

#### tool result budget guard

`read_file` / `list_dir` / `search_files` / `run_verification` のような tool result が大きすぎる場合、結果を丸ごと context に入れない。

方針:

- 先頭部分と要約 metadata を残す。
- model-visible に「grep/search/targeted read を使う」ヒントを出す。
- 縮約されたことを tool history / event に残す。
- `maxEntries` だけでなく scan budget / output budget を持つ。

期待効果:

- Gemma 12B などが巨大 tool result 後に何もできなくなる状態を減らす。
- prompt budget fallback や stale recovery に入る前に、探索を狭くできる。

#### bounded discovery

file discovery 系 tool は重い directory を既定で探索しない。

除外候補:

- `.git`
- `node_modules`
- `.next`
- `dist`
- `build`
- `.cache`
- coverage / logs / temporary output

探索上限:

- scan file count limit
- match count limit
- truncation reason
- retry hint

#### mutation evidence freshness

mutation tool は、対象 file の直近 read/search/git evidence がない場合に model-visible error を返す。

方針:

- `apply_patch` / `replace_content` の前に対象 file の read evidence を要求する。
- 新規 file は例外として許可する。
- authored file は同一 session 内なら継続編集を許可する。
- block する場合は「まず read_file / search_files / git_diff を実行する」ように返す。

これは weak model 向けの強制として有効だが、Codex lane のような高度な編集 flow を阻害しないよう native/API runner 内に限定する。

#### quality recovery

次の失敗を native/API runner の quality recovery として分類する。

- empty assistant response
- unknown tool name
- malformed tool args
- identical tool call loop
- required tool call が text に埋め込まれている

対応:

- 1回目は短い correction を model に返す。
- 同一失敗が続く場合は correction を最大2回程度で打ち切る。
- その後は同一 route key の再試行ではなく fallback / route failure に進める。
- correction / backoff は routeAttempts と task_events に残す。

#### text-embedded tool call diagnostics

弱い model は native tool call を要求しても、本文に JSON / fenced block / XML-like tag / Pythonic call を出すことがある。

NightWorkers では、本文から tool call を復元して直接実行しない。

方針:

- text に埋め込まれた tool call らしき構造を検出する。
- diagnostic に `text_embedded_tool_call_detected` を残す。
- model へ「native tool call として再発行する」短い correction を返す。
- Liquid / llama.cpp template 固有形式は、template mismatch の可能性として warning にする。
- 直接実行はしない。tool safety と auditability を優先する。

これは `tool_choice=required` を撤去するための代替ではなく、`required_tool_call_missing` の原因を見える化するための補助である。

#### provider / model capability profile

local endpoint は static config だけでなく、起動中 endpoint の情報を best-effort で読む。

追加したい profile fields:

- `contextWindow`
- `acceptsTemperature`
- `supportsNativeToolCalls`
- `toolCallStyle`
- `preferredMaxToolCount`
- `weakLocal`

llama.cpp 互換 endpoint では `/props` から context window を probe できる場合がある。ただし probe failure は route failure にしない。

この profile は tool exposure / result budget / timeout の入力にする。provider selection の主判断を llm-provider 側へ分散させない。

#### evidence handles / compaction bridge

巨大な read result を再投入し続けず、既存の tool history / task_events / contextStill evidence を handle として参照できる形にする。

方針:

- 縮約した tool result に evidence id / toolCallId / path / line range を残す。
- `new_context` 後に「既存 evidence は tool history に残っている」ことを model-visible にする。
- 別の汎用 evidence tool を増やす前に、既存 DB record と activity event を使う。

#### error-recovery / recency based tool guidance

tool guidance はユーザー文言の keyword ではなく、次の runtime evidence から選ぶ。

- current Todo taskType
- executionMode
- phase
- last failed tool
- recent tool calls
- model capability profile

例:

- `apply_patch` が read-before-edit で失敗した直後は、`read_file` / `search_files` の使い方だけを短く出す。
- repeated `list_dir` の後は、`search_files` / targeted read に誘導する。
- implementation Todo では mutation tool を出すが、contextStill catalog 系は必要最小限にする。

### 11.2 採用しないもの / 制約付きにするもの

#### keyword intent routing

`little-coder` には keyword scoring で knowledge / skill を注入する仕組みがある。

NightWorkers では採用しない。

理由:

- この repository のルールで、ユーザー文言を regex / keyword 判定して処理を分けないことになっている。
- routing / workflow は prompt と Todo / phase / mode で決める。
- contextStill への query 品質は、仕様書 / Todo / runtime evidence を先に読むことで上げる。

#### hard turn cap

単純な max turn / max tool call による hard stop は採用しない。

理由:

- 以前の native/API 問題では、hard maxToolCalls が本当の停止理由を隠した。
- 実装中の agent には review / verification / closeout gate が必要で、単純な turn cap は途中停止を増やす。

代替:

- repeated identical tool call loop を検出する。
- progress evidence がない場合に correction / route fallback を行う。
- heartbeat と task_events で止まって見える状態を減らす。

#### Plan Mode sub-coders

`little-coder` の read-only sub-coder / Plan Mode は参考になるが、この計画の第一段階には入れない。

理由:

- 今の native/API 課題は provider route 安定性と tool execution 継続性が先。
- sub-agent 化は context / UI / Todo gate の設計範囲が広い。
- Codex 由来の readiness / timeout / tool exposure を先に安定させる。

将来検討:

- read-only investigation を compact report として main context に戻す。
- 子 task の full transcript は UI detail に残し、main prompt には要約だけ入れる。
- implementation は親 runner の Todo gate と mutation guard を通す。

#### format-specific parser の全面導入

Liquid / LFM2 の Pythonic tool call parser は、特定 serving template では有効だが core runner へ全面導入しない。

方針:

- provider profile が該当 toolCallStyle を示す場合だけ diagnostic parser として使う。
- parse できても直接 tool 実行しない。
- template mismatch の warning と再発行 correction に留める。

### 11.3 追加 phase

#### Phase 7: tool result budget / discovery bounds

対象:

- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- file discovery / read tool 実装
- `tests/services.native-api-runner.test.ts`

実装:

1. tool result の output budget を定義する。
2. read/list/search/run result が budget を超える場合は縮約する。
3. 縮約 metadata と retry hint を tool result に含める。
4. discovery tool に heavy directory prune / max scan / max matches を追加する。
5. truncation reason を task_events に残す。

検証:

- 大きい file read が full content を context に入れない。
- truncated result に targeted read / search hint が含まれる。
- heavy directory が既定探索から外れる。

#### Phase 8: quality recovery / text tool-call diagnostics

対象:

- `api/services/structured-llm/tool-calls.ts`
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `tests/services.native-api-runner.test.ts`

実装:

1. empty / unknown tool / malformed args / repeated identical tool call を分類する。
2. correction を最大回数付きで返す。
3. text-embedded tool call を検出し、直接実行せず diagnostic に残す。
4. correction 上限後は同一 route を続けず fallback または route failure にする。

検証:

- malformed args で同じ correction を無限に続けない。
- repeated exact tool call が routeAttempts に記録される。
- text JSON tool call は直接実行されず、native tool call 再発行を促す。

#### Phase 9: evidence handles / compaction bridge

対象:

- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
- `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
- `tests/services.native-api-request-adapter.test.ts`

実装:

1. tool history に evidence handle を持たせる。
2. 縮約 result には handle / path / line range / summary を残す。
3. `new_context` 後の prompt に、既存 evidence handle の参照方法を短く含める。
4. contextStill と重複する汎用 knowledge store は作らない。

検証:

- compact 後も重要な read evidence の handle が prompt に残る。
- full transcript を再投入しなくても、model が対象 file / line を再探索できる。
- contextStill の責務と runner tool history の責務が混ざらない。
