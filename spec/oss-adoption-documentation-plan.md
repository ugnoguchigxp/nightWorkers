# OSS Adoption Documentation Implementation Plan

## 目的

NightWorkers の OSS 採用可能性を、ドキュメント導線の改善だけで引き上げる。

この計画では、初見の開発者が短時間で次の 3 点を判断できる状態を作る。

1. NightWorkers が何を解決するプロダクトか。
2. 自分のローカル開発環境で安全に試せるか。
3. 実行証跡、Workbench、Queue、Blueprint、MCP、Hooks、LLM settings がどうつながるか。

現段階では、プロダクトがまだ進化中であることを前提にする。したがって、録画 GIF、サンプル Project Folder、デモ seed data で固定された体験を作るよりも、現在の価値と境界を正確に伝えるドキュメントを先に整える。

## 対象

### 実装すること

- README の採用判断導線を強化する。
- GitHub Pages LP の説明を、実画面なしでも価値が伝わる構造へ更新する。
- `spec/docs/` に OSS 採用者向けの参照ドキュメントを追加する。
- Quick Start 後に「起動後に何を見るべきか」を明示する。
- local-first / trust model / runtime evidence / provider data flow を説明する。
- 既存ドキュメント間のリンクを整理する。

### 今回は実装しないこと

- 録画 GIF / 動画の作成。
- サンプル Project Folder の追加。
- demo seed data の追加。
- `pnpm demo:*` script の追加。
- UI 機能追加。
- Workbench / Queue / Blueprint / Settings の挙動変更。
- 新しい DB table や migration。
- E2E demo harness の追加。

## 現状確認

- README は current capabilities、architecture、quick start、desktop、testing を広く説明している。
- GitHub Pages LP は local-first control plane の価値を説明しているが、導入後に何を見ればよいかの具体性は弱い。
- `spec/docs/architecture.md` は実行モデルと境界を説明している。
- `spec/docs/configuration.md` は runtime 設定の詳細を持つ。
- OSS 採用者向けに、trust model、初回確認手順、機能別 walkthrough、導入判断 checklist がまだ分離されていない。

## 成功条件

- README の冒頭から 5 分以内に、NightWorkers の価値、非目標、試し方、確認ポイントが分かる。
- Quick Start 後に、利用者が Workbench / Queue / Timeline / Artifact / Settings のどこを見ればよいか分かる。
- local-first の保存先、LLM provider に送る情報、worker tool が触る範囲、MCP/Hooks の安全境界が説明されている。
- GitHub Pages LP から README と主要 docs へ自然に遷移できる。
- まだ作らないデモ資産を、欠落ではなく future enhancement として説明できている。
- README と `spec/docs/` の説明が矛盾しない。

## ドキュメント構成

### README

README は GitHub 上の最初の採用判断面として扱う。

追加・整理するセクション:

1. `What NightWorkers Is`
   - local-first autonomous development control plane として短く定義する。
   - 「chat UI ではなく、run evidence を運用する制御面」と説明する。
2. `Five-Minute Orientation`
   - 既存 Quick Start を補強し、起動後に確認する画面を並べる。
   - 実行する追加 demo script は作らない。
3. `What You Should See First`
   - Project Folder
   - Workbench Session
   - Run Timeline
   - Artifact Pane
   - Implementation Queue
   - Settings
   - Overview
4. `Trust and Local-First Model`
   - 詳細は `spec/docs/trust-model.md` へリンクする。
5. `Current Limits`
   - automatic PR / merge / deploy なし。
   - multi-agent parallel orchestration なし。
   - external memory service 必須ではない。
   - demo GIF / sample project / seed demo は後続。
6. `Documentation Map`
   - 採用判断向け docs と内部設計 docs を分ける。

### GitHub Pages LP

LP は短い価値訴求と GitHub / README / Trust Model への導線に集中させる。

変更方針:

- hero の価値訴求は維持する。
- `How to Evaluate NightWorkers` セクションを追加する。
- `Read the README` だけでなく、以下へのリンクを置く。
  - Quick Start
  - Trust Model
  - Architecture
  - Configuration
- demo GIF はまだ置かない。
- サンプル Project Folder があるように見える表現は避ける。

