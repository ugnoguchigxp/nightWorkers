# NightWorkers Agent Rules

- Supervisor の実行方針は prompt 側で定義し、llm-provider 側に用途別の細かい SystemContext や実行判断を分散させない。
- 各種タスクの手続きは `api/services/supervisor/skills/builtin/SKILL.md` と `api/services/supervisor/skills/builtin/references/` 配下の SKILL reference を参照する。Round 1 で workflow / routing hypothesis を選ばせ、Round 2 では `api/services/supervisor/skills/registry.ts` の `resolveSupervisorSkillDocuments` が phase / mode / work_kind / overlay に対応する reference を読み込む構造を維持する。
- 共通で使うツール説明、JSON 契約、回答要件は定数または関数として再利用できる形にまとめる。
- ユーザー文言を正規表現や keyword 判定で分類し、処理を分ける実装をしない。実行判断は workflow と prompt 指示に基づかせる。
- llm-provider は provider 呼び出し、JSON 抽出、schema 検証、最小限の互換正規化に責務を限定する。
- 通信障害などで LLM に到達できない場合を除き、LLM との応答表示に固定エラーメッセージを出さない。LLM から本文が返った場合は、schema/parse の成否にかかわらず実装側の固定文に差し替えない。
- Supervisor / provider の decision 生成用に一時ディレクトリを使う場合でも、その一時ディレクトリを実作業 workspace として扱わせない。リポジトリの読み書きは必ず登録済み Project の repo root を基準にした worker tool 経由で行わせ、一時ディレクトリへの作成・コピー・編集をタスク完了の証拠にしない。
- プロンプト文言は日本語を維持する。確認しづらい英語の運用ルールに置き換えない。
