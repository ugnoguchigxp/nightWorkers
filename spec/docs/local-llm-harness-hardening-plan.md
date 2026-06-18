# Local LLM Harness Hardening 実装計画

## 目的
NightWorkers の native/API runner を、小型・local LLM が壊しやすい操作に強くする。

この計画はモデル重みや推論サーバの性能改善ではなく、agent harness / worker tool 側の制約と復旧を対象にする。
little-coder の実装から取り入れるのは、失敗しやすい自由度を減らす設計だけであり、extension 実装をそのまま移植しない。

## スコープ

### 実装すること
1. read-before-edit / write guard を native/API runner の worker tool 境界で強制する。
2. large-read trimming を model context / prompt budget と連動させる。
3. tool-call 崩れを検知し、native tool call として再発行させる復旧 path を追加する。
4. local provider profile と live context window detection を導入する。

### 実装しないこと
- contextStill compile による skill / knowledge injection はこの計画に含めない。
- Supervisor decision provider に用途別の細かい実行判断を追加しない。
- ユーザー文言の keyword / regex 判定で workflow を分岐しない。
- little-coder の `.pi/extensions/*` をそのままコピーしない。
- 外部の global config や local LLM host 設定を NightWorkers が勝手に書き換えない。
- Codex SDK lane への fallback を local LLM 最適化として扱わない。

## レビュー結果

この計画は実装に移れる。ただし、実装時に迷いやすい点が 4 つあるため、この文書内で補強する。

1. NightWorkers には little-coder の汎用 `Write` tool と同じ surface はない。ここでの write guard は、既存ファイルを丸ごと作り直す、または未確認の既存ファイルを変更する worker tool 操作を止める意味で扱う。
2. `requiresReadBeforeEdit` metadata は既にあるが、native/API runner 経路で必ず gate されることを Phase 1 の成果物にする。
3. large-read trimming は新しい prompt compaction 層を増やさず、`read_file` の output compression と model capability の接続として実装する。
4. tool-call 崩れ復旧は、抽出した call を NightWorkers が代理実行する機能ではない。native tool call channel での再発行を 1 回だけ促す復旧に限定する。

## 現状の接続点

### worker tool
- `api/services/worker-tools/dispatcher.ts`
  - `read_file` 成功時に `readFiles` を更新している。
  - `apply_patch` / `replace_content` は同じ dispatcher 経由で実行される。
- `api/services/tool-policy/tool-manifest.ts`
  - `apply_patch` と `replace_content` は `requiresReadBeforeEdit: true` を持つ。
- `api/services/tool-policy/tool-policy-gate.ts`
  - path / command policy はあるが、native/API runner 経路で read-before-edit enforcement が明確に接続されているか確認が必要。
- `api/services/worker-tools/read-file.ts`
  - range read、compressionMode、read cache を持つ。
- `api/services/worker-tools/output-compression/read-cache.ts`
  - large file summary と repeated read marker を返せる。

### native/API runner
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
  - provider turn loop、max turn、`missing_tool_call` stop を持つ。
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
  - tool mode allowlist と worker tool dispatch を持つ。
- `api/services/agent-runtime/native-api-runner/native-api-tool-registry.ts`
  - mode ごとの tool exposure を持つ。

### provider
- `api/services/structured-llm/role-routing.ts`
  - `local` / `openai-compatible` endpoint は provider id として `openai` に寄せられる。
- `api/services/structured-llm/providers.ts`
  - OpenAI-compatible path は `/chat/completions` に `tools` と `tool_choice: auto` を送れる。
- `api/services/structured-llm/model-capability.ts`
  - `contextWindowTokens` / `safePromptBudgetTokens` / `reservedOutputTokens` の capability model がある。

## Phase 0: 実装前の確認

### 目的
実装に入る前に、現在の native/API runner 経路と local endpoint 経路の事実を固定する。

### 確認すること
1. `dispatchNativeApiToolCall` から worker tool 実行までの間に、固定 policy gate が通っているか確認する。
2. `state.readFiles` が relative path のままか、absolute path と混在しうるか確認する。
3. `read_file` の compression metadata が native tool call record と task event のどちらに残っているか確認する。
4. local endpoint が `/chat/completions` native tools path を通っていることを unit test で固定する。
5. 現在の Settings / provider 関連変更がある場合は、既存差分を壊さないように対象ファイルを読む。

