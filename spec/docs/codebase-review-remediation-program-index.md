# Codebase Review Remediation Program 索引

## Status

- Plan status: `proposed`
- Document created: 2026-08-16
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Baseline branch: `main`
- Baseline HEAD at planning start: `4d4c57705326932583cce35d356663ccbef8ad32`
- Baseline worktree: dirty
- Implementation authorization: not started

この文書は、2026-08-16に精査したOpus 5コードベースレビュー28件を、変更責務と
検証境界が独立する5つの実装計画へ割り当てる索引である。レビューの重大度をそのまま
採用せず、現行コードで再確認した事実、実害、既存の安全策、既存計画との重複を基に
優先順位を定める。

本programの実装では、開始時点から存在する未コミット変更をユーザー所有の変更として
扱う。復元、上書き、暗黙の取り込みを行わず、競合する場合は対象差分を分離する。

## 1. 結論

28件の扱いは次のとおりとする。

| 判定 | 件数 | 扱い |
| --- | ---: | --- |
| 妥当で修正対象 | 21 | 対応するエリア計画で実装・検証する |
| 条件付きで修正対象 | 6 | 指摘の核だけを採用し、重大度または修正方法を補正する |
| 改修根拠として不成立 | 1 | `m2`。数値観測だけを残し、600行上限の緩和や統合を行わない |

Criticalの`C1`、`C2`、`C3`、`C4`はrelease blockerとして先に解消する。

## 2. 作業エリア

| Area | 計画書 | 主な責務 |
| --- | --- | --- |
| A | [Execution Security / Resource Safety](./execution-security-and-resource-safety-implementation-plan.md) | command、secret、fetch、background process、Git subprocess、file read |
| B | [Run / Queue State Integrity](./run-queue-state-integrity-implementation-plan.md) | Run終端CAS、Task projection、Queue lease、重複admission、claim競合 |
| C | [Agent Runtime Boundary / LLM Reliability](./agent-runtime-boundary-and-llm-reliability-implementation-plan.md) | Codex安全境界、role module、provider parse、tool arguments、token budget、abort |
| D | [Frontend Server State / UX](./frontend-server-state-and-ux-implementation-plan.md) | Query key、Settings cache、error UI、polling、i18n、手動fetch |
| E | [API Contract / Verification Quality](./api-contract-and-verification-quality-implementation-plan.md) | error envelope、critical coverage、UI testの信頼性 |

## 3. Finding allocation

| ID | 判定 | 優先度 | Area | 実装上の扱い |
| --- | --- | --- | --- | --- |
| C1 | 妥当 | P0 | A | shell構文をfail-closeし、read-only prefix判定によるpolicy bypassを廃止する |
| C2 | 妥当 | P0 | A | `run_command`にもproject secret境界を強制する |
| C3 | 妥当 | P0 | A | SSRF、redirect、DNS、Jina fallbackの外部送信を制御する |
| C4 | 妥当 | P0 | B | Run終端遷移をCAS化し、Task/Queue projectionを整合させる |
| M1 | 条件付き妥当 | P1 | C | Codex sandboxを無効扱いせず、NightWorkers policyとの非対称だけを解消する |
| M2 | 妥当 | P2 | C | Coding AgentからNightWorkers private repository/orchestrationへの直接依存をport化する |
| M3 | 妥当 | P2 | C | Mission Pilot persistenceからTask Operatorへの直接依存をcompositionへ移す |
| M4 | 妥当 | P1 | A | Run所有background processをRun終端時に停止する。終端hookはArea Bを使用する |
| M5 | 妥当 | P1 | B | Queue cancel/resumeをlease-awareな状態別commandにする |
| M6 | 妥当 | P1 | B | Task status更新をversion付きprojectionへ集約する |
| M7 | 妥当、重大度補正 | P2 | D | repositories query keyを共通化する |
| M8 | 妥当 | P1 | D | Settings save/loadをQuery cacheの正本へ統合する |
| M9 | 妥当 | P1 | D | Task Consoleのerror状態とterminal polling停止を実装する |
| M10 | 条件付き妥当 | P3 | C | 推定式を一律化せず、用途別estimator interfaceとbudget不変条件を追加する |
| M11 | 条件付き妥当 | P1 | E | 既存Q7-02を再利用し、最新coverageを再測定して未達だけを補う |
| M12 | 妥当 | P1 | A | Git subprocessをtimeout、output cap、非対話環境付きrunnerへ統合する |
| M13 | 条件付き妥当 | P3 | B | `claimNextQueuedTask`のCAS競合時にbounded retryする |
| M14 | 条件付き妥当 | P2 | C | raw引数を保持しつつ、parse/schema不正をdispatch前にtyped failureへする |
| m1 | 妥当 | P3 | D | server state取得を段階的にQuery optionsへ寄せる |
| m2 | 不成立 | 対象外 | なし | 600行上限を緩和しない。凝集度の別根拠なしにfile統合しない |
| m3 | 妥当 | P2 | E | 一般REST error envelopeを共通化し、command protocolは別契約として維持する |
| m4 | 条件付き妥当 | P2 | E | coverage用branch testを削除せず、重要UIにbehavior testを追加する |
| m5 | 妥当 | P2 | A | `read_file`にsize/binary/range制限を追加する |
| m6 | 妥当 | P3 | D | Task Console、repositories、confirm文言を辞書へ移す |
| m7 | 妥当 | P3 | D | Project Evaluationのpoll cursorをref化する |
| m8 | 妥当、重大度補正 | P1 | C | OpenAI streamの破損recordを`invalid_response`へ変換する |
| m9 | 妥当、重大度補正 | P1 | B | 同一Taskのactive Queue Entry重複をDB不変条件で防ぐ |
| m10 | 妥当 | P3 | C | retry backoff後、provider再呼び出し前にabortを再確認する |