### `spec/docs/trust-model.md`

新規追加する。

内容:

1. Local-first storage
   - SQLite/libSQL
   - runtime settings
   - logs
   - desktop runtime data path
2. Provider data flow
   - LLM provider に送る prompt / StateCard / tool summaries
   - ローカル DB に残る usage record
3. Worker tool boundary
   - repo root 基準
   - safety policy
   - blocked commands
   - allowed / denied paths
4. MCP Server boundary
   - non-auth stdio / Streamable HTTP
   - secret-like env / auth headers rejected
   - tool calls are run evidence
5. Agent Hooks boundary
   - hook runner と worker `run_command` の分離
   - redaction
6. Desktop boundary
   - Tauri shell
   - Node sidecar
   - runtime data path
7. Known trust limits
   - user-provided Project repo の command はローカルで動く。
   - provider credential と外部 MCP server はユーザー管理。

### `spec/docs/first-run-orientation.md`

新規追加する。

内容:

1. Install and start
2. Register Project Folder
3. Create Session
4. Send a Workbench message
5. Confirm whether it stayed as chat or started a run
6. Inspect Run Timeline
7. Inspect Artifact Pane
8. Check LLM usage and settings
9. Stop, retry, or review
10. Where to look when nothing happens

このドキュメントは demo seed を前提にしない。利用者の任意 repo を使う前提で、危険な操作を避けるために最初は read-only / investigation 系の依頼例を提示する。

### `spec/docs/feature-tour.md`

新規追加する。

内容:

- Workbench
- Implementation Queue
- Run Evidence
- Activity Transcript
- Blueprint Preview
- DB Design
- Design Token adoption
- LLM Provider Settings
- MCP Server Settings
- Agent Hooks
- Desktop packaging

各項目は次の shape にそろえる。

```text
## Feature Name

What it does:
- ...

Where to find it:
- ...

Why it matters:
- ...

Evidence it creates:
- ...

Current limits:
- ...
```

### `spec/docs/adoption-checklist.md`

新規追加する。

内容:

- local-only personal use で試す場合。
- provider credential を接続する場合。
- Project repo を登録する前に確認すること。
- worker tools / hooks / MCP を有効にする前に確認すること。
- desktop artifact を使う場合。
- OSS contributor として読むべき docs。

## 実装順序

### Phase 1: README の採用判断導線を整理する

目的: 初見の GitHub 訪問者が、NightWorkers の価値と現在の限界を短時間で判断できるようにする。

作業:

1. README 冒頭に `What NightWorkers Is` を追加する。
2. `Why NightWorkers` を、価値訴求と境界が先に出る構造へ整理する。
3. Quick Start の直後に `Five-Minute Orientation` を追加する。
4. `What You Should See First` を追加し、主要画面と確認ポイントを短く列挙する。
5. `Known non-goals at this stage` を `Current Limits` として採用判断向けに整理する。
6. Documentation Map を、新規 docs 追加後の構成に更新する。

検証:

```bash
rg -n "Five-Minute Orientation|What You Should See First|Current Limits|trust-model" README.md
pnpm lint
```

Exit:

- README だけ読んでも、プロダクト価値、起動手順、最初の確認画面、現時点の限界が分かる。

### Phase 2: Trust Model を追加する

目的: ローカル実行、provider 連携、worker tool、MCP、Hooks、desktop の安全境界を説明する。

作業:

1. `spec/docs/trust-model.md` を追加する。
2. 保存されるデータと保存先を説明する。
3. LLM provider に送るデータと送らないデータを説明する。
4. worker tool の repo root / safety policy 境界を説明する。
5. MCP / Hooks の制限と evidence path を説明する。
6. README と LP からリンクする。

検証:

```bash
rg -n "Trust Model|trust-model|local-first|MCP|Hooks|worker tool" README.md docs/index.html spec/docs/trust-model.md
```

Exit:

- セキュリティやローカル保存に不安がある利用者が、試す前に境界を確認できる。

### Phase 3: First Run Orientation を追加する

目的: 起動後の空白時間を減らし、最初に何を見ればよいかを明示する。

作業:

