# S11t upstream改善指示

> Status: resolved. `cc606d3`から`f3fa8cb`までのS11t変更でrequest-bound
> audit、実効的なdelimited-context、locale coverage、public rendered hash APIが
> 実装され、`s11tnext@0.1.0`と`s11tnext-cli@0.1.0`として公開された。
> NightWorkersはnpm公開版でこの契約を利用する。

## 目的

NightWorkersのように複数のSystemContextを一つのprovider requestへ組み立てるhostが、locale snapshotとmanifest監査を独自wrapperなしで一貫して扱えるようにする。

既存の`bind()`、`bindText()`、`createTextRenderer()`の互換性は維持する。runtimeへfilesystem、host settings、provider event保存の責務を追加しない。

## 1. Request-bound bindingとcompound auditをruntime APIへ追加する

解決前は、hostが同じ`CatalogBindingV2`を`bindText()`と`bind()`へ別々に渡さないと、固定`p`とmanifest付きinvocationを同時に利用できなかった。また、内側のcontextを`p()`で組み立てて外側のcontextを`bind()`でrenderした場合、外側のmanifestには構成要素となったcontextのrelease情報が残らなかった。

次の性質を持つrequest-bound APIを追加する。

- bindingを作成時に一度だけ検証・snapshot化する。
- 型付き`p`、`byKey`、manifest付き`invoke`を同じsnapshotから提供する。
- request内でrenderされたcontextのmanifestを、呼出順を維持したimmutableなaudit snapshotとして取得できる。
- 最終provider promptに対応するinvocationを明示でき、その`renderedHash`と構成contextのmanifestを一つの監査recordへまとめられる。
- 実送信textとmanifestをhostが照合できるよう、domain separationを内包した
  `hashRendered(text)`または`verifyRenderedHash(text, digest)`をpackage rootから公開する。
  hostへ`"s11t.rendered.v1\0"`の再実装を要求しない。
- 同一key・同一valuesの重複呼出を保持するかdedupeするかをAPI契約で明示する。
- collectorはrequest localとし、global stateや`AsyncLocalStorage`へ依存しない。

API名は任意だが、利用側が次のような処理を独自の`invocation.content.text`抽出wrapperなしで書けること。

```ts
const request = catalog.bindRequest(binding);
const role = request.p("codingAgent.role", {});
const final = request.invoke("codingAgent.provider-prompt", { role });
const audit = request.finalize(final);
```

`audit`には少なくとも以下を含める。

- final invocationの完全なmanifest
- 構成contextごとのrequested/resolved key
- catalog digest
- release digest
- requested/resolved localeとfallback
- compiler version
- artifact/rendered hash

## 2. `placement = "delimited-context"`を実効的な安全契約にする

解決前のruntimeは`trust`と`placement`をartifact metadataとして保持する一方、render時には`encoding`だけが本文へ作用していた。そのため`untrusted.json`を指定しても、authorが明示的なdelimiterを書かなければruntime inputの境界はprompt本文に現れなかった。

次のどちらかをartifact schema versionを含めて設計し、silentな本文変更を避けて導入する。

1. compiler/runtimeが決定的なdelimiterを自動生成する。
2. authoring側にdelimiter契約を追加し、lint/buildが全localeでdelimiter内にvariableがあることを検証する。

最低要件:

- `trust = "untrusted"`かつ`placement = "delimited-context"`のvariableが、境界なしのinline展開にならない。
- delimiterを動的値が閉じられないよう、`<`、`>`、`&`、U+2028、U+2029を含むJSON/string encodingを検証する。
- simple contextとsectioned contextの全localeで同じ安全条件を検証する。
- 既存artifactのrendered textを暗黙に変更しない。必要なら新しいartifact schemaまたは明示的opt-inを使う。
- trust/placementが宣言だけのmetadataであり続ける場合は、その事実をruntime READMEへ明記し、誤解を招く`delimited-context`契約を見直す。

## 3. Locale rolloutのcatalog coverage診断を追加する

一部contextだけに翻訳を追加する段階的rolloutを監査できるCLI出力を追加する。

必要な出力:

- 対象localeについて、direct、fallback、missingのcontext件数とkey一覧
- fallback先locale
- source locale
- release profileのrequired localeを満たしているか
- machine-readable JSON形式

例:

```bash
s11tnext inspect --coverage --locale en-US --release-profile development --format json
```

`build --check`の成否は既存required locale契約のまま維持し、coverage診断だけで任意localeをrequired扱いしない。

## 検証

- runtime単体testでbinding resolverがrequest作成時に一度だけ評価される。
- request途中でhost設定を変更しても、`p`、`invoke`、compound auditのlocaleが変わらない。
- compound auditのfinal `renderedHash`が、実送信textへS11tの
  `s11t.rendered.v1\0` domain separationを適用した値と一致する。
- publicなrendered hash APIとruntime内部の計算結果が一致する。
- 構成contextのrelease digestがすべて取得できる。
- untrusted値がdelimiterを閉じようとするfixtureを安全にrenderまたはcompile拒否できる。
- ja-JPのみ、en-US direct、en-US fallback、missingのcoverage fixtureを検証する。
- Node 20.19、22、24のESM consumerでruntime APIを検証する。

## NightWorkersへの反映

NightWorkersはruntimeとCLIをnpm registryの同じversionへ固定し、`bun.lock`に公開tarballのintegrityを保持する。
更新後は`bun run s11tnext:check`、focused test、`bun run typecheck`、`bun run build:backend`を実行し、provider request eventに保存したauditが新API由来であることを確認する。
