# Documentation Maintenance Checklist

NightWorkers のドキュメントを、実際の scripts、runtime boundary、検証結果とずらさないための保守チェックリスト。

## Use When

- `package.json` の scripts を追加、削除、変更したとき。
- `scripts/verify.mjs`、desktop build/smoke、Tauri runtime path、DB/runtime state の挙動を変えたとき。
- README、Feature Tour、Runtime Configuration、Architecture のいずれかで同じ概念を説明したとき。
- Project Evaluation や adoption 向けの公開説明を更新するとき。

## Current Priority

- [x] README の validation gate 説明と `scripts/verify.mjs` の task set が一致している。
- [x] `verify:desktop` / `verify` / `verify:full` が何を含み、何を含まないかが README と Runtime Configuration に明記されている。
- [x] `desktop:smoke` は packaged app の smoke gate として説明され、`verify` に含まれることと単独再実行できることが曖昧でない。
- [x] Desktop runtime state と logs の default path が、`src-tauri/src/main.rs` の `resolve_runtime_dir` / `desktop_log_path` と一致している。
- [x] README、`spec/configuration.md`、`spec/architecture.md` の desktop runtime path 説明が同じ前提で書かれている。
- [x] `bun run test run` と `bun run verify:full` の関係が、全 Vitest を含むかどうかまで説明されている。
- [x] Full Vitest や coverage が赤の場合、ドキュメントは「通る」と書かず、known failure と次に直す対象を分けて説明している。
- [x] Feature Tour の current limits が README の Current Limits と矛盾していない。
- [x] Trust Model、MCP、Agent Hooks、LLM provider settings の secret/auth 制約が README と configuration で同じ表現になっている。
- [x] 新しい user-facing surface を追加したとき、README の Current Capabilities、Feature Tour、Architecture API Surface の更新要否を確認している。

## Last Audit: 2026-07-03

- [x] README の validation gate 説明を `scripts/verify.mjs` の current task set に合わせた。
- [x] `desktop:smoke` を `verify` に含まれる packaged app smoke gate として README / Runtime Configuration で明記し、単独でも再実行できることを残した。
- [x] Desktop runtime path の説明を README / Architecture / Runtime Configuration / Feature Tour / Trust Model で同じ前提に揃えた。
- [x] README Documentation Map から壊れた Project Intelligence link を外した。
- [x] Trust Model と Adoption Checklist の missing link を解消した。
- [x] `spec/first-run-orientation.md` から Trust Model へ辿れるようにした。
- [x] 現行ドキュメントの Markdown link check を実行した。
- [x] `git diff --check` と `check:tracked-artifacts` を実行した。
- [x] `verify:full` が `verify` 後に `bun run test run` を実行し、その Vitest 範囲が E2E/live を除く全 `tests/**/*.{test,spec}.{ts,tsx}` であることを README / Runtime Configuration に明記した。
- [x] Full Vitest や coverage が赤い場合は、通常手順を「通る」と書かず、失敗コマンド・失敗テストまたは未達指標・次の修正対象を known failure として分ける運用を README に追記した。
- [x] カバレッジは `bun run test:coverage` で V8 coverage を実行し、`coverage/coverage-summary.json` の statements / branches / functions / lines で 80% 目標への進捗を確認できる。
- [x] 2026-07-03 の実測では `bun run test run` は 154 files / 1179 tests passed。`bun run test:coverage` は tests passed だが branch coverage が 67.77% で 80% 目標未達のため、次の coverage 修正対象は branch coverage として扱う。

## Maintenance Plan

1. Script inventory を取る。
   - `package.json` の scripts を確認する。
   - `scripts/verify.mjs` の `baseTasks`、`desktopTasks`、`taskSets` を確認する。
   - README の Development Commands / Testing と突き合わせる。

2. Runtime path inventory を取る。
   - `src-tauri/src/main.rs` の `resolve_resource_root`、`resolve_runtime_dir`、`desktop_log_path` を確認する。
   - `spec/configuration.md` と README の desktop runtime/log path が同じ前提か確認する。
   - smoke script が待つ path と実アプリが書く path が一致しているか確認する。

3. Verification wording を更新する。
   - `verify` は実際に含む task だけを書く。
   - `desktop:smoke`、E2E、live LLM、coverage は別 gate か verify 内の gate かを実装に合わせて書く。
   - 推奨 pre-PR validation は、通常変更、runtime/API/schema 変更、desktop 配布変更で分ける。

4. Capability wording を更新する。
   - README の Current Capabilities は「今動くもの」に限定する。
   - Current Limits は Feature Tour の current limits と重複してよいが、矛盾させない。
   - Architecture は boundary と durable rule を書き、使い方の細部は README / configuration に寄せる。

5. Known failure の扱いを分ける。
   - ドキュメントが事実として「通る」と書けるのは、直近確認で通った gate だけにする。
   - 赤い gate は README の通常手順に「通る」と混ぜず、known failure と次に直す対象を分けて残す。
   - 回避策を書く場合は、失敗原因、影響範囲、代替確認コマンドをセットで書く。

## Review Cadence

- Script 変更時: 同じ PR / task で README とこの checklist を確認する。
- Desktop 変更時: `desktop:build` と `desktop:smoke` の説明を必ず確認する。
- Release 前: README、Runtime Configuration、Architecture、Feature Tour をまとめて grep し、同じ概念の表現差を潰す。
- Project Evaluation の採点前: この checklist の Current Priority を見て、既知の赤い gate を評価に反映する。

## Suggested Audit Commands

```bash
rg -n "verify|desktop:smoke|desktop:build|verify:full|Vitest|runtime state|logs" README.md spec package.json scripts/verify.mjs src-tauri/src/main.rs
```

```bash
bun run verify:fast
bun run verify
bun run test run
bun run test:coverage
bun run desktop:smoke
```

`bun run test run` と `bun run desktop:smoke` は時間がかかる、または既知 failure がある場合がある。実行できない場合は、実行しなかった理由と最後に確認した結果をドキュメント更新の closeout に残す。

## Done Criteria

- README の script/gate 説明が `package.json` と `scripts/verify.mjs` に一致している。
- Desktop runtime/log path の説明が `src-tauri/src/main.rs` と一致している。
- `desktop:smoke` が `verify` に含まれるかどうかが明確に書かれている。
- 新しいドキュメントや変更した文書が Documentation Map から辿れる。
- 軽量確認として `rg` と `git diff --check` が通っている。
