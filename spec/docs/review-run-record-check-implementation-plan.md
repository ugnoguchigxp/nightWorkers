# Review Run Record Check Implementation Plan

## Purpose

Review Mode の `検証証跡` / `受け入れ証跡` を、強い audit trail や evidence ledger として扱うのをやめ、完了済み Run の保存記録を確認する `Run 記録チェック` として再位置づけする。

この計画は、後日 audit trail を拡張する余地を残しつつ、現時点の実装が保証できる範囲に UI と説明を合わせるための縮退計画である。新しい検証実行基盤や証跡収集基盤はこの計画では作らない。

狙いは次の4点に絞る。

- `検証証跡` / `受け入れ証跡` という強すぎる表示名をやめ、`Run 記録チェック` 配下の確認項目として表現する。
- final report を evidence そのものではなく、Run 記録に対する完了主張として扱う。
- verification record は、存在する構造化 event を確認するだけであり、Review Mode がテストを実行するわけではないことを UI / reason / tests に反映する。
- 将来の本格 audit trail 化に必要な contract を、今回の非目標として明示しておく。

## Confirmed Baseline

現状の Review Mode には次の実装がある。

- `ReviewSectionKind` に `acceptance_evidence` と `verification_evidence` がある。
- UI label は `受け入れ証跡` / `検証証跡` である。
- Review Status は section の `requirement`, `progress`, `reason`, `findingCounts` を表示する。
- `buildReviewEvidencePackFromRun` は Run row と Run events から次を組み立てる。
  - `diff`
  - `verification`
  - `policy`
  - `reviewResults`
  - `selectedEvents`
  - `finalReport`
- `verification` に入るのは `event.type === 'verification.finished'` の構造化 event だけである。
- Codex native `command_execution` は `commandClass: verification | broad_verification` に分類されるが、それだけでは Review Mode の `verification` record には入らない。
- `finalReport` は Run row または `run.final_judgment_created` event から取得される。これは worker / runtime の完了報告であり、独立した検証証跡ではない。

現状の弱点:

- UI の `証跡` という語が、現実より強い保証を連想させる。
- `受け入れ証跡` は final report の有無と主張の整合性チェックであり、受け入れ成立を保証する証跡ではない。
- `検証証跡` は保存済み `verification.finished` の有無と失敗確認であり、Review Mode が検証コマンドを実行する機能ではない。
- Codex command execution と ReviewEvidencePack の verification record の間にまだ安定した正規化 contract がない。
- `final_report_evidence_mismatch` などの理由名は、機械的には残せても、ユーザー向け文言では `evidence` を強調しすぎない方がよい。

## Design Direction

### User-visible concept を Run 記録チェックへ倒す

Review Mode の該当部分は、次の user-visible concept にする。

```text
Run 記録チェック
  - 検証記録
  - 最終報告
```

表示名の推奨:

| Current | New label | Meaning |
| --- | --- | --- |
| `検証証跡` | `検証記録` | 保存済み Run event に検証結果があるかを確認する |
| `受け入れ証跡` | `最終報告` | final report の有無と Run 記録との矛盾を確認する |
| `Verification Evidence` | `Verification Record` | Saved verification record check |
| `Acceptance Evidence` | `Final Report` | Final report claim check |

必要なら section group label として `Run 記録チェック` を追加する。ただし初期実装では、UI 構造を大きく変えず section label と reason 文言を変えるだけでもよい。

### Internal enum は初期段階では維持する

初期実装では DB / API / schema の破壊的 rename を避ける。

- `acceptance_evidence`
- `verification_evidence`
- `acceptance_evidence_missing`
- `final_report_evidence_mismatch`
- `verification_missing`
- `verification_failed`

これらの internal key は互換性のため維持する。変更対象は主に user-visible label、section reason、finding title/body、テスト期待文言である。

後続で必要になった場合だけ、`acceptance_evidence` を `final_report_check`、`verification_evidence` を `verification_record_check` のように schema migration 付きで rename する。

### Review Mode はチェックを行うだけで検証を実行しない

Review section の `Run` ボタンは、検証コマンドを走らせるボタンではない。

実際に行うこと:

1. 対象 Run の row と events を読む。
2. `ReviewEvidencePack` を組み立てる。
3. section ごとの deterministic finding を生成する。
4. review artifact と finding を保存する。
5. final action gate を更新する。

実際に行わないこと:

