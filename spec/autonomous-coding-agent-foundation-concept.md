---
title: 自律コーディングエージェント基盤コンセプト
targetKind: wiki
priorityGroup: wiki
---

# 自律コーディングエージェント基盤コンセプト

作成日: 2026-06-01  
更新日: 2026-06-02

## この文書の目的

この文書は、NightWorkers を「個人利用の Manus / Devin 的な自律開発エージェント基盤」へ育てるための全体方向性を定義する。

ここで扱うのは個別機能の実装計画ではない。何を中核価値にするか、どの責務を NightWorkers が持つか、どの外部資産を参考に留めるか、どの順序で能力を育てるべきかを決めるためのコンセプトである。

NightWorkers が目指すものは、LLM がたまたまコードを書ける playground ではない。目指すのは、個人のローカル開発環境で、依頼、実行、観測、停止、検証、レビュー、再試行、知識化を継続的に管理できる control plane である。

## 目指すプロダクト像

NightWorkers は、まず personal Devin を目指す。つまり、個人のリポジトリに対して、ソフトウェア開発タスクを非同期または半非同期で進め、結果を diff、test、log、review として確認できる状態を作る。

その先に personal Manus 的な一般タスク実行能力を広げる。ただし、最初から汎用 agent を目指して範囲を広げすぎない。ソフトウェア開発は、成功条件を diff、verification、review、git state で検証しやすいため、基盤価値を固める最初の領域として適している。

NightWorkers の初期の価値は、次の状態を個人環境で実現することである。

- リポジトリごとに task を受け付ける。
- agent がローカルまたは sandbox 上で作業する。
- 実行中の判断、tool call、command、file change、test result が ledger に残る。
- 人間が途中で観測し、必要なら止める、方向修正する、レビューする。
- 完了は agent の自己申告ではなく、ledger、diff、verification、review によって確定する。
- 実行から得た知見を contextStill / memoryRouter に戻し、次回以降の context として再利用する。

## NightWorkers の中核価値

NightWorkers の中核価値は、LLM provider、単体の agent loop、TUI、または外部 coding agent の置き換えそのものではない。

中核価値は次の4つである。

1. **Web control plane**  
   task、run、event、review、logs、diffs、settings を一覧・観測・操作できる場所。

2. **Run ledger**  
   agent の行動と結果を、後から検証できる唯一の事実源として保存する append-oriented な実行記録。

3. **Sandbox runner boundary**  
   file read/write、command execution、test、build、browser/computer use などの副作用を policy と isolation の内側で実行する境界。

4. **Memory / context feedback loop**  
   contextStill / memoryRouter と連携し、実行前の context compile、実行後の評価、失敗知見、レビュー結果、再利用可能な procedure を蓄積する循環。

この4つを保てない設計は、短期的に agent が賢く見えても NightWorkers の価値を弱める。

## 競合から見た位置付け

Devin、Codex、Claude Code on the web は、すでに「agent がコードを書き、テストし、PR や review に接続する」領域へ進んでいる。これらと同じ土俵で、モデル性能やクラウド環境の完成度だけを競うのは現実的ではない。

NightWorkers は、個人利用・ローカルファースト・検証可能性に寄せる。

- cloud SaaS ではなく、個人のローカル workspace を第一対象にする。
- 企業向け権限管理より、個人が自分の環境で安全に長時間 agent を走らせることを重視する。
- agent の賢さより、agent の行動を説明できることを優先する。
- PR 自動化より、まず diff、verification、review、follow-up の品質を高める。
- 複数 agent の派手さより、1 run の真実性と回復可能性を重視する。

この位置付けなら、既存の大規模 agent サービスと競合するだけでなく、個人が自分の開発習慣に合わせて育てられる agent control plane になれる。

## Pi などの OSS 資産に対する方針

Pi は、provider abstraction、agent loop、event streaming、session JSONL、branch/fork、extensions、skills、review workflow、CLI/TUI など、多くの参考資産を持つ。

ただし、NightWorkers は Pi package をそのまま install して runtime として採用しない。Pi は参考実装として読む。設計上の良い要素を NightWorkers の責務境界に合わせて再実装する。

理由は次の通り。

