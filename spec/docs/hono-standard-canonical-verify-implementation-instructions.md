# hono-standard 正本verify契約 実装指示書

## 新しいセッションへの依頼

`hono-standard`テンプレートの`LLM_CONTEXT.md`へ、Projectの正本品質ゲートが`bun run verify`であることと、そこに内包される個別scriptの扱いをProject contractとして明記してください。

この変更の目的は、Coding Agentが`typecheck`、`lint`、`format:check`、`test:coverage`、`build`を事前の独立検証として重ねて実行せず、Projectが提供する短いfail-fastの`verify`出力を検証の主導線として使用できるようにすることです。

`AGENTS.md`は追加しません。`package.json`の個別scriptも削除しません。NightWorkers側のSystemContext、runtime、tool、MCP、completion判定は変更対象外です。

## 対象repository

- Repository: `hono-standard`
- 主対象: `LLM_CONTEXT.md`
- 確認対象: `package.json`、`scripts/verify.ts`、`docs/delivery-quality-gates.md`
- 対象branch・variantでは、実体のscript構成を確認して本文を一致させること

作業開始時に現在のbranch、Git状態、既存変更を確認してください。既存の未commit変更は利用者の作業として保持し、本件と無関係なファイルを修正しないでください。

## 確認済みの現行契約

現行の`package.json`は次のscriptを公開しています。

- `verify`
- `typecheck`
- `lint`
- `format`
- `format:check`
- `test`
- `test:coverage`
- `build`
- `verify:e2e`
- `verify:all`
- `verify:strict`

現行の`scripts/verify.ts`は、次の工程を順に実行します。

1. `typecheck`
2. `lint`
3. `format:check`
4. `test`
5. `test:coverage`
6. `build`

成功した工程は`OK <step>`だけを出力し、失敗した工程だけcommandとstdout/stderrを表示して終了します。このfail-fastと出力抑制は維持してください。

`docs/delivery-quality-gates.md`でも、`bun run verify`がstatic checks、tests、coverage、buildを束ねる`DQ-BASE-001`の基本commandとして定義されています。

## 目的

`LLM_CONTEXT.md`を読むCoding Agentが、次のProject固有Factを曖昧なく取得できる状態にします。

- 正本品質ゲートは`bun run verify`である。
- `verify`はtypecheck、lint、format check、unit/contract/integration test、coverage、production buildを内包する。
- 内包scriptは追加の品質ゲートではない。
- 内包scriptを`verify`前の事前検証として重ねて実行しない。
- `verify`失敗後は、報告された失敗工程の診断または修正に限って個別commandを使用できる。
- sourceを変更した後は`bun run verify`全体を再実行する。
- 個別commandの成功をProject完了の証跡として扱わない。
- `bun run format`はsourceを変更する修正操作であり、検証証跡ではない。

## LLM_CONTEXT.mdの責務

`LLM_CONTEXT.md`は、タスクごとの実装順序や完了条件ではなく、repositoryに恒常的に存在する構造、境界、Project contractを説明します。

現行冒頭の次の記述は、正本品質ゲートのProject contractまで除外しているように読めます。

> タスクの進め方、エージェントの探索手順、実装順序、検証条件、完了条件は扱わない。

この責務境界を次の趣旨へ修正してください。

> タスク固有の進め方、探索手順、実装順序、検証計画、完了条件は扱わない。ただし、Projectが恒常的に提供する正本品質ゲートと、その構成scriptの関係はProject contractとして記載する。

そのうえで、独立した`Verification Contract` sectionを追加してください。

## 必須文意

実際の文体は既存の`LLM_CONTEXT.md`へ合わせてよいですが、少なくとも次の文意を維持してください。

```md
## Verification Contract

- このProjectの正本品質ゲートは`bun run verify`である。
- `bun run verify`はtypecheck、Biome lint、format check、Vitest test、
  coverage threshold、production buildを内包する。
- 内包される個別scriptは独立した品質ゲートではなく、`verify`が利用可能な
  状態で事前検証として重ねて実行しない。
- `verify`が失敗した場合だけ、報告された失敗工程の診断または修正に必要な
  個別commandを使用できる。
- sourceを変更した後は`bun run verify`全体を再実行し、その成功だけを
  Project品質ゲートの証跡として扱う。
- `bun run format`はsourceを変更する修正操作であり、検証証跡ではない。
- E2Eは`bun run verify`へ含まれない。E2Eを要求された場合だけ
  `bun run verify:e2e`または`bun run verify:all`を使用する。
```

`verify`の構成がbranchまたはvariantで異なる場合は、上記のscript名を推測で複製せず、そのbranchの`package.json`とverify実装に一致させてください。

## 個別commandの扱い

### 実行しないケース

`verify`が利用可能な場合、次を「念のため」「先に早く確認するため」「完了確認を強めるため」という理由で事前に重ねて実行しません。

- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `bun run test:coverage`
- `bun run build`

`verify`成功後に同じ個別commandを再実行することも、追加の完了証跡にはしません。

### 実行できるケース

個別commandは次の場合だけ使用できます。

- `verify`が報告した失敗工程を局所的に再現する。
- 失敗原因を診断するために、当該工程だけの追加情報が必要である。
- `bun run format`など、失敗を修正する操作を行う。
- 実装中の局所変更に対してfocused testを実行する。ただし、最終品質ゲートには使用しない。
- `verify`自体が存在しない、または環境上実行不能であり、その理由を明示して代替検証を選ぶ。

個別commandを使用してsourceを変更または確認した後も、完了前には`bun run verify`全体を再実行します。

## package.jsonの扱い

個別scriptは削除、非公開化、難読な名前への変更をしません。

理由:

- `scripts/verify.ts`が個別scriptを構成要素として呼び出している。
- 人間とCIが局所的な診断に使用できる必要がある。
- scriptを削除しても、tool executableの直接実行を防げず、Coding Agentの不要なcommand実行を構造的には禁止できない。
- 本件の目的はcommand capabilityの削減ではなく、正本品質ゲートのProject contractを明示することである。

`package.json`または`scripts/verify.ts`に現行契約との不一致を発見した場合は、勝手に構成を変更せず、確認済みの不一致として報告してください。

## docs/delivery-quality-gates.mdの扱い

`docs/delivery-quality-gates.md`は人間向けの詳細なDelivery品質契約として維持します。

- `LLM_CONTEXT.md`から全文を複製しない。
- `LLM_CONTEXT.md`にはCoding Agentが行動選択に必要な最小のProject contractだけを記載する。
- `docs/delivery-quality-gates.md`の`DQ-BASE-001`と矛盾する記述を追加しない。
- 必要なら`Verification Contract`から詳細文書への参照を1件だけ追加してよい。

## 禁止事項

- `AGENTS.md`を追加する。
- `package.json`から個別scriptを削除する。
- `scripts/verify.ts`を個別scriptへ依存しない巨大な単一commandへ書き換える。
- `verify`のfail-fast、成功時の短い出力、失敗時だけ詳細を返す契約を壊す。
- coverage thresholdを下げる。
- E2Eを通常の`bun run verify`へ追加する。
- `LLM_CONTEXT.md`へNightWorkers固有のruntime、MCP、Todo、completion、SystemContextの説明を追加する。
- `LLM_CONTEXT.md`へタスク固有の実装workflowや固定手順を追加する。
- 個別commandを実行不能にするshell wrapperやcommand allowlistを追加する。
- 本件と無関係なtemplate、auth、DB、frontend、testを変更する。

## 受け入れ条件

- [ ] `LLM_CONTEXT.md`の責務説明が、Project固有の正本品質ゲート契約を扱える表現へ更新されている。
- [ ] `LLM_CONTEXT.md`に独立した`Verification Contract` sectionがある。
- [ ] 正本品質ゲートが`bun run verify`だと明記されている。
- [ ] `verify`が内包する工程が、実際の`package.json`と`scripts/verify.ts`に一致している。
- [ ] 内包scriptを事前の独立検証として重ねて実行しないことが明記されている。
- [ ] `verify`失敗後の診断・修正に限り、個別commandを使用できることが明記されている。
- [ ] source変更後は`bun run verify`全体を再実行することが明記されている。
- [ ] `bun run format`が修正操作であり、検証証跡ではないと明記されている。
- [ ] E2Eが通常の`verify`へ含まれず、明示要求時だけ実行されることが明記されている。
- [ ] `AGENTS.md`を追加していない。
- [ ] `package.json`の個別scriptを削除または改名していない。
- [ ] `scripts/verify.ts`のfail-fastと出力抑制を変更していない。
- [ ] 本件と無関係な既存変更へ触れていない。
- [ ] 最終的な`bun run verify`が成功している。

## 検証

実装後は、個別のtypecheck、lint、format check、coverage、buildを事前に重ねず、正本commandを実行してください。

```bash
bun run verify
```

失敗した場合は、表示された失敗工程だけを診断・修正し、source変更後に同じ`bun run verify`を再実行してください。

文書変更だけを理由に、文章の完全一致を固定する脆いtestを新設する必要はありません。既存のdocumentation lint、link check、template contract testがある場合だけ、その既存パターンへ最小限追加してください。

## 作業完了時の報告

最終報告には次を含めてください。

1. `LLM_CONTEXT.md`で変更した責務説明。
2. 追加した`Verification Contract`の要点。
3. `package.json`と`scripts/verify.ts`を変更していないこと。
4. `AGENTS.md`を追加していないこと。
5. 既存の無関係な変更へ触れていないこと。
6. 実行した`bun run verify`の結果。
7. 未解決事項またはbranch・variant間の契約差があれば、その内容。