- `bun run verify` や `npm test` を起動する。
- Codex / native runtime に追加検証を依頼する。
- 欠けている verification record を自動生成する。
- final report の内容を証跡として保証する。

### final report は claim として扱う

`finalReport` は「作業者または runtime の完了主張」であり、受け入れの証跡そのものではない。

文言の方向:

- OK: `最終報告がありません。`
- OK: `最終報告は検証成功を主張していますが、対応する検証記録が見つかりません。`
- NG: `受け入れ証跡がありません。`
- NG: `最終報告があるため受け入れ証跡があります。`

### verification record は保存済み event として扱う

`verification.finished` がある場合だけ、現状の ReviewEvidencePack では verification record として扱う。

ただし UI では「検証済み」と断定しない。`command`, `passed`, `summary` が存在する範囲だけ表示・参照する。

文言の方向:

- OK: `変更された Run に保存済みの検証記録がありません。`
- OK: `保存済みの検証記録が失敗しています。`
- NG: `検証が実行されていません。`
- NG: `テストが未実行です。`

後者は、実際に command execution を完全に観測できているとは限らないため断定しない。

## Scope

In scope:

- Review Status の user-visible section label を変更する。
- Review recommendation reason の日本語・英語文言を変更する。
- Review section reason の日本語・英語文言を変更する。
- `sectionFindings` が作る finding title/body を Run 記録チェックとして言い換える。
- `review-status-viewer` の i18n test を新しい文言へ更新する。
- Review Mode test の意味が `証跡` ではなく `記録チェック` として読めるように期待値を調整する。
- 関連 docs の用語を必要最小限で追従する。

Out of scope:

- 新しい verification command executor を作る。
- Codex command execution を `verification.finished` へ正規化する。
- `ReviewEvidencePack` の schema を大きく拡張する。
- DB table / enum を破壊的に rename する。
- Review Mode の final action semantics を変更する。
- LLM reviewer や security plugin 連携を追加する。
- `review-additional-prompts` 計画の proposed goal 置換と混ぜる。

## Target Behavior

### Review Status

Review Status では、対象 section が次のように見える。

```text
Run 記録チェック
  検証記録       未開始 / 完了 / ブロック中
  最終報告       未開始 / 完了 / ブロック中
```

group label を初期実装で追加しない場合でも、section 単体では次の表示にする。

- `検証記録`
- `最終報告`

### Recommendation reasons

変更後の代表文言:

| Reason code | Japanese |
| --- | --- |
| `verification_missing` | `変更された Run に保存済みの検証記録がありません。` |
| `verification_failed` | `保存済みの検証記録が失敗しています。` |
| `acceptance_evidence_missing` | `最終報告がなく、完了主張を確認できません。` |
| `final_report_evidence_mismatch` | `最終報告は検証成功を主張していますが、対応する検証記録がありません。` |

English:

| Reason code | English |
| --- | --- |
| `verification_missing` | `Changed run has no saved verification record.` |
| `verification_failed` | `A saved verification record failed.` |
| `acceptance_evidence_missing` | `Final report is missing, so the completion claim cannot be checked.` |
| `final_report_evidence_mismatch` | `Final report claims verification success without a matching verification record.` |

### Section reasons

変更後の代表文言:

- `最終報告の主張を Run 記録と照合します。`
- `保存済みの検証記録がないか、失敗しています。`
- `受け入れ前に保存済みの検証記録を確認できます。`

### Findings

`sectionFindings('acceptance_evidence')`:

- `Final report is missing`
  - body は `Review acceptance cannot be completed without a final report or equivalent closeout evidence.` から、`Run 記録チェックでは final report または同等の closeout 記録を確認できません。` のような意味へ寄せる。
- `Final report claims verification without evidence`
  - `evidence` ではなく `matching verification record` を使う。

`sectionFindings('verification_evidence')`:

- `Verification evidence is missing`
  - `Saved verification record is missing`
- `Verification failed`
  - `Saved verification record failed`

## Implementation Steps

### Step 1: UI label と辞書を更新する

Files:

- `src/i18n/dictionaries/ja.ts`
- `src/i18n/dictionaries/en.ts`

変更:

- `reviewStatus.section.acceptance_evidence`
- `reviewStatus.section.verification_evidence`
- `reviewStatus.reason.*`
- `reviewStatus.sectionReason.*`

期待結果:

- ユーザーに `証跡` という強い表現が出ない。
- `Run 記録`, `検証記録`, `最終報告`, `completion claim` の表現に寄る。