- NightWorkers の事実源は run ledger であり、外部 runtime の session log ではない。
- Tool policy、sandbox、review、memory feedback は NightWorkers 側で制御する必要がある。
- Pi extension / package は任意コード実行を前提にするため、NightWorkers の安全モデルに直接入れるべきではない。
- 依存として採用すると、event model、session model、provider model の主導権が Pi 側に寄る。
- NightWorkers は Web control plane であり、TUI 中心の操作体系とは優先順位が異なる。

Pi から参考にするものは、次のように扱う。

- LLM provider abstraction は、NightWorkers の `LlmGateway` 設計の参考にする。
- Agent loop の event taxonomy は、NightWorkers の run event taxonomy の参考にする。
- `beforeToolCall` / `afterToolCall` 的な hook は、NightWorkers core の policy gate として再解釈する。
- Session JSONL は、NightWorkers run ledger の export/import 形式の参考にする。
- Skill format は、安全な markdown subset として互換性を検討する。
- Review workflow は、NightWorkers の review phase と follow-up generation の参考にする。
- Extension/package system は、直接採用せず、将来の capability-based plugin model の参考に留める。

## 十分な基盤とは何か

十分な自律コーディングエージェント基盤とは、次の状態を満たすものとする。

- エージェントが何を見て、何を判断し、どの tool を使い、何を変更し、どう検証したかが追える。
- エージェント自身の成功認識と、基盤側の成功判定が分離されている。
- LLM が不完全な出力をしても、基盤が安全に停止し、理由を残せる。
- 実行中の状態がリアルタイムに見え、後から見ても同じ順序で再現できる。
- repository ごとの safety policy が、UI 表示ではなく実際の tool execution に効く。
- 新規ファイル作成、既存ファイル編集、コマンド実行、検証、browser/computer use がそれぞれ明確な contract を持つ。
- 人間レビューは最後の飾りではなく、agent outcome を確定する control point になっている。
- 実行結果から再利用可能な知見を抽出し、次の run の context に戻せる。

ここで重要なのは、LLM の賢さを前提にしないことである。LLM が優秀なら成功する設計ではなく、LLM が迷った時、間違えた時、余計な tool を選んだ時にも、基盤が結果を壊さない設計が必要になる。

## 制御面が弱いと何が起きるか

制御面が弱い基盤では、表面上は「動いている」ように見える。しかし、次のような問題が起きる。

- agent が `needs_human` と判断しても、runner が `completed` に上書きする。
- tool 呼び出しに失敗しても、外側の task status は成功に近い状態へ進む。
- 同じ探索を何度も繰り返しても、停止条件が発火しない。
- UI に表示される debug event が、実際の user message や run と対応しない。
- safety policy を設定しても、実行時には守られない。
- final answer だけを見ると完了したように見えるが、実ファイルや diff では完了していない。
- agent が browser や外部サイトを操作した時に、何を根拠に判断したかが残らない。
- 実行後に得た学びが次の作業へ戻らず、毎回同じ失敗を繰り返す。

この状態では、品質ゲートを追加しても根本的には改善しない。品質ゲートは「実行結果が何であるか」が正しく記録されて初めて意味を持つ。基盤が失敗を成功に見せるなら、テストは最後の防波堤ではなく、ただの偶然の検出器になる。

## 基盤の中心は LLM ではなく run ledger

自律コーディングエージェントの中心は LLM ではなく run ledger である。

LLM は判断と生成を行うが、基盤として信頼すべき事実は ledger に残る。

- user message
- compiled context
- repository snapshot
- selected policy
- supervisor decision
- model request / response metadata
- tool call
- tool result
- command output
- browser/computer-use observation
- changed files
- diff
- verification result
- terminal state
- final report
- human review
- memory feedback

この ledger が正しければ、LLM の失敗は改善対象として扱える。ledger が不正確なら、LLM の失敗なのか、tool の失敗なのか、UI の表示ミスなのか、runner の状態上書きなのかを切り分けられない。

NightWorkers が基盤として十分になるには、まず ledger を唯一の事実源として扱う必要がある。UI は ledger の投影であり、runner は ledger を更新する実行者であり、supervisor は ledger を読んで次の判断をする制御層である。

## 成功判定は agent に任せない

自律エージェントでは、agent 自身が「完了しました」と言うことに価値はある。しかし、それを最終的な成功判定にしてはいけない。

成功判定には少なくとも次が必要である。

