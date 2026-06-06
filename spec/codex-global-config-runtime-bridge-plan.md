# Codex Global Config Runtime Bridge 実装計画

Status: draft

## 背景

Codex provider を `ACTIVE_LLM_PROVIDER=codex` で supervisor の decision 生成に使うと、global Codex 設定や `AGENTS.md` の影響で Codex SDK が native activity を始める場合がある。実際に `logs/llm-trace.jsonl` では `codex.mcp_tool_call` が発生し、`Provider activity rejected: codex.mcp_tool_call` として intake が失敗していた。

この拒否自体は正しい。NightWorkers では provider を API 的な LLM decision 生成に限定し、MCP、hooks、ファイル編集、コマンド実行を provider subprocess に実行させない。ただし、global MCP 設定、global hooks、`AGENTS.md` を無視するのも本来の利用感とずれる。したがって、global Codex 設定は Codex provider に直接読ませるのではなく、NightWorkers runtime が明示的に読み取り、既存の MCP manager、hook runner、supervisor prompt context に橋渡しする。

## 基本方針

- Codex provider は structured decision 専用に保つ。
- Codex SDK stream 上の `mcp_tool_call`、`command_execution`、`file_change` は引き続き拒否する。
- global Codex 設定は NightWorkers runtime の入力として扱う。
- MCP 実行は `mcp_call_tool` と MCP manager の ledger 経由に限定する。
- hooks 実行は NightWorkers の hook runner 経由に限定する。
- `AGENTS.md` は prompt / runtime guidance と lifecycle directive に分け、native Codex agent の行動開始条件として扱わない。
- prompt 文言は既存方針どおり日本語を維持する。

## Non-goals

- Codex SDK provider subprocess に global MCP server を登録して実行させない。
- Codex SDK provider subprocess に global hooks を実行させない。
- global MCP 設定を使うためにユーザーへ NightWorkers settings へのコピーを要求しない。
- `AGENTS.md` の全文を未分類のまま provider prompt に投入しない。
- provider 側で発生した native activity を worker の実行証拠として扱わない。

## 対象ファイル

- `api/services/supervisor/llm-provider/codex.ts`
  - provider subprocess の isolation と native activity rejection を維持する。
- `api/services/mcp/mcp-settings.ts`
  - app-local MCP settings と global Codex MCP settings を統合する effective settings 層を追加する。
- `api/services/mcp/mcp-client-manager.ts`
  - app-local ではなく effective MCP server list を参照できるようにする。
- `api/services/hooks/hooks-settings.ts`
  - app-local hooks と global Codex hooks を統合する effective hooks 層を追加する。
- `api/services/hooks/hooks-runner.ts`
  - default hook source を effective hooks に切り替える。
- `api/services/supervisor/prompt.ts`
- `api/services/supervisor/user-context.ts`
  - `AGENTS.md` 由来の runtime guidance を provider に渡す位置を整理する。
- `api/services/codex-global-config/`
  - global Codex 設定の読み取り、正規化、診断を新規 service として追加する。

## 新規 service 構成

`api/services/codex-global-config/paths.ts`

- `CODEX_HOME` があればそれを使い、なければ `~/.codex` を解決する。
- provider subprocess 用の isolated `CODEX_HOME` とは分離する。
- test では `NIGHTWORKERS_CODEX_HOME` のような明示 env で差し替え可能にする。

`api/services/codex-global-config/config-loader.ts`

- `config.toml` と必要な周辺ファイルを読み取る。
- TOML は既存依存があればそれを使い、なければ小さい TOML parser 依存を追加する。正規表現ベースの ad hoc parser は使わない。
- 読み取り失敗や schema 不一致は diagnostics として返し、supervisor intake 全体を落とさない。
- secret 値は diagnostics や log に出さない。

`api/services/codex-global-config/mcp-bridge.ts`

- global Codex の `mcp_servers` / `mcpServers` 形式を NightWorkers の `McpServerConfig` 相当に正規化する。
- `source: 'codex_global'` のような source metadata を付ける。
- app-local settings と衝突する `toolPrefix` は app-local を優先し、global 側は diagnostic にする。
- 認証付き MCP server は、現行 schema が安全に扱えない場合は無視せず warning diagnostic にする。
- global MCP server は read-only source として扱い、UI から直接編集しない。

`api/services/codex-global-config/hooks-bridge.ts`

- Codex hooks の実フォーマットをローカル設定または公式仕様で確認してから対応する。
- NightWorkers の `AgentHookConfig` に安全に変換できる command/http hook のみ取り込む。
- 変換できない hook は warning diagnostic にする。
- hook の block / deny / additionalContext semantics は既存 `hooks-runner.ts` の挙動へ寄せる。

`api/services/codex-global-config/agents-guidance.ts`

- global `~/.codex/AGENTS.md` と project root 側の `AGENTS.md` / `AGENT.md` を読み取る。
- 指示を次に分類する。
  - prompt guidance: supervisor decision に渡せる運用方針。
  - lifecycle directive: `initial_instructions` のように runtime 側で一度だけ実行、または状態管理すべき指示。
  - unsupported directive: Codex native agent 前提で NightWorkers に対応先がない指示。
- lifecycle directive は provider prompt にそのまま渡さず、NightWorkers の startup / project lifecycle 側で扱う。
- unsupported directive は diagnostics に出し、固定の失敗文へ差し替えない。

## 実装フェーズ

### Phase 0: 現状再現と境界テスト

- fake `CODEX_HOME` に global MCP server と `AGENTS.md` を置く test fixture を作る。
- `AGENTS.md` に `initial_instructions` MCP tool 実行指示がある状態でも、Codex provider decision call が native `mcp_tool_call` を発生させないことを確認する。
- provider stream 上に synthetic `mcp_tool_call` が来た場合は、現在どおり拒否され、server / tool 名が diagnostic に残ることを確認する。