### Step 2: deterministic finding 文言を更新する

Files:

- `api/modules/nightworkers/nightworkers.review-mode.evidence.ts`

変更:

- `sectionFindings` の title/body を Run 記録チェックとして言い換える。
- logic は変えない。
- `verification.finished` の採用条件も変えない。

期待結果:

- finding が「検証を実行しろ」と断定せず、「保存済み記録が見つからない / 失敗している」と表現する。
- final report は claim として扱われる。

### Step 3: Review Status の表示構造を必要最小限で調整する

Files:

- `src/modules/nightworkers/components/ReviewStatusViewer.tsx`

初期実装の選択肢:

1. label だけ変更する。
2. `acceptance_evidence` と `verification_evidence` をまとめる小見出し `Run 記録チェック` を追加する。

推奨は 1 から始める。UI 差分を小さくし、文言だけで誤解を減らせるかを先に確認する。

2 を入れる場合の注意:

- nested card にしない。
- 既存の requirement grouping を壊さない。
- `Run 記録チェック` は説明文ではなく短い grouping label に留める。

### Step 4: Tests を文言変更に追従する

Files:

- `tests/review-status-viewer.test.tsx`
- `tests/review-mode.test.ts`
- `tests/nightworkers.workbench-selectors.test.ts`

変更:

- `検証証跡` / `Verification Evidence` の期待値を `検証記録` / `Verification Record` に変更する。
- missing reason の期待値を `保存済みの検証記録` ベースに変更する。
- API の internal key 期待値は初期段階では維持する。

期待結果:

- UI test は user-visible wording を保証する。
- backend test は internal key の互換性を保証する。

### Step 5: Docs を最小追従する

Files:

- `spec/docs/review-and-autonomous-goals-concept.md`
- `spec/docs/review-additional-prompts-implementation-plan.md`

変更:

- 現行 docs の `証跡` 表現のうち、Review Mode の user-visible concept に関わる箇所を `Run 記録` / `検証記録` / `最終報告` に寄せる。
- `ReviewEvidencePack` など internal type 名は無理に変更しない。
- archive 済みの `spec/archive/review-mode-implementation-plan.md` は履歴として残し、実装変更では編集しない。

期待結果:

- 現行 docs と UI が同じ縮退方針を説明する。
- archive docs は過去の設計記録として保持される。

## Verification Plan

Focused checks:

```bash
bun run test run tests/review-status-viewer.test.tsx
bun run test run tests/review-mode.test.ts
```

If `ReviewStatusViewer` component structure changes:

```bash
bun run test run tests/nightworkers.workbench-selectors.test.ts
```

General repository gate:

```bash
bun run verify:fast
```

Final gate before archiving this plan:

```bash
bun run verify
```

Manual review checklist:

- UI に `検証証跡` / `受け入れ証跡` が残っていない。
- UI が Review Mode でテストを実行するように見えない。
- final report が `受け入れ証跡` ではなく `最終報告` として表示される。
- missing / mismatch finding が `evidence` ではなく `record` / `claim` の問題として読める。
- internal enum key は互換性のため維持されている。
- `review-additional-prompts` 計画の未追跡変更と混ざっていない。

## Future Audit Trail Work

この計画ではやらないが、将来 `証跡` という言葉を再導入するなら、少なくとも次の contract が必要である。

- Codex native `command_execution` の `verification | broad_verification` を `verification.finished` 相当の record として正規化する。
- `command`, `exitCode`, `passed`, `seq`, `timestamp`, `providerItemId`, `afterDiffSeq` を保存する。
- diff 取得後の verification かどうかを判定できる。
- final report の検証成功 claim は、対応する `passed=true` verification record に link される。
- Review UI が参照した record id / event id を表示または展開できる。
- 失敗・欠落・不明を別状態として扱い、単なる missing と混同しない。

この contract が入るまでは、ユーザー向けには `証跡` ではなく `Run 記録チェック` と呼ぶ。

## Acceptance Criteria

- Review Status の該当 UI が `検証記録` / `最終報告` として表示される。
- `検証証跡` / `受け入れ証跡` という user-visible label がなくなる。
- Review Mode の該当 section がテスト実行機能ではなく、保存済み Run 記録チェックとして説明される。
- final report は completion claim として扱われ、独立した受け入れ証跡とは表現されない。
- 既存 DB / API の internal key は互換性のため維持される。
- focused tests と repo-native verification が通る。