- 依頼内容に対応する diff がある。
- 必要なファイルが存在する。
- 期待した変更対象だけが変わっている。
- verification command が実行され、その結果が ledger に残っている。
- supervisor が `terminalState` と停止理由を明示している。
- runner/service 層がその `terminalState` を上書きしていない。
- review phase で findings と human callouts が分離されている。
- 必要なら人間レビューで `completed` に昇格する。

この分離がないと、agent の自己申告と実行結果が混線する。NightWorkers では、`completed` は最終的な outcome であり、agent が「終わった」と言っただけでは原則として `needs_review` に留める。

## 停止条件は能力の一部である

コーディングエージェントの能力は、長く続けられることではない。必要な時に止まれることも能力である。

十分な基盤では、次の停止条件が明示される。

- 最大ラウンド数に達した。
- 最大 tool call 数に達した。
- 総時間制限に達した。
- 同じ tool と同じ arguments を繰り返している。
- 同じ tool failure が続いている。
- LLM が実行ラウンドで必須の `toolCall` を返さない。
- safety policy に触れた。
- destructive action が必要になった。
- network / browser action の許可境界を超えた。
- acceptance criteria を満たす根拠が得られない。

この停止は「諦め」ではなく、基盤の信頼性である。止まる理由を ledger に残せば、次の改善対象が明確になる。止まらずに探索を続けるだけなら、UI は賑やかになっても基盤価値は上がらない。

## リアルタイム性は装飾ではない

WebSocket で実行中の出来事を見せることは、単なる UX ではない。自律エージェント基盤では、リアルタイム性は制御面の一部である。

実行中に何が起きているかが見えない場合、人間は次の判断ができない。

- いま探索中なのか。
- tool を実行しているのか。
- 同じ箇所を繰り返しているのか。
- すでに失敗しているのか。
- 最終回答待ちなのか。
- run が固まっているのか。
- browser や terminal が危険な状態に入っていないか。

そのため、WS event は「届けば便利」では不十分である。runId、seq、timestamp を持ち、欠落や重複に強く、後から取得した run events と同じ順序に merge できる必要がある。

Debug UI は、LLM の最終回答を待って過去をまとめて表示する場所ではなく、現在の制御状態を観測する場所である。

## safetyPolicy は表示設定ではなく実行契約である

repository の `safetyPolicy` は、UI に存在するだけでは意味がない。

十分な基盤では、policy は tool execution の直前で評価される。

- `allowedPaths` は read/search/edit/run cwd に効く。
- `deniedPaths` は全 tool に効く。
- `blockedCommands` は `run_command` に効く。
- `maxCommandSeconds` は command timeout に効く。
- `requireReadBeforeEdit` は既存ファイル編集に効く。
- network access は明示的な許可境界を持つ。
- browser/computer use は対象サイト、認証情報、外部送信、ダウンロードに制約を持つ。
- secret や個人情報は ledger と log に生値で残さない。

Policy violation は曖昧な LLM 失敗ではなく、明示的な tool result として ledger に残す。これにより、agent が危険だったのか、policy が厳しすぎたのか、task が危険な要求だったのかを区別できる。

## tool contract は agent の思考を形作る

LLM に「うまくやれ」と言うだけでは、基盤にはならない。tool が何を受け取り、何を返し、どの失敗をどの error code にするかが、agent の行動空間を決める。

特に重要な contract は次である。

- `read_file`: 編集前確認と context 取得。
- `search_files`: 対象箇所の探索。
- `replace_content`: 単純な既存ファイル編集。
- `apply_patch`: 複数行・複数ファイルの構造変更。
- `create_file` または new file patch: 新規ファイル作成。
- `run_command`: 明示的に許可された検証。
- `run_verification`: run outcome に結びつく検証。
- `git_status` / `git_diff`: 最終状態の根拠。
- `browser_observe` / `browser_action`: Web UI や外部資料を扱う場合の観測と操作。

新規ファイル作成と既存ファイル編集を同じ read-before-edit rule で扱うと、基本タスクが不自然に失敗する。逆に既存ファイル編集で read-before-edit を外すと、安全性が落ちる。

十分な基盤では、tool contract が LLM にとっても人間にとっても明確である必要がある。

## Review は品質ゲートであり、次タスク生成でもある

個人利用の Devin 的な体験では、agent が diff を出して終わりでは不十分である。作業結果を review し、必要なら次の修正 run へつなげる必要がある。

