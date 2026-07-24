# S11t利用ガイド（NightWorkers Coding Agent向け）

この文書は、NightWorkersへS11tを組み込むコーディングエージェント向けの現行ガイドである。
S11t自体の実装計画ではなく、NightWorkers内で依存関係、生成物、module境界をどう扱うかを定める。

## 現在の状態

- runtimeはnpm公開版`s11tnext`、authoring/build CLIはnpm公開版`s11tnext-cli`を使用する。
- 正確なversionは`package.json`、解決済みversionとintegrityは`bun.lock`を正本として確認する。local checkoutや`vendor/`のtarballをproduction依存へ使わない。
- NightWorkersの全SystemContextは`api/systemContexts/contexts/`のTOMLを正本とし、単一catalogへ生成される。
- production codeは`api/systemContexts/catalog.ts`の型付きrequest bindingを使用する。role別catalogは作らない。
- 現行artifactはversion 2である。0.1.2より前の生成物をruntimeで読み続けず、runtime/CLI更新時にJSONとTypeScript factoryを同時に再生成する。
- 対応Node.jsは20.19以上のNode 20系、Node 22、Node 24である。Node 20.19未満を対応対象にしない。

production runtimeは生成済みcatalogを読むだけであり、CLIの存在を前提にしない。

## runtimeとCLIの選択

| 用途 | 必要なpackage | 備考 |
| --- | --- | --- |
| 生成済みcatalogからSystemContextを組み立てる | `s11tnext` | 通常のproduction実行に必要なのはこちらだけ |
| TOMLをlint、build、stale checkする | `s11tnext-cli` | authoring/build用。production codeからimportしない |
| compiler primitiveを直接検査する | `s11tnext/compiler` | testや診断用途。通常のcatalog利用には不要 |

依存方向は`s11tnext-cli`から`s11tnext`への一方向である。runtimeはCLI、filesystem、TOML
parserに依存しない。NightWorkersの稼働にCLIを前提としないこと。

runtimeとCLIは同じ公開versionへ固定する。CLIを使わない機能実装では、CLI呼び出しやCLI importを追加しない。

## module境界

S11tを使っても、ルート`AGENTS.md`のrole module境界は変わらない。

- 全SystemContext source、生成catalog、bindingはroleやdomainの実装から独立した`api/systemContexts/`が所有する。
- Coding Agent、Mission Pilot、その他domainのkeyはpath由来のcanonical dot keyで区別し、単一catalogで型検査する。
- 各role/domainのコードは共有bindingが公開する型付き`p`、`invoke`だけを使い、SystemContext本文や組み立てロジックを保持しない。
- `api/systemContexts/`にはTOML、生成物、artifact loader、純粋なbindingだけを置き、route、service、repository、role判定、application workflowを置かない。
- S11t共有化を理由に、Mission PilotとCoding Agentのroute、service、repository、tool contractを相互importしない。

全SystemContext移行を明示的に行う場合は、providerへ渡る`systemPrompt`、`developerInstructions`のoriginを
すべて棚卸しし、SystemContext本文または組み立てを保持する個別builderが残っていないことを静的検査する。
ユーザー入力、LLMが生成したTodo、外部`AGENTS.md`、利用者が設定した参照文書、providerへのuser promptは
runtime inputとして扱い、固定SystemContext本文と混同してcatalogへ複製しない。

## runtimeの使い方

S11t CLIが生成するTypeScript factoryを経由してcatalogを作る。これによりkeyとvariablesが型検査され、
生成時のcatalog digestと実行時artifactの一致も検証される。

```ts
import { p } from "../../systemContexts/catalog";

const systemPrompt = p("codingAgent.role-instructions", {});
```

artifact load、locale bind、本文抽出は共有bindingだけが行う。各role/domainでcatalog wrapperを作らない。
共有binding内部ではCLIが生成する`createAppCatalog()`を使用し、generated TypeScriptを手編集して改名しない。
重要な契約は次の通り。

- runtimeへ渡すartifactの型は境界では`unknown`のままにし、runtimeのschema/digest検証を通す。
- 生成型は`PromptKey`、`PromptValueMap`、`PromptMessageRoleMap`を正本とし、runtime invocationには`PromptInvocation`を使う。0.1.2のdeprecated互換名`SystemContextKey`、`SystemContextInvocation`を新規コードで使わない。
- application codeは共有`p()` facadeを使う。NightWorkersはrequest/run入口でlocale bindingを固定し、`p()`はそのrequest-local snapshotを参照する。production codeから`createTextRenderer()`によるlive rendererや個別の`bindText()`を作らない。
- 複数contextから一つのrequest/runを組み立てる場合は、開始時にS11tの`bindRequest()`で固定snapshotを一つ作り、その`p`、`byKey`、`invoke`を処理全体で再利用する。textだけが必要な非監査経路では`bindText()`を使う。
- provider送信、監査、hash、locale manifestが必要な経路ではS11tの`bind()`または`bindRequest()`を維持し、text-only APIへ置き換えない。
- `invocation.manifest`のcompiler version、locale、digest、hashは観測・監査に利用できるが、本文判定の分岐に使わない。
- provider messageを表すcontextはTOMLの`message_role`を明示する。省略時は`system`であり、user messageとして送るcontextには`message_role = "user"`を設定する。adapterは`invocation.role`を実送信roleへ使い、manifestの`messageRole`と`messageHash`を同じrequest IDの監査recordへ保存する。
- provider固有の`developer` messageへ配置するcontextはS11tでは`system`としてauthoringし、NightWorkersの監査境界で`system`から`developer`へのmappingを明示する。`user` contextを`system`/`developer`へ、または`system` contextを`user`へ送るrole不一致はfail-closeする。
- locale bindingは共有bindingだけが所有する。General Settings最上位の`language`をrequest/run開始時に一度だけ読み、`ja`は`ja-JP`、`en`は`en-US`へ対応させる。fallbackは暗黙に追加せず、NightWorkersのproduction bindingは`fallbackLocales = []`として未翻訳localeをfail-closeする。
- 各role/domainのcall siteへlanguage、locale、fallbackを渡すAPIを追加しない。作成済みbindingはimmutable snapshotとして扱い、設定変更後の次の独立したrequest/runで新しいlanguageを反映する。
- applicationがartifact JSONを読み込む。`s11tnext`にpathやfilesystem責務を加えない。
- NightWorkers backendはesbuildでbundleされるため、JSONの読み込み方法を決める際はdev実行だけでなく
  `dist-api`およびdesktop sidecarへartifactが含まれることを確認する。