### 成果物
- Phase 1 以降で使う canonical path helper の置き場所を決める。
- native/API runner 専用 policy gate を新設するか、既存 `DefaultToolPolicyGate` を接続するか決める。
- Phase 4 の capability schema 変更が既存 Settings UI 変更と衝突しないか確認する。

## Phase 1: read-before-edit / write guard

### 方針
既存ファイルへの編集は、対象ファイルを同一 native/API run 内で `read_file` してからでないと実行できないようにする。
これは prompt 指示ではなく、worker tool dispatch 前の固定 gate として実装する。

NightWorkers には汎用 `Write` tool はないため、この Phase の write guard は次の 2 つを指す。

- 既存ファイルを新規作成扱いで上書きしようとする patch を拒否する。
- 既存ファイルを未読のまま `replace_content` / `apply_patch` で変更しようとする操作を拒否する。

### 対象 tool
- `replace_content`
- `apply_patch`

### 実装内容
1. `DefaultToolPolicyGate` または native/API runner 専用 policy gate を `dispatchNativeApiToolCall` の worker tool 実行前に必ず通す。
2. `TOOL_MANIFEST[toolName].requiresReadBeforeEdit` が true の場合、対象ファイルが `state.readFiles` に含まれているか確認する。
3. `replace_content` は `filePath` を対象として判定する。
4. `apply_patch` は patch target を preflight で抽出し、既存ファイルへの update target は read 済みを要求する。
5. 新規ファイル作成 patch は read-before-edit の対象外にする。ただし、既存ファイルを Add File で作る patch は既存の `PATCH_TARGET_EXISTS` と同じく拒否する。
6. block result は model-visible JSON として返し、次に `read_file` すべき対象を明示する。
7. 成功した `replace_content` / `apply_patch` の changed target は `readFiles` に追加して、同一 run 内の追編集を許可する。

### 実装候補ファイル
- `api/services/worker-tools/dispatcher.ts`
  - `readFilesChanged` を canonical path で返す。
  - successful mutation target も `readFilesChanged` に追加できるようにする。
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
  - worker tool 実行前の policy decision を呼ぶ。
  - block result を `NativeApiToolResult` に変換する。
- `api/services/tool-policy/tool-policy-gate.ts`
  - read-before-edit 判定を実装する場合はここに置く。
- `api/services/tool-policy/tool-manifest.ts`
  - metadata の不足があれば補う。

### 注意点
- `readFiles` は relative path / absolute path の表記揺れを吸収する canonical key にする。
- `read_file` の compressed result でも「読んだ」扱いにしてよい。ただし exact needle が必要な場合は block message で line range read を促す。
- Codex lane の挙動を変えない。native/API runner の worker tool 経路から先に入れる。
- path canonicalization は repo root 外への escape を許さず、既存 path policy と同じ repo root を使う。

### 検証
- 未読ファイルへの `replace_content` が block され、`read_file` 指示を返す。
- `read_file` 後の `replace_content` は通る。
- 未読既存ファイルを変更する `apply_patch` が block される。
- 新規ファイル作成 patch は通る。
- `apply_patch` 成功後、同じファイルへの追加 `replace_content` が通る。
- relative path と absolute path が混在しても同一ファイルとして判定される。

## Phase 2: large-read trimming

### 方針
NightWorkers には既に read compression があるため、little-coder の「先頭30行だけ返す」挙動をそのまま入れない。
代わりに、model capability と現在の prompt/history estimate に基づいて、read output の返却量を制御する。

### 実装内容
1. native/API runner の tool context に `readFileCache` を渡し、run 内 repeated read marker を有効化する。
2. `read_file` の compression metadata を native/API runner history と task event に残す。
3. `read_file` の default compression を local provider capability に応じて調整する。
   - small context: head / important lines / tail の summary を優先。
   - large context: 現行 summary のまま。
4. `startLine` / `endLine` 付き range read は原則 exact content として返す。
5. full read が safe prompt budget を超えそうな場合、model-visible result に次の誘導を入れる。
   - `search_files` で絞る。
   - `read_file` に `startLine` / `endLine` を指定する。
   - `fresh=true` は exact content が必要な場合だけ使う。

### 実装候補ファイル
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
  - run scoped tool context を作成し、turn をまたいで保持する。
