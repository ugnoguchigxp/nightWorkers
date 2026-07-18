# Chat 検証証跡カード 実装計画

## 目的

テストや Verify を実行するたびに、その時点の結果を消えない Chat 証跡カードとして表示する。直近の実行結果と最後に成功した Full Verify を分離し、コード変更や後続の失敗があっても過去の成功履歴を削除しない。

## スコープ

- managed `run_check` / `run_verification` と native Codex verification command の完了結果を通常Chatに表示する。
- 完了した1実行を1枚のカードとして扱い、started / progress event は通常Chatでは表示しない。
- 各カードに、その実行時点の最終 Full Verify 成功と鮮度を表示する。
- Full Verify 成功後のコード変更または後続検証失敗を `stale` として表現する。
- focused testの成功ではFull Verifyの鮮度を回復しない。
- 既存の詳細ログ、managed evidence、完了条件summaryをカード内で確認できるようにする。

## 対象外

- Test Modeや固定検証ワークフローの復元。
- Task、Todo、Mission Pilot phaseの自動更新。
- Verify実行自体の追加・変更。
- 完了条件とテストソースのLLM評価。
- 検証履歴を集約する専用Artifact。

## 設計

### 不変な実行カード

runtime event ledgerの追記型eventからカードを投影する。過去のeventを更新せず、同一provider itemの完了eventを一度だけ表示する。

### 最終Full Verify

構造化された `checkKind=verify` または `commandClass=broad_verification` の成功をFull Verify成功として扱う。コマンド文字列をUIで再解釈しない。

### 鮮度

- `current`: その実行時点で、最終Full Verify成功後にコード変更・検証失敗が観測されていない。
- `stale`: 最終Full Verify成功後にコード変更、または後続検証失敗が観測された。
- `unverified`: Full Verify成功履歴がまだない。

鮮度はカード作成時点のsnapshotであり、後のeventによって過去カードの表示内容を変更しない。

### 境界

履歴状態の計算はCoding Agent frontend moduleの純粋関数に置く。Chat timelineは既存eventを表示用観測値へ変換し、固定workflowや完了判断を所有しない。

## 検証項目

- managed test成功が通常Chatに専用カードとして表示される。
- native broad verification成功がFull Verifyとして表示される。
- started / progress eventは通常Chatに残らず、completed eventだけが残る。
- Full Verify成功後のfocused test成功で最終Full Verifyが保持される。
- Full Verify成功後のコード変更で、次の検証カードがstaleを表示する。
- Full Verify成功後の検証失敗で、過去成功を保持しつつstaleを表示する。
- 新しいFull Verify成功で基準が更新されcurrentへ戻る。
- debug表示と既存の一般コマンドカードを壊さない。

## 完了条件

- [AC-001] 完了した検証実行ごとに通常Chatへ独立した証跡カードが表示される。
- [AC-002] 過去のFull Verify成功は後続実行で消えず、実行時点の履歴として残る。
- [AC-003] 各検証カードで最終Full Verify成功と `current` / `stale` / `unverified` を区別できる。
- [AC-004] コード変更または後続検証失敗後も過去成功を保持し、再検証が必要なことを表示できる。
- [AC-005] 固定Test Mode、Task完了gate、暗黙のTodo更新を追加していない。
