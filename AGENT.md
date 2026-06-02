# NightWorkers Agent Rules

- Supervisor の実行方針と SystemContext は prompt に集約する。llm-provider 側に用途別の細かい SystemContext や実行判断を分散させない。
- 実行判断は prompt の SystemContext と workflow に基づかせる。分岐が必要な場合は、Round 1 で workflow を選ばせ、その workflow に対応する専用 SystemContext を prompt で定義して使う。
- 共通で使うツール説明、JSON 契約、回答要件は定数または関数として再利用できる形にまとめる。
- ユーザー文言を正規表現、keyword 判定、固定フレーズ判定で分類し、処理を分ける実装をしない。この種の分類ロジックは徹底的に排除する。
- llm-provider は provider 呼び出し、JSON 抽出、schema 検証、最小限の互換正規化に責務を限定する。
- プロンプト文言は日本語を維持する。確認しづらい英語の運用ルールに置き換えない。