## 4. Shared invariants

全エリアは次を維持する。

1. ユーザー文言、command本文、error messageをkeywordや正規表現で意味分類しない。
2. Hostはstatus、revision、lease、schema、ownership、pathなどの構造的不変条件だけを強制する。
3. LLMが返した本文、破損tool argument、provider response本文は診断用に保持し、固定文へ差し替えない。
4. 副作用のある操作はserver側で権限、revision、idempotency、workspace authorityを検証する。
5. Coding AgentとMission Pilotの所有権を相互に移さない。
6. 既存のTask Operator、Evidence、Closeout、Quality計画の意味判断を重複実装しない。
7. 回帰testを先に追加し、失敗を確認してからproduction codeを変更する。
8. 既存の未コミット変更と競合するfileは、実装開始前にaccepted baselineを確定する。

## 5. Implementation waves

### Wave 0: Baseline固定

- `git status --short --branch`、`git rev-parse HEAD`を保存する。
- Areaごとに対象fileと既存未コミット差分の重複を確認する。
- security/state findingの失敗再現testを先に追加する。
- full coverageは同じreports directoryで並行実行しない。

### Wave 1: Release blockers

- Area A: `C1`、`C2`、`C3`。
- Area B: `C4`。
- blocker解消後、Area Aが定義したsecurity contractをArea CのCodex runtimeへ接続する。

### Wave 2: Lifecycle / state integrity

- Area B: `M5`、`M6`、`m9`、`M13`。
- Area A: `M4`をArea Bのterminal transition hookへ接続する。
- Area A: `M12`、`m5`。

### Wave 3: Runtime / architecture

- Area C: `M1`、`M14`、`m8`、`m10`。
- その後に`M2`、`M3`のmodule boundary移行を行う。
- `M10`は観測・boundary testを先に行い、必要な場合だけestimatorを変更する。

### Wave 4: Frontend / API / quality

- Area DとArea Eは、server contractが確定した後に並行して実施できる。
- `m1`は一括rewriteせず、対象画面ごとに移行する。
- `m4`はcoverage行数の削減を目的にせず、重要挙動の証明追加を目的にする。

### 5.1 推奨実装順

実装順は重大度だけでなく、後続Areaが利用するcontractの確定順で固定する。各行を一つの
change setとして完了させ、同じ行にないticketを一つの巨大な変更へまとめない。