NightWorkers の review は、次の情報を分けて扱う。

- blocking findings: agent が修正すべき具体的な問題。
- human callouts: DB migration、依存変更、権限変更、破壊的操作など、人間が判断すべき非ブロッキング情報。
- agent follow-ups: 次 run に渡せる修正指示。
- suggested next tasks: この run の範囲外だが後続で扱うべき作業。
- verdict: approve、request changes、blocked などの review outcome。

Review は「最後の感想」ではない。agent outcome を確定し、必要なら再試行や follow-up task を生成する制御点である。

## 品質ゲートは最後ではなく run の一部である

品質ゲートは、agent の実行後に人間が別途走らせるものではなく、run ledger の一部として扱うべきである。

最低限必要な gate は次である。

- typecheck
- lint
- unit test
- relevant e2e
- git diff inspection
- changed files inspection
- review result

ただし、品質ゲートを増やす前に、実行結果の状態管理を直す必要がある。失敗を成功に上書きする基盤では、品質ゲートの結果も正しく意味づけできない。

目標は「テストが通ったから成功」ではない。「依頼、変更、検証、停止理由、人間レビューが ledger 上で矛盾していないから成功」と言える状態である。

## 人間レビューは自律性の否定ではない

自律コーディングエージェントに人間レビューが必要なことは、基盤が弱いことを意味しない。

むしろ、十分な基盤では人間レビューの位置付けが明確である。

- agent は作業を完了し、根拠を ledger に残す。
- supervisor は terminal state を付ける。
- runner はその状態を保存する。
- UI は diff、verification、final report、review findings を提示する。
- 人間は `completed`, `request_follow_up`, `accept_risk`, `cancel` を選ぶ。

人間レビューは、agent の不足を補う手作業ではなく、実行結果をプロジェクト側の意思決定として確定する段階である。

## Memory feedback loop

NightWorkers は、単発の agent runner ではなく、作業経験を蓄積する基盤である。

Memory / context 連携では、次を分離する。

- 実行前: contextStill / memoryRouter から task に必要な context を compile する。
- 実行中: agent が参照した context、使った tool、失敗した判断を ledger に残す。
- 実行後: outcome、review、検証結果、失敗原因を評価する。
- 知識化: 再利用可能な rule / procedure / skill 候補を登録する。
- 次回利用: 類似 task で、過去の成功・失敗を context として再利用する。

Memory は agent の思考を隠す場所ではない。agent の実行事実とレビュー済み知見を、次の run に活かすための substrate である。

## AgentRuntime と SandboxRuntime の考え方

NightWorkers は runner-agnostic な control plane であるべきだが、runtime-agnostic と責務放棄は違う。

AgentRuntime は、agent loop や provider 呼び出しの実行単位を抽象化する境界である。将来、native runtime、Codex CLI adapter、Claude Code adapter、OpenHands adapter、その他の headless runner が並ぶ可能性がある。

ただし、どの runtime を使っても、次の責務は NightWorkers 側に残す。

- task/run lifecycle の確定。
- run ledger への event append。
- tool policy と sandbox policy。
- outcome gate。
- review gate。
- memory feedback。
- UI への projection。

SandboxRuntime は、file system、command、network、browser/computer use などの副作用を隔離する境界である。最初は local guarded process でもよいが、設計上は Docker、将来の microVM、または remote isolated environment に差し替えられるようにする。

重要なのは、AgentRuntime が賢くなることではなく、SandboxRuntime と run ledger の間に説明可能な事実が残ることである。

## Skill / plugin の方針

NightWorkers には skill / plugin 的な拡張性が必要になる。ただし、任意コード実行を急いで入れるべきではない。

初期方針は次の通りである。

- Markdown ベースの skill / procedure は優先して扱う。
- contextStill / memoryRouter の procedure と互換にしやすい形を優先する。
- 外部 package の install と実行は、当面 NightWorkers の中核機能にしない。
- 将来 plugin を扱う場合は、capability-based な許可モデルを前提にする。
- plugin は core policy を bypass できない。
- plugin ができることは、context injection、prompt/template、review rubric、safe tool wrapper などの明示的 capability に限定する。

Pi の extension/package system は参考になるが、そのまま取り込まない。NightWorkers では、個人ローカル環境を守るため、拡張性より先に安全な capability 境界を作る。

