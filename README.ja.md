# NightWorkers

<img src="assets/brand/nightworkers-logo-icon-64.png" alt="NightWorkers logo" width="64" height="64" />

[English](./README.md) | [日本語](./README.ja.md)

NightWorkersは、coding agentの作業を、検証可能な開発ライフサイクルとして運用するためのローカルファーストなコントロールプレーンです。対象repository、計画artifact、実行権限、隔離されたGit workspace、Queue状態、tool activity、検証、review、closeout判断を、永続化されたローカル状態として管理します。

agentに処理を継続させながら、repositoryを追跡不能なbackground jobにしないことを重視しています。Taskは停止状態から始まり、ユーザーがMission Pilotを明示的に開始・停止し、各gateで使われた永続証跡を確認できます。

## 内容

- [製品全体の流れ](#製品全体の流れ)
- [NightWorkersが必要な理由](#nightworkersが必要な理由)
- [向いている用途](#向いている用途)
- [実装済み機能](#実装済み機能)
- [Local StateとTrust Boundary](#local-stateとtrust-boundary)
- [Runtime設定](#runtime設定)
- [Quick Start](#quick-start)
- [Credential-Free Demo](#credential-free-demo)
- [Desktop Application](#desktop-application)
- [検証](#検証)
- [運用・開発コマンド](#運用開発コマンド)
- [Architecture](#architecture)
- [現在の制約](#現在の制約)
- [Documentation](#documentation)
- [Source-of-Truth Map](#source-of-truth-map)

## 製品全体の流れ

```text
Project Folder
  -> Goal / Evaluation / Quality finding / direct Task
  -> Mission Pilot（既定は停止）
  -> Playによる権限付与
  -> Questionnaireと選択されたPlan artifact
  -> Artifact reviewと対象を絞った修正
  -> review済みQueue handoff
  -> Task専用branchとworktree
  -> implementation
  -> Test Mode evidence
  -> Review decisionと必要に応じたrework
  -> Security Oracle evidenceまたはpolicy skip
  -> 保存済みGit policyに従うcommit / merge / push
  -> completionとarchive
```

すべてのTaskが必ず最後まで到達するという意味ではありません。証跡不足、古いcontext、検証失敗、blocking finding、Git conflict、または明示的なStopがある場合、Taskは確認可能なwaiting／attention状態へ移ります。

## NightWorkersが必要な理由

coding agentは変更の生成には有用ですが、長時間の開発workflowには最終chat message以上のものが必要です。NightWorkersは、次の運用状態を明示します。

- どのローカルProject Folderが作業対象か
- どのTaskとcontext revisionが作業を許可したか
- どのPlan artifactが生成・reviewされたか
- どのbranchとworktreeが実装を所有するか
- どのtool、command、Todo、diff、testが記録されたか
- Test、Review、security、Git integrationのgateが通過したか
- 何が停止・失敗・変更し、どの人間判断が残っているか
- provider call、token、処理時間、推定costがどれだけ記録されたか

単なる自律コード生成ではなく、ローカルのexecution ledgerに裏づけられたhuman-governed autonomyであることがNightWorkersの違いです。

## 向いている用途

NightWorkersは、次の用途に適しています。

- ローカルrepositoryに対するcoding-agent作業を運用したい
- 計画、権限付与、実装、検証、reviewを別々の永続状態として扱いたい
- 介入時間の終了後は処理を継続させつつ、実際に機能するStop境界を維持したい
- review済み実装をTask専用Git worktreeへ隔離したい
- commit、merge、push、完了、archiveの前に証跡を確認したい
- Project evaluation、quality、usage、処理時間、推定costを時系列で比較したい
- provider routing、MCP server、hook、security toolingを一つのローカル操作面で扱いたい

hosted team SaaS、browser-only onboarding、分散multi-host scheduling、pull requestやdeployの自動作成、同じrepository workspaceで複数agentを競合実行させる用途には適していません。

## 実装済み機能

### Mission Pilot

Taskを作成しただけではMission Pilotは起動しません。初回のPlay時にMission Pilot sessionが作成されます。初めて使う場合は[操作ガイド](./spec/first-run-orientation.md)を参照してください。

Playを押すと、その時点のTask contextに対するversion付きauthorization snapshotが作成されます。保存される権限は、planning、Queue admission、implementation、test mutation、review、local commit、Task completion、Task archiveを対象とします。pushの動作は保存済みpush policyに従います。

現在のMission Pilotは次を提供します。

- optimistic version check付きの明示的なPlay／Stop
- 無人継続前の介入時間を示すカウントダウン
- 永続化されたcontext revisionとdigest
- answer provenanceを持つ編集可能なQuestionnaire draft
- 承認済みcheckpointを再生成しないresumable Plan progress
- routingで選択されたPlan artifact
- 現在のartifact一式に対するstructured review
- review問題を起こしたartifactに対象を絞るcorrection
- Implementation Queueへのreview済み・idempotent handoff
- Queue後のimplementation、Test、Review、rework、closeout、recovery
- Mission Pilotとその所有runの永続eventを読むPilot Thought

Mission Pilotは、流暢なmodel responseを完了証拠にしません。Queue admissionには、現在のreview済みcontextと必要なartifactが求められます。TestとReviewはそれぞれ独立した永続recordを使い、後続変更によって古いevidenceが無効になる場合があります。

### Task専用Git Workspace

NightWorkersは、Git worktreeを製品画面としても実行境界としても管理します。

ProjectのWorktrees画面では、次を実行できます。

- base worktreeとlinked worktreeの一覧表示
- branch、HEAD、最新commit、upstream、ahead／behind、file状態件数の表示
- 使用中のTask／Run件数の表示
- 新規branchまたは既存branchからのworktree作成
- worktree diffの表示
- 対応可能な場合、変更破棄の明示確認を伴うworktree削除
- `git worktree prune`のpreviewと実行
- base worktreeや破棄不能blockerを持つworktreeの削除防止

review済みMission Pilot pathでは、source branch、merge target、base SHA、expected HEAD、worktree identity、materialization source、policy snapshotを持つTask専用Git workspaceを記録します。既存Git repository、starter template、Git importには明示的なmaterialization contractがあります。空Projectでは、実装前に独立したrepository-bootstrap phaseを実行できます。

Reviewでは、暗黙にmergeせずintegration判断を表示します。現在のGit integration contractは次をサポートします。

- merge preview
- defer／rework判断
- merge commit、squash、fast-forward-only
- 任意のsource-push requirement
- manualまたはafter-mergeのtarget-push policy
- 任意のexternal-CI gate
- 古いpreview evidenceを無効にするmerge-target変更
- merge recordに保存されるconflict／already-integrated状態

direct executionやlegacy pathには、同じTask workspace recordがない場合があります。上記のTask専用workspace説明は、review済みMission Pilot／Queue pathを対象とします。

### Project Intelligence

Project Detailは単なるrepository選択画面ではありません。現在は6つのviewを持ちます。

| View | 現在の動作 |
| --- | --- |
| Overview | Project metadata、repository snapshot、最近のTask状態、Project別toolへのnavigation。 |
| Mission | Mission／Task Generation。Goal、Mission、proposal、Task candidateを管理し、選択したcandidateを実行可能Taskへ変換。 |
| Evaluation | 固定されたproduct／engineering評価軸によるLLM evaluation、履歴比較、evidence／confidence、改善案生成、Task作成。 |
| Quality | Unit／coverageとE2E capabilityの検出、managed run、coverage file確認、coverage改善Task作成。 |
| Tech Stack | Project／Task planning画面で利用する検出済みstack profile。 |
| Worktrees | Git integration policy、worktree作成、状態、diff、削除、prune。 |

global OverviewはProjectと期間で絞り込めます。run件数、warning、provider／model usage、token区分、cache rate、処理時間、throughput、推定cost／credit、model内訳、高cost callを表示します。Project snapshotにはevaluationとcoverageの情報も含まれます。

### PlanningとReview可能なArtifact

Plan Modeは、すべての設計documentをすべてのTaskへ強制しません。Settingsで有効なcapabilityから、routing decisionが適用対象viewを選択します。

実装済みPlan画面は次のとおりです。

- Questionnaire
- Feature Plan
- App Blueprint／Blueprint Preview
- Data Model
- User Flow
- API I/O Contract
- Activity Flow
- Sequence Flow
- Zod Schema Design

QuestionnaireはMission PilotのPlan sequenceに必ず含まれます。その他のviewは、保存済みrouting decisionによりinclude／omitされます。既存artifactと承認済みQuestionnaire stateはresume可能なcheckpointです。

Blueprint Previewはvisual application structureとcanonical data modelingを分離します。preview controlはtheme、density、shape、shadow、font、contrast、motion、component variantを扱います。Blueprintとdesign-tokenのadoptionは、Taskとsource messageに紐づく明示的な判断として保存されます。adoption metadataがartifact本文を書き換えることはありません。

ArtifactはProject tree、source preview、diffと並べて確認できます。artifact画面が対応している場合、source-oriented outputとrender済み画像を書き出せます。

### WorkbenchとPrompt Input

Workbenchは、chat、planning、execution、artifact、reviewを扱うTask単位の操作面です。

現在は次をサポートします。

- 通常のWorkbench messageと明示的intent
- initial Task promptと後続message
- 件数、size、MIME、file signatureを検証するPNG／JPEG／WebP／GIFのprompt画像添付
- 永続化されたtask messageとartifact reference
- chat／intakeとrun eventを分離するActivity Transcript
- `runId`と`afterSeq` cursorによるrun event replay
- Todo state、tool outcome、policy block、diff、test、usage、final report
- URLで直接開けるOverview、Queue、Project Detail、Session、Task、Settings route

Repositoryへのwriteは、登録済みProjectまたは割り当て済みTask worktreeを基準に、登録済みworker-tool boundary経由で行われます。provider／Supervisor判断用のscratch directoryは、Project repositoryを変更した証拠として扱われません。

### Context ContinuityとExternal Evidence

NightWorkersには、性質の異なる2つのcontinuity pathがあります。

- built-in StateCard cacheはcompactなconversation contextを生成し、保存済みuser promptを書き換えずに最新cardをruntime requestへ注入できます。
- contextStill MCP serverが設定されている場合、native runtimeは`initial_instructions`、`context_compile`、`context_decision`、`compile_eval`、candidate registration procedureを認識し、その結果をrun ledgerとtranscriptへ記録します。

contextStillはNightWorkers内部の隠しstorageではなく、外部MCP capabilityです。利用可能性とTask固有procedure requirementにより、call不足がadvisoryになるかblockingになるかが決まります。credential-free demoは外部memory serviceを必要としません。

### Implementation Queue

通常のWorkbench conversationとqueued automationは別の状態です。Implementation Queueは次を提供します。

- implementation-readyな作業の明示的admission
- global／Project別Queue view
- 上限付きProcessor laneとcapacity setting
- TODO Workflow claim gate
- row作成とは別のclaim readiness
- 永続化されたqueued、active、attention、completed、archived状態
- 中断したMission Pilot作業のrecovery／reconciliation path

Mission Pilotは、repository／workspace準備中にheld Queue rowを作成できます。rowが存在するだけではclaim可能になりません。

### Test、Review、Security、Closeout

NightWorkersは次の責務を分離します。

| Boundary | 責務 |
| --- | --- |
| Implementation | Repository変更とimplementation evidence。 |
| Test Mode | Verification document、required checklist、managed evidence、`completion_check`。 |
| Review Mode | Review Run、structured finding、disposition、rework判断。 |
| Security Oracle | Scanner-backed security evidenceまたは保存済みpolicy skip。 |
| Git closeout | Evidence再検証、commit、merge判断、push-policy処理。 |

final reportは有用なevidenceですが、closeout gateそのものではありません。closeoutでは、active Test snapshot、対応するReview decision、Security Oracle状態、未解決blocking finding、ownership、Git状態も確認します。Reviewがfixを適用した場合、以前のTest evidenceは古くなり、再検証が必要です。

任意のvulnWorkbench integrationは、別途設定されたローカルvulnWorkbench checkoutを呼び出してscanner-backed security診断を実行します。未設定またはineligibleの場合、LLM-only concernをconfirmed vulnerabilityとして表示せず、unavailable／policy-skip状態を記録します。

Project詳細の脆弱性スキャンは、既定でローカルCLI接続を使用します。NightWorkersに登録済みの`localPath`を`vulnWorkbench` CLIへ直接渡すため、vulnWorkbench HTTP serverとservice tokenは不要です。CLIから取得した`quick`、`standard`、`deep` preset、Working tree差分／Project全体、allowlist済みの個別profile（source、dependency manifest、artifact、detailed）を選択できます。初回だけvulnWorkbench checkoutで`bun install`と`bun run db:migrate`を完了してください。別processまたは別hostのproviderを使う場合だけ、SettingsでHTTP provider接続へ切り替えます。

### Provider、Routing、MCP、Hook

structured reasoningとrepository executionは別のruntime concernです。

Settings UIでは現在、次を管理します。

- Azure OpenAI、OpenAI-compatible、AWS Bedrock、Codex SDK、local provider endpoint
- 有効modelとRoleごとのprovider／model routing
- native API runnerまたはCodex SDKのimplementation runtime lane
- provider smoke testとnormalized usage記録
- General settings、language、timezone、currency、FX source、retention
- Plan Mode capabilityとappearance
- Project Security Intelligenceとontology-tool eligibility
- MCP server
- Agent Hook

MCP settingsは、stdio、Streamable HTTP、legacy SSE-compatible connection、paste import、tool discovery、connection test、ON／OFF状態をサポートします。現在のsettings contractは、authentication header、API key、bearer token、cookie、secret-like environment entryを拒否します。MCP tool executionはworker-tool evidence path内に残ります。

project exploration pilotには、app-managedなvulnWorkbench MCP server登録が必要です。tool discoveryで`vuln_prepare_project_intelligence`、`vuln_get_project_intelligence_status`、`vuln_get_project_exploration_catalog`の3 toolが見えることを確認してください。MCP processには`STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS`の明示的なallowlistを設定します。未設定時はfail-closedです。repositoryの`featureSettings`に置くsibling settingは次のexact shapeで、既定はoffです。

```json
{
  "projectExplorationCatalog": {
    "enabled": false,
    "mcpServerId": null
  }
}
```

controlled pilotでのみ`enabled`を`true`にし、`mcpServerId`へapp-managedなvulnWorkbench server IDを設定します。NightWorkersは登録済みrepository pathからintelligenceを準備し、vulnWorkbench内部IDをrun連携キーとして保存しません。coding agentにはfocusだけを受け取る`project_exploration_catalog`を公開します。対応範囲はnative/API implementation laneだけです。Codex SDK、planning、test、review、general-answer laneは変更せず、preparation、freshness、MCP失敗時はfail-openで既存探索へ戻ります。

Agent Hookは、`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`Stop`などのtool／session lifecycle eventに対するcommand／HTTP actionをサポートします。Hook executionは専用runnerを使い、statusを保存し、failure summaryをredactします。worker command toolを再帰的には呼びません。

## Local StateとTrust Boundary

development時の既定runtime rootは次です。

```text
<nightWorkers checkout>/.nightworkers/
```

Runtime pathは必要に応じてこのroot配下へ割り当てられます。desktop bootstrapは管理対象subdirectoryを作り、development serviceは使用するpathを作成します。

```text
.nightworkers/
  sqlite.db
  settings/    # 使用時のintegration setting／compatibility file
  logs/        # managed runtime log
  artifacts/   # 使用時のattachment file／runtime artifact
```

通常、`DATABASE_URL`は`.nightworkers/sqlite.db`向けに自動生成されるため、標準development／desktop flowでは指定不要です。testは隔離されたdatabaseを使用します。Application settingはSQLiteへ保存され、一部integration serviceは`settings/`配下のcompatibility fileも利用します。Desktop buildはruntime data rootを解決し、`NIGHTWORKERS_RUNTIME_DIR`で上書きできます。

登録済みProjectの作業はProject repositoryまたはTask worktreeを基準にします。NightWorkers runtime fileは、そのexecution rootにおけるrepository変更、commit、verificationの代わりにはなりません。

Provider requestには、user request、Supervisor instruction、derived StateCard context、artifact／Task context、tool result summaryが含まれる場合があります。そのためraw LLM traceには機微なrepository情報が含まれ得ます。production credentialや機微なrepositoryを接続する前に[Trust Model](./spec/trust-model.md)を確認してください。

既定のretention settingは次のとおりです。

| Data | 既定の保持期間／上限 |
| --- | --- |
| API log | 7日 |
| Raw LLM trace／parse preview | 3日 |
| Usage data | 30日 |
| Retention audit event | 90日 |
| Managed runtime log directory | 合計80 MiB |

設定された容量上限に達した場合、保持期間内でもclosed log segmentが削除されることがあります。

serverはlocal-onlyで、loopback addressだけへbindできます。NightWorkers自体はaccount、user profile、login session、product OAuthを保持しません。外部LLM／integration providerのcredentialは別のlocal settingとして扱い、各providerへの接続にだけ使用します。

## Runtime設定

Server、provider、routing、integration、general application settingはSettings UIで管理し、ローカルに保存します。Environment variableはbootstrapと明示的runtime overrideに使用できます。

| Variable | 現在の役割 |
| --- | --- |
| `NIGHTWORKERS_RUNTIME_DIR` | managed runtime rootを上書き。 |
| `HOST` / `PORT` | API listen address／port。`HOST`はloopback限定で、既定bindは`127.0.0.1:39173`。 |
| `CONVERSATION_CONTEXT_ENABLED` | derived conversation contextのmaster switch。既定は有効。 |
| `CONVERSATION_CONTEXT_STATE_CARD_ENABLED` | 最新compact StateCardをruntime requestへ注入。 |
| `CONVERSATION_CONTEXT_BUILD_ON_IDLE` | intake／run completion後にderived contextを更新。 |
| `NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN` | deterministic maintenance／test用に自動Queue drainを無効化。 |
| `NIGHTWORKERS_VULNWORKBENCH_CWD` | 任意security integrationが使うローカルvulnWorkbench checkoutを指定。 |

livenessは`/api/health/live`、readinessは`/api/health/ready`、OpenAPI documentは`/api/doc`、Swagger UIは`/api/ui`で提供します。

詳細は[Runtime Configuration](./spec/configuration.md)を参照してください。

## Quick Start

### 必要環境

- Bun 1.3.x（現在のCIはBun 1.3.14）
- Git
- bundled backend／desktop sidecar用のNode.js 20互換tooling
- Tauri packaging用のRust 1.77.2以降と対象OSのbuild dependency

### Browser development

```bash
bun run setup
bun run dev
```

`setup`はdependencyをinstallし、`.env`が存在しない場合だけ作成し、migrationを実行します。次を開いてください。

```text
http://localhost:39174
```

live providerを使う前に、次を行います。

1. Settingsを開く。
2. provider endpointとmodelを設定し、有効化する。
3. Role Routingを設定する。
4. implementation runtime laneを選択する。
5. provider smoke testを実行する。

### 最初の実workflow

最初は破棄可能なGit repositoryを使用してください。

1. repository rootをProject Folderとして登録する。
2. OverviewとProject Detail tabを確認する。
3. read-onlyなinitial requestでTaskを作成する。
4. Mission Pilotが停止状態であることを確認する。
5. Playを押し、介入カウントダウンを確認する。
6. Questionnaire answerと生成されたPlan artifactをreview／編集する。
7. Plan review、focused correction、workspace preparation、Queue admissionを確認する。
8. Pilot Thought、Activity Transcript、割り当て済みworktree、Run evidenceを確認する。
9. Test、Review、security、Git evidenceが一致するまで変更をintegrationしない。

Mission PilotのStopは実際のlifecycle actionです。すでに永続化されたcontext、artifact、evidenceは削除しません。

## Credential-Free Demo

deterministicな[Support Ops CRM demo](./demo/support-ops-crm/README.md)は、provider credentialなしで使い捨てGit Projectを作成し、Plan／Queue状態を記録し、固定変更を適用し、実testを実行し、Review evidenceを書き込みます。

```bash
bun run demo:setup
bun run demo:run
```

`.nightworkers-demo/evidence/review.json`を確認した後、生成されたdemo stateを削除します。

```bash
bun run demo:reset
```

`bun run demo:smoke`は、CIで使用するsetup、execution、assertion、resetの全lifecycleを実行します。

deterministic demoが証明するのは、ローカル状態とevidence pathです。live providerを実行せず、すべてのMission Pilot branchが正常であることまでは証明しません。

## Desktop Application

NightWorkersには、frontendを起動し、bundled Node backend sidecarを管理するTauri shellがあります。

```bash
bun run desktop:dev
bun run desktop:build
bun run desktop:smoke
```

現在のmacOS build targetは`.app`です。DMG作成は別commandです。

```bash
bun run desktop:build:dmg
```

Linux／Windows bundle commandは、それぞれのnative build host向けに定義されています。

```bash
bun run desktop:build:linux
bun run desktop:build:windows
```

Linuxは`.deb`、`.rpm`、AppImage、Windowsはx64 NSIS、MSIを対象にします。現在の限定βサポート対象はmacOS ARM64で、Linux / Windowsはnative installerとclean環境の起動・終了smokeが成功するまでsupportedとは表記しません。native artifactを生成せずにcross-platform設定を確認できます。

```bash
bun run desktop:check:cross-platform
```

signing／notarizationには実際のplatform credentialが必要であり、通常buildでsimulateされることはありません。

## 検証

NightWorkersは、deterministicなlocal gateと任意のlive-provider checkを分離します。

| Command | 範囲 |
| --- | --- |
| `bun run verify:base` | lightweight base gateの明示的entry point。 |
| `bun run verify` | tracked artifact、TypeScript、Biome、Supervisor regressionを実行するlightweight base gate。 |
| `bun run verify:fast` | base gateのalias。 |
| `bun run verify:e2e` | credential-free Playwright smoke gate。 |
| `bun run verify:audit` | High／Critical dependency policy。 |
| `bun run verify:desktop` | Desktop runtime test、Rust check、build、sidecar smoke、packaged-app smoke。 |
| `bun run verify:full` | test、E2E／accessibility、demo、audit、desktop gateを含むdeterministicな完全suite。 |
| `bun run verify:live` | 明示的external-provider canary。設定・有効化されていない場合はskip。 |
| `bun run verify:release` | Release metadata、deterministic verification、demo、dependency、desktop release gate。 |

用途を絞ったcommand:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:coverage
bun run test:e2e
bun run test:e2e:smoke
bun run test:e2e:agent-outcome
bun run test:e2e:agent-live
bun run check:architecture
bun run check:docs
```

`check:docs`は、登録documentの存在、local link／anchor、文書化された`bun run` command、選択された完了planのarchive ruleを検証します。本文が現在の実装と一致するかまでは証明しないため、意味内容のdocument reviewは別途必要です。

live-provider testは通常のdeterministic gateに含まれません。`verify:live`は対応するenable flagとcredentialが存在する場合だけ実行します。

## 運用・開発コマンド

| Command | 目的 |
| --- | --- |
| `bun run build` | frontend／backend bundleをbuild。 |
| `bun run start` | `build`後のproduction backend bundleを起動。 |
| `bun run db:generate` | schema変更後にDrizzle migration fileを生成。 |
| `bun run db:migrate` | active runtime databaseへDrizzle migrationを適用。 |
| `bun run db:studio` | Drizzle Studioを起動。 |
| `bun run cleanup:test-data:dry-run` | ローカルのTEST-prefix data削除をpreview。 |
| `bun run cleanup:test-data` | 対象を限定したTEST-data cleanupを実行。 |
| `bun run release:check` | package、Tauri、changelog、release note、tag、任意manifest metadataを検証。 |
| `bun run release:manifest` | verification後のartifact checksumとsigning／notarization metadataを生成。 |
| `bun run release:create` | dry runまたは明示的annotated tag作成前にrelease checkを実行。 |
| `bun run desktop:prepare-sidecar` | packaged backend sidecarをbuild／stage。 |
| `bun run desktop:smoke-sidecar` | staged sidecarをsmoke test。 |
| `bun run desktop:lint` | cross-platform metadata、Rust format、Clippyを検証。 |
| `bun run desktop:sign` | platform credentialがある場合にdesktop artifactをsign／verify。 |

## Architecture

| Layer | 現在の実装 |
| --- | --- |
| API | `api/`配下のHono + TypeScript |
| Web UI | `src/`配下のReact、Vite、TanStack Router |
| Desktop | `src-tauri/`配下のTauri shellとbundled Node backend sidecar |
| Persistence | Drizzle ORMとSQLite／libSQL schema／migration |
| Shared contract | `shared/schemas/`配下のZod schema |
| Runtime evidence | Task、Mission Pilot、Queue、event、Todo、artifact、verification、review、usage、Git record |
| Repository mutation | 登録済みProject rootまたはTask worktreeを対象にするworker-tool boundary |

主要module familyにはMission Pilot、NightWorkers Task／Run orchestration、Queue、Git worktree、Review、Project Evaluation、Quality、Task Generation、Plan Mode、Blueprint、Data Model、Overview、Settings、Ontology、MCP、Agent Hookがあります。

詳細なboundaryは[Architecture and Module Boundaries](./spec/architecture.md)を参照してください。このdocumentと実行可能contractが一致しない場合は、schema、route definition、migration、test済みservice pathを現在のruntime truthとして扱い、documentを更新してください。

## 現在の制約

- NightWorkersはローカルかつ主にsingle-user向けのcontrol planeであり、hosted collaboration serviceではありません。
- pull request作成、application deploy、release公開、desktop package提出を自動実行しません。
- Git mergeは、明示的かつevidence-backedなReview actionとして実装されています。無条件のbackground side effectではありません。
- Processorを並列実行できても、複数agentが同じworktreeで競合してよいわけではありません。隔離はTask workspace ownershipとclaim gateに依存します。
- Queue／local runtimeは分散multi-host schedulerではありません。
- live providerの動作は、設定されたservice、credential、model、network、provider policyに依存します。
- 現在のMCP settings contractはMCP authentication secretをサポートしません。
- 任意のSecurity Oracle／ontology extensionには、eligibleかつ別途設定されたローカルvulnWorkbench integrationが必要です。
- contextStill procedureには設定済みcontextStill MCP serverが必要です。deterministicなproduct／demo baselineには必須ではありません。
- pricing、usage、FX dataが利用できない場合、推定costは不完全です。
- 成功したfinal report、model response、既存Queue rowのいずれも、それだけでは完了を証明しません。
- `spec/docs/.archived/`のdocument planはhistorical evidenceであり、現在のuser contractではありません。この隠しdirectoryは通常のLLM file探索から除外し、明示的に履歴調査を依頼された場合だけ読みます。

## Documentation

- [Feature Tour](./spec/feature-tour.md)
- [First Run Orientation](./spec/first-run-orientation.md)
- [Architecture and Module Boundaries](./spec/architecture.md)
- [Runtime Configuration](./spec/configuration.md)
- [Trust Model](./spec/trust-model.md)
- [Adoption Checklist](./spec/adoption-checklist.md)
- [E2E Testing Policy](./spec/e2e-testing-policy.md)
- [Release Notes](./spec/release-notes/0.1.0.md)
- [Changelog](./CHANGELOG.md)
- [Security Policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

作業中の設計書はHTML fragmentとして`spec/docs/`に置き、永続的なproduct referenceは引き続き`spec/`直下のMarkdownに置けます。完了したimplementation planは`spec/docs/.archived/`へ移動します。`bun run docs`で両方を閲覧し、`bun run docs:check`で検証できます。どちらの場所も、そのdocumentが自動的に現在のproduct guaranteeになることを意味しません。

## Source-of-Truth Map

READMEの記述を検証する場合は、次が起点になります。

| 記述対象 | 実行可能なsource |
| --- | --- |
| Task lifecycle／Mission Pilotのlazy activation | `api/modules/nightworkers/nightworkers.basic.service.ts`、`packages/mission-pilot/src/backend/runtime/mission-pilot.service.ts` |
| Mission Pilot state／authorization | `packages/mission-pilot/src/contracts/mission-pilot.schema.ts`、`packages/mission-pilot/src/backend/runtime/mission-pilot-delegation.ts` |
| Mission Pilot SQLite ownership／package専用persistence capability | `api/modules/missionPilot/persistence/`、`api/composition/mission-pilot/mission-pilot-runtime-bindings.ts`、`packages/mission-pilot/src/backend/persistence-port.ts` |
| Plan step／review progress | `shared/plan-mode-execution.ts`、`packages/mission-pilot/src/contracts/mission-pilot-plan-progress.schema.ts` |
| Queue handoff／claim readiness | `api/modules/taskOperator/`、`api/modules/queue/` |
| Task Git workspace／merge policy | `shared/schemas/git-integration.schema.ts`、`api/modules/gitworktree/`、`api/modules/nightworkers/nightworkers.git-merge.service.ts` |
| Test／Review／closeout evidence | `api/modules/review/`、`api/modules/taskOperator/`、`api/modules/gitCloseout/` |
| Project Evaluation／Quality | `api/modules/project-evaluation/`、`api/modules/quality/` |
| Overview usage／cost | `shared/schemas/overview.schema.ts`、`api/modules/overview/` |
| Runtime storage path | `api/runtime/paths.ts` |
| 利用可能command | `package.json`、`scripts/verify.mjs` |

## Contribution、Security、License

変更を提出する前に[CONTRIBUTING.md](./CONTRIBUTING.md)を確認してください。security issueはpublic issueではなく、[SECURITY.md](./SECURITY.md)に従って報告してください。

NightWorkersは[MIT License](./LICENSE.md)で配布されます。
