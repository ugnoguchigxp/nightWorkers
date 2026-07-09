# NightWorkers というローカルファーストな開発エージェント実行管理基盤を作っている

最近、NightWorkers というプロジェクトを作っています。

一言でいうと、NightWorkers は coding agent による開発作業を、ローカルで記録・確認・制御するための実行管理基盤です。

ただし、やりたいことは「AI が勝手に全部実装してくれる」ではありません。むしろ、対象プロジェクトを評価し、必要な作業を分解し、実装可能なタスクとして整理し、その実行過程を後から確認できる形で残すことを重視しています。

## 何を作っているのか

NightWorkers では、まず対象リポジトリを Project Folder として登録します。そこから Workbench Session の中で、プロジェクト構成、既存の実装、テストや検証コマンド、現在の課題を確認します。

この評価結果をもとに、いきなり実装へ進むのではなく、作業をタスクへ分解します。

たとえば「この機能を作って」という依頼があったときに、どのファイルや責務境界に関係しそうか、どの順序で進めるべきか、何を検証すべきか、今回の範囲に含めるものと含めないものは何かを整理します。

そのうえで、Plan Mode、Blueprint、Data Model、Review Mode などの artifact を使いながら、実装前に確認できる形へ落とします。生成されたタスクや計画は、必要に応じて Implementation Queue に載せます。ここで初めて、明示的に承認された作業として実装 run が進みます。

実行中は、tool call、policy block、Todo、diff、test result、final report などをローカルの SQLite に記録します。つまり NightWorkers は、チャットの返答だけで作業を流すのではなく、評価、タスク生成、計画、実行、レビューまでを一続きの作業証跡として扱うためのものです。

## なぜこういう形にしているのか

coding agent を使っていると、便利な一方で「結局何を根拠にそう判断したのか」「どこを変更したのか」「検証は本当に走ったのか」が見えづらくなることがあります。

チャット欄だけで進めると、作業の流れはその場では分かっても、後から追い直すのが難しいです。特に、複数回の修正、レビュー、テスト、再実行が入ると、最終的な差分だけを見ても、そこに至る判断や失敗が見えません。

NightWorkers では、この部分をローカルに残すことを重視しています。作業を実行するだけでなく、なぜそのタスクになったのか、どういう計画だったのか、どのコマンドが走ったのか、どの差分が出たのかを確認できるようにしたい、というのが基本的な発想です。

## ContextStill との関係

NightWorkers の周辺には、ContextStill という別プロジェクトがあります。

ContextStill は、coding agent 向けのローカルファーストな知識管理・context 生成の仕組みです。過去の作業ログ、明示的に登録した知見、ドキュメント、調査結果などから、次のタスクに必要な context pack を作ります。

NightWorkers がプロジェクト評価やタスク生成を行うとき、毎回ゼロから背景を説明し直すのは効率が悪いです。過去に決めた運用ルール、失敗した実装方針、検証方法、リポジトリ固有の注意点などは、必要なときに必要な分だけ取り出せる方がよい。

そこで ContextStill は、MCP 経由で `initial_instructions`、`context_compile`、`compile_eval`、`context_decision` のような流れを提供します。NightWorkers 側では、それを実行前の context や、完了後のフィードバックとして使います。

## vulnWorkbench との関係

もうひとつ関係しているのが vulnWorkbench です。

vulnWorkbench は、ローカル脆弱性診断ワークベンチです。ここで大事なのは、LLM に自由にリポジトリを読ませて「怪しいところを探して」と頼む方向ではないことです。

Semgrep、Gitleaks、OSV、Trivy、DAST などの CLI ツールが一次証拠を生成し、vulnWorkbench はその artifact、finding、scan log、evidence を保存・正規化します。LLM は保存済みの scan context を読み、リスクの整理、修正方針、検証コマンド、実装向け handoff を作ります。

NightWorkers 側では、vulnWorkbench の結果を Review Run や security review の材料として使う想定です。セキュリティ診断を「LLM の雰囲気レビュー」にせず、CLI が出した証拠を起点に、修正タスクや検証へ接続するためです。

## 役割分担

今のところ、三つのプロジェクトはだいたい次のような分担です。

- NightWorkers: プロジェクト評価、タスク生成、計画、実装キュー、実行、レビュー、検証証跡を扱う
- ContextStill: 過去の知識や手順を、次のタスク向け context として再利用する
- vulnWorkbench: セキュリティ診断や Static Intelligence の証拠を CLI-first に生成する

流れとしては、次のようなものを想定しています。

```text
プロジェクト評価
  -> タスク生成
  -> 計画・artifact化
  -> Implementation Queue
  -> 実装 run
  -> diff / test / review / final report
```

必要に応じて、ContextStill が過去の知識を渡し、vulnWorkbench がセキュリティやコード構造に関する証拠を渡します。NightWorkers はそれらを受け取り、実際の作業運用に接続する位置づけです。

## 現時点で重視していること

NightWorkers は、まだ完成品というより、ローカル開発で coding agent をどう運用するかを試している段階です。

今重視しているのは、派手な自動化よりも、次のような地味な部分です。

- 対象リポジトリを明確にする
- 依頼をすぐ実装せず、評価とタスク生成を挟む
- 実装前に計画や artifact を確認できるようにする
- 実行に入る作業は Implementation Queue で明示する
- 差分、テスト、レビュー、最終報告を後から追えるようにする
- LLM の推測と、CLI や実行ログ由来の証拠を分ける
- セキュリティ診断は scanner-backed な証拠を起点にする

逆に、現時点では自動 PR 作成、merge、deploy、並列 multi-agent orchestration のようなものを中心には置いていません。まずは、単一ユーザーのローカル環境で、作業を見失わないことを優先しています。

## まとめ

NightWorkers は、coding agent に作業を任せるためのものというより、coding agent が関わる開発作業を人間が追える形に戻すための仕組みです。

プロジェクトを評価し、タスクを生成し、計画に落とし、実行キューに載せ、実装結果を証跡として残す。その流れをローカルで扱えるようにすることが、今やろうとしていることです。

ContextStill は知識と context の再利用を担当し、vulnWorkbench はセキュリティや Static Intelligence の証拠生成を担当します。NightWorkers は、それらを実際の開発作業の評価、タスク化、実行、レビューに接続します。

まだ荒い部分は多いですが、AI を使った開発を「その場限りのチャット」ではなく、「後から確認できる作業」として扱うための土台を作っています。