### Phase 1: global config loader

- `codex-global-config` service を追加する。
- `config.toml` 読み取り、`AGENTS.md` 読み取り、diagnostics 集約を実装する。
- secrets を log しない redaction helper を追加する。
- loader は runtime 用であり、`llm-provider/codex.ts` から直接使わない。

### Phase 2: MCP effective settings

- `listMcpServers()` は既存互換の app-local list として維持する。
- `listEffectiveMcpServers()` を追加し、app-local と global Codex MCP を merge する。
- `readEffectiveMcpServerSettings()` のような diagnostics 付き API を追加する。
- `mcp-client-manager.ts` と `mcp_call_tool` の参照元を effective list に切り替える。
- app-local と global の衝突時は app-local を優先する。
- global source の server は delete / update 対象にしない。

### Phase 3: hooks effective settings

- `listAgentHooks()` は既存互換の app-local list として維持する。
- `listEffectiveAgentHooks()` を追加し、app-local hooks と global Codex hooks を merge する。
- `hooks-runner.ts` の default source を effective hooks に切り替える。
- `updateAgentHookLastRun()` は app-local hooks のみを永続更新する。global hook の lastRun は runtime event / diagnostic として扱う。
- block / deny hook の挙動は provider ではなく runtime で発火することを test する。

### Phase 4: AGENTS guidance bridge

- project 起動時または task intake 前に effective AGENTS guidance を解決する。
- supervisor prompt には prompt guidance の要約を渡す。
- `initial_instructions` のような一度だけ実行する指示は project lifecycle state で管理する。
- lifecycle directive が MCP tool を必要とする場合は、NightWorkers の MCP manager 経由で明示実行する。
- `AGENTS.md` の指示で provider subprocess に native action を開始させない。

### Phase 5: Codex provider hardening

- Codex provider subprocess は isolated `CODEX_HOME` を使い続ける。
- auth に必要な最小ファイル以外は provider home にコピーしない。
- parent process の Codex desktop / CLI internal env は provider subprocess に渡さない。
- `features.mcp=false` と空の `mcp_servers` を維持する。
- provider stream で native activity が発生した場合は拒否し、message には provider activity 名、server、tool を残す。
- user-facing failure は固定の安心文へ置き換えず、到達できた LLM 本文がある場合は保持する。

### Phase 6: UI と diagnostics

- Settings / diagnostics surface に effective MCP / hooks source を表示する。
- `nightworkers_settings` と `codex_global` を区別して表示する。
- global source は read-only と明示する。
- unsupported auth fields、parse failure、toolPrefix collision、unsupported hook format を warning として表示する。
- secret 値、token、header は表示しない。

### Phase 7: verification

- unit tests
  - global MCP server が app-local settings なしで effective list に出る。
  - app-local `toolPrefix` が global と衝突した場合、app-local が優先され warning が出る。
  - auth field を含む global MCP server は warning になり、secret 値は出ない。
  - global hook が compatible format の場合、effective hook として hook runner に渡る。
  - unsupported global hook は warning になり、hook runner へ渡らない。
  - `AGENTS.md` の `initial_instructions` は provider prompt へ raw 注入されない。
  - provider stream の `mcp_tool_call` は拒否される。
- integration tests
  - global MCP server 由来の tool を `mcp_call_tool` から呼べる。
  - global hook が runtime hook runner 経由で発火する。
  - fake global `AGENTS.md` が存在しても `ACTIVE_LLM_PROVIDER=codex` の Round 1 decision が JSON を返す。
- manual / gated live check
  - 実 Codex provider で、global `AGENTS.md` に `initial_instructions` 指示がある状態でも native `mcp_tool_call` が発生しない。
- final gate
  - `pnpm verify`

## ロールアウト

1. 現在の provider isolation は維持する。
2. global config loader を runtime 側に追加する。
3. MCP effective settings を先に導入し、global MCP が worker tool 経由で使えることを確認する。
4. hooks effective settings を導入する。
5. AGENTS guidance bridge を導入する。
6. diagnostics UI を追加する。
7. `LLM intake failed: Provider activity rejected: codex.mcp_tool_call` の再発テストを CI / verify に入れる。

## リスクと対策

- Codex hooks の実フォーマットが固定でない可能性がある。
  - 対策: 実装前にローカル実設定と仕様を確認し、変換できる subset だけを supported とする。
- global MCP に secret-bearing auth 設定が含まれる可能性がある。
  - 対策: 現行 schema で安全に扱えない場合は warning diagnostic にし、secret を log しない。
- `AGENTS.md` が Codex native agent 前提の指示を含む可能性がある。
  - 対策: prompt guidance / lifecycle directive / unsupported directive に分類し、provider prompt へ raw 注入しない。
- app-local と global の同名 toolPrefix が衝突する可能性がある。
  - 対策: app-local を優先し、global 側を diagnostic に出す。

## 完了条件

- global Codex MCP 設定を NightWorkers settings にコピーしなくても、NightWorkers の MCP manager から利用できる。
- compatible な global hooks が NightWorkers hook runner から実行される。
- `AGENTS.md` の lifecycle directive が NightWorkers runtime で扱われ、Codex provider native activity を誘発しない。
- `ACTIVE_LLM_PROVIDER=codex` の supervisor intake が global `AGENTS.md` / MCP 設定の存在で `codex.mcp_tool_call` 失敗を起こさない。
- provider subprocess は引き続き decision-only で、native activity を worker evidence として扱わない。
- diagnostics に source、warning、unsupported reason が残り、secret は出ない。
- `pnpm verify` が通る。
