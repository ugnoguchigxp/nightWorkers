# NightWorkers E2E Testing Policy

## 目的

NightWorkers の主要な利用経路、永続化、状態遷移、失敗経路を、実行ごとに隔離された SQLite DB と fixture workspace を使って検証する。

E2E の網羅性はコード行ではなく、`tests/e2e/scenario-catalog.json` に登録した利用シナリオを分母として評価する。

## 対象

- React UI、API、SQLite を通る主要操作
- Task、Run、Review、Archive の状態遷移
- Queue、失敗、復帰、closeout の主要経路
- 主要画面の accessibility
- E2E 専用 fixture runtime

## 対象外

- NightWorkers が外部プロジェクトへ追加する E2E の実装方針
- コーディングエージェントや LLM provider の運用規約
- unit test のコードカバレッジを E2E 網羅率として扱うこと
- credential 必須の live LLM E2E を deterministic gate に含めること

## Suite 区分

- `smoke`: 起動、画面、API の最小疎通確認
- `regression`: 独立 DB と fixture runtime だけで再現できる回帰テスト
- `accessibility`: axe、keyboard、focus、reduced motion、accessible name
- `live`: 実 provider credential を使う opt-in テスト

`smoke` は高速確認用であり、単独では E2E 網羅率を証明しない。品質ゲートは live を除く full deterministic suite を使う。

## シナリオ台帳

`tests/e2e/scenario-catalog.json` を網羅率の分母と数値基準の正本とする。

- `required`: 現在の品質ゲートの分母に含める。
- `planned`: 未実装または未合意の候補として可視化するが、分母には含めない。品質要件へ昇格するときは `required` に変更し、対応テストを追加する。
- `observational`: live E2E など、通常の deterministic gate から分離する。

テストファイル数や `test()` 件数を分母にしない。同じ scenario ID を複数テストで使っても、網羅率では一意なシナリオとして数える。

新しい主要操作、永続化、状態遷移、失敗経路を追加するときは、scenario catalog への追加または既存シナリオの更新要否を確認する。網羅率を上げる目的でシナリオを削除したり、P0 を降格したりしない。

## 網羅性指標

- P0 シナリオ網羅率: 100%
- 重み付き required シナリオ網羅率: 80% 以上
- 自動化済み required シナリオの full deterministic 成功率: 100%
- P0 シナリオの flaky 件数: 0

優先度の重みと閾値は scenario catalog の `weights` と `thresholds` を機械的に使用する。

## テスト作成規則

各テストは次を明確にする。

1. 前提データまたは fixture
2. ユーザー操作または API 操作
3. UI 上の期待結果
4. 永続化を扱う場合の API、DB、event、git diff のいずれかの証拠
5. cleanup
6. `@scenario:<ID>`、`@p0|@p1|@p2`、`@deterministic|@live` tag

画面を開いただけのテストを、永続化や状態遷移のシナリオ網羅として数えない。`test.skip`、未実行、flaky retry を通常成功と同一視しない。

## DB 隔離

- Playwright は必ず `scripts/run-playwright.mjs` 経由で実行する。
- 開発用 `DATABASE_URL` と起動済み dev server を使用しない。
- DB、runtime settings、fixture workspace は E2E run root 配下へ置く。
- 成功、失敗、SIGINT、SIGTERM のいずれでも run root を cleanup する。
- live E2E を除き provider credential を子 process へ渡さない。

## 実行とゲート

- `bun run test:e2e:smoke`: 高速な疎通確認
- `bun run test:e2e:regression`: regression tag の実行
- `bun run test:e2e:a11y`: accessibility 単独実行
- `bun run test:e2e:coverage`: live を除く full deterministic E2E、JSON 集計、coverage gate
- `bun run test:e2e:agent-live`: opt-in live LLM E2E
- `bun run verify:e2e`: `test:e2e:coverage` を正式な E2E 品質ゲートとして実行

Playwright が失敗した場合も `test-results/e2e-coverage.json` を可能な限り残す。未登録 scenario ID、priority tag 不一致、P0 未自動化、閾値未達、required scenario の skip / failure はゲート失敗とする。

## Mission Pilot E2E

Mission PilotのTask Operator migrationは完了している。対応するdeterministic specは
通常のPlaywright実行と`verify:e2e`へ含め、実装済みscenarioをcatalogの`required`
として扱う。`verify:e2e`、`verify:full`、`verify:release`でE2Eを空実行へ
置き換えてはならない。

旧pre-Queue handoffと旧through-Archive固定workflowはTask Operator Agentへ
置き換えられたため、対応scenarioはcatalogにretired migration recordとして残す。
この2件を再実装して旧workflowを復活させてはならない。

Legacy Review sessionの作成・実行routeも現在はproduction APIから削除済みのため、
`git-closeout.spec.ts`と`test-review-workflow.spec.ts`を同様に通常gateから除外し、
対応scenarioを`planned`として追跡する。診断目的で旧契約を実行する場合だけ
`NIGHTWORKERS_E2E_LEGACY_REVIEW=1`を指定する。新しいTask Operator Review契約へ
テストを移行した後は、この除外と環境変数を削除して`required`へ戻す。

## 実行成果物

- `test-results/e2e-results.json`: Playwright JSON reporter の生結果
- `test-results/e2e-coverage.json`: scenario coverage、未網羅、失敗、flaky、planned 一覧
- `playwright-report/`: HTML report
- failure 時の screenshot / trace

成果物は生成物として扱い、Git へ追加しない。

## LLM fixture catalog

Mission PilotとCoding Agentのdeterministic E2Eで使用するassistant本文は、
`api/e2eFixtures/llmCatalog/contexts/`のTOMLを正本とする。tool call、arguments、
condition、turn順序はrole moduleのfixture builderが所有し、catalogへJSON scenario
として格納しない。

fixture本文を追加・変更した場合は、次を同じ変更単位で実行し、TOML、catalog JSON、
generated TypeScriptを同時に更新する。

```bash
bun run s11tnext:fixtures:lint
bun run s11tnext:fixtures:build
bun run s11tnext:fixtures:check
```

E2Eは`/api/e2e/fixtures/mission-pilot-agent-scenario`または
`/api/e2e/fixtures/coding-agent-scenario`へ明示的なscenario enumを登録してから実行する。
fixture選択にTask本文、prompt keyword、正規表現、provider error本文を使わない。
Task-scoped fixture stateはprocess memoryだけに保持し、Task cleanup時に破棄する。
このE2Eはagent/application control planeを検証するものであり、OpenAI、Azure、
Bedrock、Codex SDKのtransport互換性を保証しない。