1. `spec/docs/first-run-orientation.md` を追加する。
2. Quick Start 後の確認順を画面単位で書く。
3. read-only / investigation 系の安全な初回依頼例を載せる。
4. chat-only と execution run の違いを説明する。
5. 何も起きない場合の確認先を整理する。
6. README からリンクする。

検証:

```bash
rg -n "first-run-orientation|chat-only|execution run|Run Timeline|Artifact Pane" README.md spec/docs/first-run-orientation.md
```

Exit:

- 利用者が任意 repo を登録した後、Workbench で何を見ればよいか分かる。

### Phase 4: Feature Tour を追加する

目的: NightWorkers の広い機能面を、採用判断しやすい単位で説明する。

作業:

1. `spec/docs/feature-tour.md` を追加する。
2. 各 feature を `What it does / Where to find it / Why it matters / Evidence it creates / Current limits` の形にそろえる。
3. README の Current Capabilities から詳細リンクする。
4. LP の Core Surfaces から Feature Tour へリンクする。

検証:

```bash
rg -n "Feature Tour|Evidence it creates|Current limits|feature-tour" README.md docs/index.html spec/docs/feature-tour.md
```

Exit:

- 個別機能の価値が、内部実装説明ではなく採用判断の言葉で読める。

### Phase 5: Adoption Checklist を追加する

目的: 試用前の不安と導入判断の漏れを減らす。

作業:

1. `spec/docs/adoption-checklist.md` を追加する。
2. local-only personal use の checklist を作る。
3. provider credential 接続時の checklist を作る。
4. Project repo 登録前の checklist を作る。
5. MCP / Hooks 有効化前の checklist を作る。
6. Desktop artifact 利用時の checklist を作る。
7. README の Documentation Map からリンクする。

検証:

```bash
rg -n "Adoption Checklist|adoption-checklist|provider credential|Project repo|Desktop artifact" README.md spec/docs/adoption-checklist.md
```

Exit:

- 利用者が自分の利用条件に合わせて、試す前に確認すべきことを見落としにくい。

### Phase 6: GitHub Pages LP を接続する

目的: LP を単独の説明ページではなく、採用判断 docs への入口にする。

作業:

1. `docs/index.html` に `How to Evaluate NightWorkers` セクションを追加する。
2. README、Trust Model、First Run Orientation、Feature Tour、Adoption Checklist へのリンクを追加する。
3. demo GIF がない状態でも自然な表現にする。
4. サンプル Project Folder や demo seed が存在するような表現は書かない。
5. `docs/assets/css/lp.css` を必要最小限だけ更新する。

検証:

```bash
rg -n "How to Evaluate NightWorkers|trust-model|first-run-orientation|feature-tour|adoption-checklist" docs/index.html docs/assets/css/lp.css
```

Exit:

- LP から採用判断に必要な README / docs へ到達できる。

## 推奨順序

最初に実施するなら、次の順序がよい。

1. Phase 1: README
2. Phase 2: Trust Model
3. Phase 3: First Run Orientation
4. Phase 5: Adoption Checklist
5. Phase 4: Feature Tour
6. Phase 6: GitHub Pages LP

理由は、README と Trust Model が採用判断に最も近く、Feature Tour と LP はその後に接続すればよいため。

## 将来に回すもの

プロダクトがもう少し安定してから、別計画として扱う。

- 録画 GIF / 90 秒動画。
- 代表タスクの end-to-end demo。
- sample Project Folder。
- demo seed data。
- `pnpm demo:start` / `pnpm demo:seed`。
- hosted static screenshot gallery。
- live-provider demo transcript。

これらは今回の計画に混ぜない。現段階では、固定されたデモ体験よりも、現在の設計思想、境界、確認手順を正確に伝える方を優先する。

## 完了条件

- README に採用判断向けの導線が追加されている。
- `spec/docs/trust-model.md` が追加されている。
- `spec/docs/first-run-orientation.md` が追加されている。
- `spec/docs/feature-tour.md` が追加されている。
- `spec/docs/adoption-checklist.md` が追加されている。
- GitHub Pages LP から採用判断 docs へリンクされている。
- 録画 GIF、サンプル Project Folder、demo seed data を追加していない。
- `pnpm lint` が通る。