| 順序 | 実行ticket | 完了してから次へ進む理由 |
| ---: | --- | --- |
| 0 | `E-T0` | dirtyなcoverage/Settings差分をaccepted baselineにし、既存変更の上書きを防ぐ |
| 1 | `A-T0`, `B-T0` | P0 defectを修正前に再現し、成功条件を固定する |
| 2 | `A-T1`, `A-T2`, `A-T3` | command、secret、SSRFのrelease blockerを先に閉じる |
| 3 | `B-T1`, `B-T2`, `B-T3` | Run terminal CASとprojection transactionを後続lifecycleの正本にする |
| 4 | `B-T4`, `B-T5`, `B-T6`, `B-T7`, `A-T4` | Queue lifecycleとRun-owned process cleanupを確定済みterminal hookへ接続する |
| 5 | `A-T5`, `A-T6` | 独立したresource上限を追加し、Area Aを完了可能にする |
| 6 | `C-T0`, `C-T1` | Codex laneの安全性を実測し、Area Aのcontractへ接続する |
| 7 | `C-T7`, `C-T8`, `C-T10` | provider/tool failureとabortを小さい独立変更で先に安定させる |
| 8 | `C-T2`, `C-T3`, `C-T4`, `C-T5`, `C-T6` | port定義、adapter、caller移行、architecture guardの順でrole境界を移す |
| 9 | `C-T9` | estimatorは観測結果から必要な差分だけを変更する |
| 10 | `E-T1`, `E-T2`, `E-T3a`〜`E-T3e` | 一般REST errorの正本とFrontend decoderを先に提供する |
| 11 | `D-T0`〜`D-T6`, `E-T5` | Frontendをfeature単位で移行し、同じchange setでbehaviorを証明する |
| 12 | `E-T4` | 最新coverageに未達が残る場合だけ限定補強する |
| 13 | program verification | 全Areaの限定test成功後にfull gateを直列実行する |

`A-T1`〜`A-T3`と`B-T1`はproduction fileが重ならない場合に限り並行実装できる。ただし
`A-T4`は`B-T3`完了前、`D-T1`はSettingsのaccepted baseline確定前、`E-T4`は`E-T0`で未達が
再現する前に開始しない。

### 5.2 Terra実行プロトコル

各Area文書の`*-Tn`をTerraへ一件ずつ渡す。依頼文にはticket本文を省略せず含め、次の共通手順を
必須とする。

1. `git rev-parse HEAD`と`git status --short`を記録し、ticketのwrite setに既存差分があれば停止する。
2. ticketに列挙したproduction file、symbol、近接testを開き、記載との不一致があれば実装せず計画を更新する。
3. 先にred testを追加して対象testだけを実行し、想定理由で失敗したことを記録する。
4. write set外を変更しない。必要になった場合は新しいticketとして切り出し、現在ticketを拡張しない。
5. production codeを変更し、対象test、typecheck、architecture/lintの順で検証する。
6. `git diff --check`と`git diff --stat`を確認し、変更file、test結果、未検証事項を報告する。
7. 完了条件を一つでも満たせない場合は`完了`と報告せず、ticket記載のstop conditionをそのまま報告する。

Terraへ複数ticketを一度に渡す場合も、上記の順でcommit可能な差分を保つ。調査結果から別設計へ
変える必要が生じた場合、型やpublic contractを推測で作らず、本program文書を先に改訂する。

## 6. Program verification

各Areaの限定testに加えて、統合時に次を実行する。

```bash
bun run check:architecture
bun run typecheck
bun run lint
node scripts/run-vitest.mjs run
bun run test:coverage
node scripts/verify.mjs full
```

`test:coverage`は単独で実行し、別processが同じ`coverage` directoryを使用していないことを
事前確認する。実行環境や外部service不足で実行できないgateは、未検証として記録し、passへ
読み替えない。

## 7. Program completion criteria

次をすべて満たしたときだけprogramを完了とする。

1. `C1`〜`C4`の再現testが修正前に失敗し、修正後に成功している。
2. Finding allocationで対象Areaを持つ27件について、実装結果または「観測のみで変更不要」の
   evidenceが各Area文書へ記録されている。
3. `m2`を理由に600行上限を緩和、削除、またはlarge-file baselineを拡大していない。
4. Run、Task、Queue、background processのterminal stateに矛盾がない。
5. Native runtimeとCodex runtimeが、定義したsecret・workspace・副作用境界を同じ意味で守る。
6. 一般REST errorとCoding Agent command protocolの契約がそれぞれ一意である。
7. critical coverage gateとfull verificationが成功する。
8. 実装完了した各Area計画を`spec/.archived`へ移し、未完了Areaだけを`spec/docs`に残す。