- `api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher.ts`
  - `executeWorkerTool` に `toolContext` を渡す。
- `api/services/worker-tools/read-file.ts`
  - capability-aware compression threshold が必要な場合だけ引数を追加する。
- `api/services/worker-tools/output-compression/read-cache.ts`
  - small context 用の marker / instruction を調整する。

### 注意点
- 圧縮判断は model capability と連動させるが、別の prompt compaction 層を増やさない。
- read output compression は provider 実装に入れない。
- UI では「全量を読んだ」ように見せず、compressed / cached / ranged を区別する。
- compression result は model-visible content だけでなく、ledger 側にも metadata を残す。

### 検証
- 260 行超のファイルが default で compressed result になる。
- 同一 run の repeated full read は content を省略した marker になる。
- range read は指定範囲の numbered lines を返す。
- compression metadata が task event または native tool call record に残る。
- `fresh=true` または range read が必要な場面で、model-visible result がその使い分けを説明する。

## Phase 3: tool-call 崩れ復旧

### 方針
local LLM が native tool call ではなく本文中に tool call 風 JSON / fenced block / tag / Pythonic call を出した場合、即 `needs_human` にせず、1 回だけ復旧を試す。

### 検出対象
- fenced block: tool / json code fence
- XML 風: `<tool_call>{...}</tool_call>`
- bare JSON: `{ "name": "...", "input": {...} }`
- Liquid / LFM 系 Pythonic: `<|tool_call_start|>[Read(path='...')]<|tool_call_end|>`

### 実装内容
1. `api/services/structured-llm/tool-call-text-parser.ts` を追加し、本文から tool call 候補を抽出する pure function を作る。
2. `providerResult.toolCalls.length === 0` かつ `content` に候補がある場合、native/API runner が復旧 history item を追加する。
3. JSON / fenced / tag 系は、次 turn に「native tool call channel で同じ call を再発行せよ」という follow-up user history を追加する。
4. Liquid / Pythonic 系は、同じ nudge を繰り返さず、llama.cpp 側の chat template / tool parser 設定問題として diagnostic を残す。
5. 復旧試行は run 内で最大 1 回または形式ごとに 1 回に制限する。
6. 復旧失敗後は現行どおり `missing_tool_call` で停止するが、finalReport に検出した形式と次の設定確認点を含める。

### 実装候補ファイル
- `api/services/structured-llm/tool-call-text-parser.ts`
  - parse / repair の pure function を置く。
- `api/services/agent-runtime/native-api-runner/native-api-runner.ts`
  - `missing_tool_call` で停止する前に復旧判定する。
  - 復旧済みフラグを run state に持たせる。
- `api/services/agent-runtime/native-api-runner/native-api-tool-history.ts`
  - model-visible follow-up history item の rendering を置く。

### 注意点
- 抽出した tool call を NightWorkers 側で勝手に実行しない。
- provider の JSON 抽出 / schema 検証責務を増やさない。
- model-visible follow-up は日本語 prompt discipline を崩さず、native/API runner の system prompt 側に寄せすぎない。
- 復旧 history には抽出した arguments を短く表示し、長大な本文やログを再注入しない。

### 検証
- fenced JSON tool call を本文に返す fixture provider で、次 turn に再発行 nudge が入る。
- Liquid Pythonic call では nudge loop せず diagnostic を出す。
- 復旧試行が 2 回以上繰り返されない。
- tool call が正常に返った場合は復旧 path に入らない。
- malformed JSON の repair は unit test で固定し、実行 path では provider tool を直接呼ばない。

## Phase 4: local provider profile / live context detection

### 方針
local provider の context window、safe prompt budget、reserved output、max output、temperature、thinking depth を endpoint/model capability として扱う。
推論サーバの実 context window が取得できる場合は、静的設定より live probe を優先する。

### 実装内容
1. provider endpoint capability に local runtime profile を追加する。
   - `contextWindowTokens`
   - `safePromptBudgetTokens`
   - `reservedOutputTokens`
   - `maxOutputTokens`
   - `temperature`
   - `thinkingDepth`