- loaderの実装前に既存のruntime path/resource所有者を調べ、cwd依存の相対pathを追加しない。

## TOML authoringと生成物

NightWorkers repository内でTOMLを正本として管理する場合だけCLIを使う。設定pathを決めた後、次を実行する。

```bash
bun run s11tnext:lint
bun run s11tnext:build
bun run s11tnext:check
```

`build`はcatalog JSONとgenerated TypeScriptを同時に生成する。次のルールを守る。

- TOML source、catalog JSON、generated TypeScriptを一つの変更単位として更新する。
- generated TypeScriptを手編集しない。
- `build --check`がstaleを報告した状態で完了にしない。
- variableの`trust`、`placement`、`encoding`はprojectのnamed profileまたはcontext固有定義として明示し、非trusted入力をraw inlineへ置かない。
- 複数行のuntrusted文字列にはartifact v2の`delimited-text`を使用できる。JSON構造は`json-value`、単一文字列のJSON encodingは`json-string`を使い、用途に応じて選択する。
- optional variableと`omit_if_empty`は、値が存在しない場合にsection全体を省略する契約が必要なcontextだけで使用する。既存の必須値をpackage更新だけでoptionalへ変えない。
- 全role/domainのSystemContext sourceと生成物は、module境界の例外である`api/systemContexts/`へ一元化する。
- 生成物をGit管理するかbuild artifactとして供給するかを実装計画で決め、loaderとrelease packagingを同時に検証する。

生成済みartifactを別repositoryまたはrelease artifactから受け取る運用では、NightWorkers内にCLIやTOMLを
追加せず、runtimeと検証済みcatalogだけを利用する。

## npm公開版の更新

`s11tnext`と`s11tnext-cli`はnpm registryの同じversionへ固定し、`package.json`と`bun.lock`を同じ変更で更新する。
公開前のlocal checkout、Git URL、canary tarballへ依存元を戻さない。

更新時はnpm registryでruntimeとCLIのversion、engine、exports、CLI binaryを確認する。install後は
`bun.lock`がregistry packageとintegrityを保持し、`s11tnext-cli`のtransitive dependencyも同じ
`s11tnext` versionを解決していることを確認する。

## 検証

変更内容に対応するfocused testに加え、最低限次を実行する。

```bash
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run build:backend
```

TOMLまたは生成物を変更した場合は追加で次を実行する。

```bash
bun run s11tnext:lint
bun run s11tnext:check
```

検証では少なくとも次をassertする。

1. 期待するSystemContext keyとvariablesがgenerated TypeScriptで型検査される。
2. 日本語本文と英語本文が期待通りで、未翻訳localeが暗黙fallbackせずfail-closeする。
3. 不正artifact、digest不一致、未宣言variableがfail-closeする。
4. `invocation.manifest.compilerVersion`が`package.json`で固定した`s11tnext` versionと一致する。
5. providerへ送るroleと`invocation.role`が一致し、`messageRole`と`messageHash`が監査recordへ保存される。
6. backend bundleまたはdesktop sidecarからcatalog artifactを解決できる。
7. Coding AgentとMission Pilotのmodule境界を迂回するimportが増えていない。

広いmodule変更では通常の`bun run verify`も実行する。Node 20互換性が完了条件に含まれる場合は、単に
esbuildの`--target=node20`が成功しただけでなく、Node 20.19環境で公開runtimeのESM importと対象経路を
実行して確認する。

## 禁止事項

- production codeから`s11tnext-cli`をimportする。
- runtimeだけで稼働する経路にCLI executableの存在を要求する。
- generated TypeScriptやcatalog JSONの片方だけを更新する。
- catalog JSONを型castだけで信用し、generated factory/runtime検証を迂回する。
- S11tのhash、encoding、locale fallbackをNightWorkers側で独自再実装する。
- SystemContext以外のrole固有route、service、repository、tool contractを`api/systemContexts`へ置いてmodule境界を迂回する。
- local checkoutやvendor tarballを公開版の代わりに参照する。
- versionやintegrityをこの文書へ固定値として複製する。現在値は`package.json`と`bun.lock`から読む。
