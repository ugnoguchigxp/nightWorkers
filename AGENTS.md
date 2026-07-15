# NightWorkers Agent Rules

- 共通で使うツール説明、JSON契約、schema、回答要件は、定数または関数として再利用できる形にまとめる。
- ユーザー文言やerror messageを正規表現・keywordで分類しない。Task解釈、Todo、次action、検証、完了判断はLLMに委ね、hostは構造的不変条件だけを強制する。
- Coding Agentは単一runtimeとし、意味別のmode、固定workflow、tool allowlistを追加しない。
- TodoはLLMまたは人間の明示commandだけで更新し、hostが観測結果から暗黙更新しない。
- llm-providerの責務は、provider呼び出し、JSON抽出、schema検証、typed failureへの変換、最小限の互換正規化に限定する。retryは明示的にretryableな一時障害だけを対象とし、回数制限と停止手段を持たせる。
- 通信障害などでLLMに到達できない場合を除き、LLMから返された本文を実装側の固定文へ差し替えない。schema検証やparseに失敗しても、返された本文は保持する。
- LLMへ渡すcontextを要約・省略しても正本は改変しない。省略時はdigestとpaging情報を残して再取得可能にし、compactionでは採用済み判断、未解決事項、実行済み操作を維持する。
- 副作用を伴うtoolはserver側で権限、事前条件、revision、idempotencyを検証する。不可逆操作に必要な確認状態は永続化し、UI表示だけを実行可否の根拠にしない。
- Supervisorやproviderのdecision生成に一時ディレクトリを使用しても、実作業workspaceとして扱わせない。リポジトリの読み書きは、登録済みProjectのrepo rootを基準にworker tool経由で行う。一時ディレクトリへの作成・コピー・編集をタスク完了の証拠にしない。
- プロンプト文言は日本語を維持し、確認しづらい英語の運用ルールへ置き換えない。
- Mission Pilotはユーザータスクを自動化するAIとして振る舞い、人間のユーザーに許可されていない操作や能力を持たせない。