2. Settings UI では local endpoint ごとに capability を見える化する。
3. llama.cpp compatible endpoint では `/props` から `default_generation_settings.n_ctx` を best-effort で probe する。
4. probe result は runtime diagnostics と provider health に出す。
5. native/API runner の provider request 作成時に resolved capability を記録し、read trimming と prompt budget metadata が同じ値を見るようにする。
6. probe 失敗時は静的 capability に fallback し、run は止めない。

### 実装候補ファイル
- `api/services/structured-llm/settings.ts`
  - endpoint/model capability schema を拡張する。
- `api/routes/settings-runtime.ts`
  - API schema と normalization を拡張する。
- `api/services/structured-llm/model-capability.ts`
  - static capability と live probe result の解決順を実装する。
- `api/services/structured-llm/provider-health.ts`
  - `/props` probe の result を health payload に含める。
- `src/modules/nightworkers/components/SettingsLlmPanel.tsx`
  - local endpoint capability の表示・編集 UI を追加する。
- `api/services/agent-runtime/native-api-runner/native-api-request-adapter.ts`
  - resolved capability を provider request diagnostics に渡せるようにする。

### 注意点
- live probe は短い timeout を持つ。
- `/v1` 配下ではなく server root の `/props` を見る。
- OpenAI / Azure には llama.cpp probe をしない。
- local provider の API key や base URL をログに秘密値として出さない。

### 検証
- local endpoint の `/props` が `n_ctx` を返すと capability に反映される。
- `/props` が失敗しても静的 capability で run が継続する。
- provider health response に live context と static context の区別が出る。
- native/API runner usage metadata に resolved capability が残る。
- OpenAI / Azure endpoint では `/props` probe が走らない。

## 実装順
1. Phase 0 で現行経路と未コミット差分の影響を確認する。
2. Phase 1 の read-before-edit / write guard を先に入れる。
3. Phase 2 で read output と prompt budget の連動を調整する。
4. Phase 3 で `missing_tool_call` 前の tool-call text recovery を入れる。
5. Phase 4 で local provider profile と live context probe を入れる。

この順にする理由は、workspace mutation の事故防止が最優先であり、その次に context overflow、次に local tool-call 崩れ、最後に provider capability の精度改善が来るため。

## PR 分割

### PR 1: worker tool guard
- Phase 1 のみ。
- native/API runner の worker tool 境界に read-before-edit enforcement を追加する。
- provider / Settings UI には触れない。

### PR 2: read output compression
- Phase 2 のみ。
- run scoped read cache と compression metadata の記録を追加する。
- provider capability schema 変更は入れない。既存 capability から読める値だけを使う。

### PR 3: tool-call text recovery
- Phase 3 のみ。
- parser と native/API runner の 1 回復旧を追加する。
- 抽出 call の代理実行は実装しない。

### PR 4: local provider capability
- Phase 4 のみ。
- Settings / provider health / model capability / request diagnostics をまとめて変更する。
- 既存 Settings 関連差分がある場合は、先にその差分の意図を確認してから触る。

## テスト計画

### Unit tests
- `tool-policy` または `native-api-tool-dispatcher` 周辺で read-before-edit block / allow をテストする。
- `read-file` / `output-compression` 周辺で compressed / cached / ranged read をテストする。
- `tool-call-text-parser` で fenced / tag / bare JSON / Liquid Pythonic の抽出をテストする。
- `model-capability` / `provider-health` で static capability / live context probe / probe failure fallback をテストする。

### Integration tests
- native/API runner fixture provider で、未読 `replace_content` が block されることを確認する。
- `missing_tool_call` 直前に text tool call がある場合、1 回だけ recovery turn に進むことを確認する。
- local endpoint health で `/props` 成功・失敗の両方を確認する。

### Manual smoke
- local LLM implementation route で小さな既存ファイル変更を走らせ、`read_file` -> edit tool の順になることを確認する。
- 大きいファイルを読み、compressed / range read の表示が UI と model-visible output で矛盾しないことを確認する。
- local LLM host の `/props` を止めた状態でも run が止まらないことを確認する。

## 受け入れ条件
- native/API runner の local implementation run で、未読既存ファイルの編集が worker tool 境界で止まる。
- 大きなファイルの full read が prompt budget を不必要に消費しない。
- tool call が本文に漏れた場合、少なくとも 1 回は native tool call への復旧を促す。
- local endpoint の context window が静的設定または live probe のどちら由来か追跡できる。
- contextStill skill / knowledge injection は実装対象に含まれていない。