## Browser / computer use の位置付け

Personal Manus 的な価値を出すには、最終的に browser や desktop 操作が必要になる。

ただし、browser/computer use は coding tool より危険な副作用を持つ。外部サイト、認証情報、個人情報、ダウンロード、フォーム送信、支払い、SNS 投稿などが絡むためである。

NightWorkers では、browser/computer use を次のように扱う。

- 最初は software development に必要な範囲へ限定する。
- dev server の画面確認、Playwright 操作、ドキュメント参照、localhost UI 検証を優先する。
- 外部サイト操作は read-only から始める。
- 認証済みサイト、フォーム送信、購入、公開投稿は明示承認なしに実行しない。
- browser observation と browser action は ledger に分けて残す。
- スクリーンショット、URL、DOM 抜粋、操作結果は必要最小限だけ保存し、secret を残さない。

Browser/computer use は Manus 的な広がりのために必要だが、coding agent foundation が固まる前に広げすぎてはいけない。

## 自動化と継続実行

個人利用の agent にとって、継続実行と自動化は重要である。ただし、cron 的に agent を起動するだけでは価値にならない。

NightWorkers の自動化は、次の条件を満たすべきである。

- 何を起点に起動したかが ledger に残る。
- 実行時の context、policy、runtime、sandbox が固定される。
- 失敗時に retry するか、人間待ちにするかが明確である。
- 実行結果が review queue に入り、人間が確認できる。
- routine task の結果から、次回の context や procedure が改善される。

自動化は「agent を勝手に動かす機能」ではなく、観測可能で止められる run をスケジュールする機能である。

## 非目標

当面の非目標は明確にする。

- Pi や OpenHands を fork して NightWorkers 化すること。
- Pi package / extension をそのまま install して実行すること。
- 最初から multi-agent 並列実行を主軸にすること。
- 最初から一般的な Web 代行やフォーム操作を広げること。
- agent の final answer だけを成功判定にすること。
- UI の派手さを ledger の正確性より優先すること。
- memoryRouter / contextStill を NightWorkers に吸収すること。
- sandbox なしで危険な command や外部副作用を拡張すること。

## 十分な基盤の判断基準

NightWorkers が「十分な自律コーディングエージェント基盤」と呼べるかは、次の問いで判断する。

1. agent が失敗した時、その失敗理由は ledger から分かるか。
2. agent が成功した時、その成功根拠は diff と verification から分かるか。
3. supervisor の terminal state は最後まで保持されるか。
4. 同じ探索や失敗を繰り返した時、基盤は止められるか。
5. 実行中の event は UI でリアルタイムに見えるか。
6. WS が切れても、後から ledger で同じ事実を復元できるか。
7. repository safety policy は全 tool に実際に効くか。
8. 新規作成、既存編集、検証実行の tool contract は明確か。
9. Review は findings、human callouts、agent follow-ups を分離できるか。
10. E2E は UI 操作ではなく、agent outcome を検証しているか。
11. 実行結果から memory feedback が作られ、次の run に効くか。
12. Browser/computer use の観測と副作用を分けて記録できるか。
13. LLM の自己申告と基盤の成功判定は分離されているか。

この問いに yes と言えない部分が、今の NightWorkers に足りない基盤である。

## 目指す姿

NightWorkers が目指すべき姿は、LLM が自由にコードを書く playground ではない。

目指すべきなのは、次のような local-first agent control plane である。

- ユーザー依頼を task として受け取る。
- task ごとに context、policy、runtime、sandbox を固定する。
- supervisor が tool 使用と停止条件を制御する。
- worker tools が安全に repo を読む、書く、検証する。
- 必要な範囲で browser/computer use を観測可能に実行する。
- すべての事実が ledger に残る。
- UI が ledger をリアルタイムに投影する。
- review が outcome と follow-up を確定する。
- 実行結果が memory feedback として次の作業へ戻る。
- 最終状態は agent 自己申告ではなく、ledger、verification、review によって確定する。

この control plane が整って初めて、LLM の性能改善、tool 追加、LSP 導入、browser/computer use、外部 MCP 連携、複数エージェント化、スケジュール実行が意味を持つ。

今の優先は、賢い agent を作ることではなく、agent の行動を信頼できる個人用開発基盤を作ることである。
