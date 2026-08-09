# Project Intelligence paired pilot 再開 TODO

- Status: paused by user on 2026-08-10
- Owner: NightWorkers（評価実行・計測・provider routing）
- Producer: vulnWorkbench（Project Exploration Catalog V2）
- Default activation: OFF のまま
- Namespace cleanup: rollout が `GO` になるまで実施しない

## 再開時の重要ルール

1. ローカルマシン上で Ollama、LocalLLM、LLM 中継proxyを起動しない。
2. Codex routingを利用できる時期に再開する。LocalLLMを使う場合は、LAN内のリモートOpenAI互換endpointだけを使う。
3. API keyをrepository、TODO、evidenceへ保存しない。LLM settingsは実行時だけ0600の一時ファイルとして作り、終了時に削除する。
4. baseline/catalogの全pairでprovider、model、reasoning depth、base revision、task promptを固定する。
5. providerまたはmodelを変更した場合、過去のpartial runへ継ぎ足さず、formal 10 pairを最初から取り直す。
6. pilot専用SQLite DBを所有するNightWorkers processは一つだけにする。実行中DBをsqlite3等で直接読まない。

## 2026-08-10 時点の到達点

Project Exploration用のnative API互換化は実装・コミット済みである。

- `dedf41cd` — Project ExplorationのGit revision pinning修正
- `bb70606d` — Project catalog tool引数のflat化
- `b26c949e` — flat Todo tool profileの追加
- `0e500d56` — multiline edit引数のJSON文字列化
- `7a97a17b` — compatible route向け`run_check` schemaの安定化

LAN内OpenAI互換endpointに対する実接続smokeでは、catalog、Todo、multiline edit、`run_check`のtool parser互換性を確認した。関連focused test 43件、typecheck、対象Biome checkは完了済みである。

中断したformal pilot v2は次のpartial状態だった。

- p01: baseline `completed`、catalog `failed`
- p02: baseline `completed`、catalog `completed`
- p03: baseline `needs_human`（30分上限）、catalog実行中にユーザー指示で中断
- p04-p10: 未実行

このpartial結果は最低10 pairを満たさず、rollout判定には使わない。正式reportも発行しない。特にCodex routingへ変更して再開する場合は比較条件が変わるため、10 pairを新規pilot IDで取り直す。

停止時点でpilot process、今回生成した6個のtodolist worktree/branch、evaluation consumer worktree、isolated runtime/DB、一時LLM settings、secretを含む複製settingsは削除済みである。既存ユーザーworktreeは保持した。再開は残存runtimeからではなく、cleanな評価環境の新規作成から始める。

## 再開 TODO

### P0: 実行前確認

- [ ] NightWorkersの現在HEADに上記5コミット相当が含まれることを確認する。
- [ ] mainの未コミット作業を混ぜず、cleanなdetached worktreeまたは専用branchをevaluation consumerとして作る。
- [ ] vulnWorkbenchのproducer変更とfixture/testがgreenであることを確認する。
- [ ] todolistのbase revisionを固定し、pilot開始後に変更しない。
- [ ] provider/model routingを決める。Codexを使う場合は全20 runをCodexへ固定する。
- [ ] 一時LLM settingsを0600で作成し、secret値をログへ出さない。
- [ ] pilot専用runtime/databaseを使い、常駐NightWorkers APIと共有しない。
- [ ] endpointが単一slotの場合はpair member間・pair間のcooldownを維持する。
- [ ] 1 pairのsmokeでcatalog toolがbroad exploration前に呼ばれ、edit/check tool callがparser errorにならないことを確認する。

### P1: Formal paired pilot

- [ ] 新しいpilot IDで最低10 pairを実行する。
- [ ] baseline/catalogを同じtask、base commit、provider、model、reasoning depthで比較する。
- [ ] failed、timed-out、`needs_human`を母数から除外しない。
- [ ] 実行中はrunnerの標準出力だけを監視し、SQLite DBを外部processから読まない。
- [ ] 最終reportをvulnWorkbenchの`spec/evidence/`へ保存する。

実行形は次を基準とする。パス、日付、routing名は再開時に確定し、secretをコマンド履歴や文書へ埋め込まない。

```sh
node scripts/run-project-exploration-paired-pilot.mjs \
  --llm-settings-path /absolute/path/to/temporary-0600-settings.json \
  --preserve-isolated-runtime \
  --repository-root /Users/y.noguchi/Code/todolist \
  --producer-root /Users/y.noguchi/Code/vulnWorkbench \
  --pilot-id project-intelligence-foundation-YYYY-MM-DD-codex \
  --pair-count 10 \
  --timeout-seconds 1800 \
  --thinking-depth low \
  --cooldown-seconds 120 \
  --output /Users/y.noguchi/Code/vulnWorkbench/spec/evidence/project-intelligence-paired-pilot-YYYY-MM-DD.json
```

### P2: 判定と文書化

- [ ] median pre-mutation exploratory callsが20%以上減ったか、同等のtool round-trip削減があるか判定する。
- [ ] median pre-mutation input tokensが15%以上減ったか判定する。
- [ ] completion率とverification pass率がbaselineより悪化していないことを確認する。
- [ ] wrong revision、wrong project、unsafe path incidentが0件であることを確認する。
- [ ] catalog由来のrework増加と、catalog failureからrun failureへの波及がないことを確認する。
- [ ] `GO` / `NO-GO` / `INSUFFICIENT_EVIDENCE`をmetric付きで記録する。
- [ ] vulnWorkbenchのhardening implementation plan、rollout decision、roadmapをformal reportへ合わせて更新する。
- [ ] `GO`以外ではfeature flagをOFFのままにし、namespace cleanupを行わない。

### P3: 最終検証とcleanup

- [ ] NightWorkersのfocused test、typecheck、generated catalog check、対象formatter/linterを実行する。
- [ ] vulnWorkbenchのfocused test、typecheck、ontology validation、smokeを実行する。
- [ ] pilot用processが0件であることを確認する。
- [ ] pilotが作成したtodolist worktree/branchだけを削除する。既存ユーザーworktreeは保持する。
- [ ] isolated runtime、pilot DB、temporary LLM settings、secretを含む複製settingsを削除する。
- [ ] smoke用の中間evidenceを整理し、正式reportだけを正本として残す。
- [ ] 両repositoryの差分を確認し、ユーザーの無関係な変更を混ぜていないことを確認する。

## 完了条件

残タスク0とは、単に10 pair runnerが終了した状態ではない。正式evidence、metric付きrollout判定、関連文書、全検証、temporary resource/secret cleanupまで完了し、feature flagとnamespaceの状態が判定に一致していることを指す。

想定所要時間は、Codex routing時の実測に依存する。LAN内の単一slotモデルを再利用する場合はformal pilotだけで約4〜8時間、判定・文書・検証・cleanupに追加で30〜60分を見込む。
