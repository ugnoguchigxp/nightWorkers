# story-cms Direct Codex 比較実験依頼書

## 目的

NightWorkers経由のCoding Agentと、story-cmsリポジトリへ直接依頼したCodexで、同一の実装・レビューシナリオを実行し、品質、所要時間、tool利用、トークン使用量を比較する。

コード変更量だけで優劣を判断せず、同じ開始commit、同じモデル、同じ受入条件、同じ2段階の依頼を使用する。

## 比較条件

- 対象リポジトリ: `story-cms`
- 開始commit: `8a52e2b10f4d05ca97b2c05cca527de1c4ce49ff`
- 開始状態: clean
- モデル: `gpt-5.6-sol`
- 実行単位: 同じCodex task内でPhase 1、Phase 2を続けて実行する
- 作業場所: 開始commitから作成した新しいworktree
- 追加の設計回答や実装例は与えない
- Codex自身の通常の調査、Todo、tool選択、compactionは制限しない
- Phase 1完了後、コードを初期状態へ戻さず、そのままPhase 2を依頼する

NightWorkers側の比較対象:

- Phase 1 Run: `ac9f0e1b-6a46-4e37-8d46-9098193be27b`
- Phase 2 Run: `582b46c7-781e-4aa0-bb1e-e2bfdf8f07d5`

## Phase 1: 実装依頼

以下を新しいCodex taskの最初の依頼として、そのまま送信する。

```text
脚本から制作台本を生成する変換ユースケースを実装してください。

## 目的

脚本文を入力し、シーンごとの映像指示・登場人物・台詞を含む制作台本を同期生成するHTTP APIを、既存のvideoドメインへ追加する。

## スコープ

- 対象: 既存video moduleのdomain contract、application use case、AI port接続、入力検証、HTTP API、認証境界
- 対象: video moduleの公開contractを既存のAPI共有型生成・検査フローへ接続する変更
- 対象外: UI、脚本IDによる入力、追加の制作コンテキスト、非同期処理、生成結果の保存、provider選択機能
- 対象外: DB schema、repository、migration、新しいdomain module、既存コードの広範な移設

## タスク分類

既存domainの拡張。videoドメインには3層の骨格と初期定義が存在するため、新規moduleは作成せず、既存video moduleの命名・配置・依存規則を維持して業務ユースケースを追加する。

## 実装要件

1. videoドメイン契約を定義する
   - 脚本文を受け取る生成入力を定義する。
   - シーン単位の映像指示・登場人物・台詞を表す制作台本を定義する。
   - 生成失敗を表す契約を定義する。
   - domain固有のschema、type、promptはvideo moduleの所有範囲に置く。
   - 保存を行わないためrepository、DB schema、migrationは追加しない。

2. 変換ユースケースを実装する
   - 脚本文だけを入力として制作台本を生成する明示的なapplication use caseを追加する。
   - 既存の汎用AI portと設定済みのデフォルトproviderを再利用する。
   - 構造化されたAI応答をdomain契約へ変換する。
   - provider失敗、応答形式不正、生成不能を成功結果へ変換しない。

3. 入力・出力validationを接続する
   - 空または契約違反の脚本文をAI呼び出し前に拒否する。
   - AI応答を制作台本契約に照合する。
   - videoドメイン側のschemaをsource of truthとし、公開contractの重複定義を作らない。

4. 認証付きHTTP APIを追加する
   - 既存video moduleのHTTP層へ同期生成routeを追加する。
   - リクエスト本文では脚本文だけを受け付ける。
   - 生成完了後、制作台本を同一レスポンスで返す。
   - 不正入力とAI生成失敗を契約上のエラーへ対応付ける。
   - 既存の認証済みユーザー境界を適用し、未認証要求を拒否する。
   - 生成結果や所有レコードは保存しない。

5. composition rootへ登録する
   - video module外では既存route登録箇所への接続と必要な依存注入だけを変更する。
   - 新しいprovider設定やdomain固有処理をcomposition rootへ置かない。

## 完了条件

- [AC-001][api] 認証済みユーザーが有効な脚本文を送ると、映像指示・登場人物・台詞をシーンごとに含む制作台本が同期レスポンスで返る。
- [AC-002][validation] 空または契約違反の脚本文はAI生成を開始せずAPIエラーとして返る。
- [AC-003][validation] AI応答が制作台本契約を満たさない場合は、不完全な成功結果を返さず生成失敗となる。
- [AC-004][workflow] デフォルトproviderによるAI生成が失敗した場合はエラーとなり、生成結果や所有レコードは保存されない。
- [AC-005][auth] 未認証の生成要求は拒否され、AI生成へ到達しない。
- [AC-006][architecture] 生成契約とユースケースが既存video moduleの所有範囲および層依存規則を維持する。

## 検証

- videoドメイン契約、入力validation、変換ユースケース、AI失敗処理、認証付きHTTP境界のfocused testを追加する。
- API共有型のsource of truthと公開contractの整合性を既存のcontract向けtestで検証する。
- `bun run test`
- `bun run architecture:check`
- `bun run verify`
- E2Eは実施しない。

リポジトリの指示書と既存実装を確認し、必要な調査、実装、テスト、修正まで完了してください。完了時は変更内容、検証結果、未解決事項を報告してください。
```

## Phase 2: コードレビュー・修正依頼

Phase 1の最終回答を受け取った後、同じCodex taskへ次をそのまま送信する。

```text
コードレビューをしてください。指摘事項があれば修正してください。
```

## 計測方法

Phase 1とPhase 2の終了時に、それぞれCodexセッションの最新の累積snapshotを記録する。

| 指標 | Phase 1終了時 | Phase 2終了時 | Phase 2増分 |
|---|---:|---:|---:|
| input tokens |  |  | Phase 2終了値 - Phase 1終了値 |
| cached input tokens |  |  | Phase 2終了値 - Phase 1終了値 |
| non-cached input tokens |  |  | input - cached input |
| output tokens |  |  | Phase 2終了値 - Phase 1終了値 |
| reasoning output tokens |  |  | Phase 2終了値 - Phase 1終了値 |
| total tokens |  |  | Phase 2終了値 - Phase 1終了値 |
| elapsed time |  |  |  |
| tool calls |  |  |  |
| command executions |  |  |  |

累積snapshot同士を合算しない。セッション全体はPhase 2終了時のsnapshot、Phase 2単体は終了値とPhase 1終了値の差分とする。

## 成果物比較

実行終了後に以下を記録する。

```bash
git diff --stat
git diff --numstat
```

加えて、以下を比較する。

- 変更ファイル数、追加行、削除行
- 全受入条件の充足
- focused testと全品質ゲートの成否
- コードレビューで見つかった問題数と重要度
- Phase 2後の未解決事項
- module境界、認証、validation、AI失敗処理の設計差
- 総トークン、非キャッシュ入力、キャッシュ率、出力トークン
- tool呼び出し回数、command出力量、所要時間

## 比較時の注意

- 総トークンだけで効率を判断しない。キャッシュ入力、非キャッシュ入力、出力を分ける。
- 実装行数だけで正規化しない。テスト数、検証範囲、tool回数、command出力量も併記する。
- Codexの自律的なtool選択をNightWorkersと一致させようとしない。その差自体を比較対象とする。
- 成果物の品質が異なる場合、トークン量だけを直接比較しない。
- 認証情報、環境変数、provider設定値は記録・共有前にマスキングする。
