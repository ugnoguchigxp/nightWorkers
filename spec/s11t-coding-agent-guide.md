# S11t利用ガイド（NightWorkers Coding Agent向け）

この文書は、NightWorkersへS11tを組み込むコーディングエージェント向けの現行ガイドである。
S11t自体の実装計画ではなく、NightWorkers内で依存関係、生成物、module境界をどう扱うかを定める。

## 現在の状態

- 現在の`@s11t/runtime`と`@s11t/cli`は、S11tのコミット済みHEADから作成したcanary tarballである。正式versionとcommitは`vendor/s11t/manifest.json`およびREADMEから確認する。
- 正確なversionとSHA-512は`vendor/s11t/manifest.json`を正本として確認する。
- NightWorkersの全SystemContextは`api/systemContexts/contexts/`のTOMLを正本とし、単一catalogへ生成される。
- production codeは`api/systemContexts/catalog.ts`の型付き`p(key, values)`を使用する。role別catalogは作らない。
- 対応Node.jsは20.19以上のNode 20系、Node 22、Node 24である。Node 20.19未満を対応対象にしない。

production runtimeは生成済みcatalogを読むだけであり、CLIの存在を前提にしない。

## runtimeとCLIの選択

| 用途 | 必要なpackage | 備考 |
| --- | --- | --- |
| 生成済みcatalogからSystemContextを組み立てる | `@s11t/runtime` | 通常のproduction実行に必要なのはこちらだけ |
| TOMLをlint、build、stale checkする | `@s11t/cli` | authoring/build用。production codeからimportしない |
| compiler primitiveを直接検査する | `@s11t/runtime/compiler` | testや診断用途。通常のcatalog利用には不要 |

依存方向は`@s11t/cli`から`@s11t/runtime`への一方向である。runtimeはCLI、filesystem、TOML
parserに依存しない。NightWorkersの稼働にCLIを前提としないこと。

現在CLI tarballもvendorされているのは、S11tのruntimeとCLIを同じcanaryとして検証するためである。
CLIを使わない機能実装では、CLI呼び出しやCLI importを追加しない。CLI tarballやdevDependencyの削除は
dependency構成を変更する別作業として扱い、機能実装のついでに変更しない。

## module境界

S11tを使っても、ルート`AGENTS.md`のrole module境界は変わらない。

- 全SystemContext source、生成catalog、bindingはroleやdomainの実装から独立した`api/systemContexts/`が所有する。
- Coding Agent、Mission Pilot、その他domainのkeyはpath由来のcanonical dot keyで区別し、単一catalogで型検査する。
- 各role/domainのコードは共有bindingが公開する型付き`p(key, values)`だけを使い、SystemContext本文や組み立てロジックを保持しない。
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
- 独立したtext取得にはS11tの`createTextRenderer()`で生成したlive `p()`を使い、NightWorkers独自の`invocation.content.text`抽出wrapperを作らない。
- 複数contextから一つのrequest/runを組み立てる場合は、開始時にS11tの`bindText()`で固定snapshotを一つ作り、その`p`または`byKey`を処理全体で再利用する。
- provider送信、監査、hash、locale manifestが必要な経路ではS11tの`bind()`を維持し、text-only APIへ置き換えない。
- `invocation.manifest`のcompiler version、locale、digest、hashは観測・監査に利用できるが、本文判定の分岐に使わない。
- locale bindingは共有bindingだけが所有する。General Settings最上位の`language`を呼出時に読み、`ja`は`ja-JP`、`en`は`en-US`へ対応させる。英語本文が未整備の間だけ、`en-US`へ`fallbackLocales = ["ja-JP"]`を明示する。
- 各role/domainのcall siteへlanguage、locale、fallbackを渡すAPIを追加しない。作成済み`bindText()`はimmutable snapshotとして扱い、設定変更後の次のlive `p()`呼出で新しいlanguageを反映する。
- applicationがartifact JSONを読み込む。`@s11t/runtime`にpathやfilesystem責務を加えない。
- NightWorkers backendはesbuildでbundleされるため、JSONの読み込み方法を決める際はdev実行だけでなく
  `dist-api`およびdesktop sidecarへartifactが含まれることを確認する。
- loaderの実装前に既存のruntime path/resource所有者を調べ、cwd依存の相対pathを追加しない。

## TOML authoringと生成物

NightWorkers repository内でTOMLを正本として管理する場合だけCLIを使う。設定pathを決めた後、次を実行する。

```bash
bun run s11t:lint
bun run s11t:build
bun run s11t:check
```

`build`はcatalog JSONとgenerated TypeScriptを同時に生成する。次のルールを守る。

- TOML source、catalog JSON、generated TypeScriptを一つの変更単位として更新する。
- generated TypeScriptを手編集しない。
- `build --check`がstaleを報告した状態で完了にしない。
- variableの`trust`、`placement`、`encoding`はprojectのnamed profileまたはcontext固有定義として明示し、非trusted入力をraw inlineへ置かない。
- 全role/domainのSystemContext sourceと生成物は、module境界の例外である`api/systemContexts/`へ一元化する。
- 生成物をGit管理するかbuild artifactとして供給するかを実装計画で決め、loaderとrelease packagingを同時に検証する。

生成済みartifactを別repositoryまたはrelease artifactから受け取る運用では、NightWorkers内にCLIやTOMLを
追加せず、runtimeと検証済みcatalogだけを利用する。

## canaryの更新

正式なcanaryへ更新するときは、vendor内のtarball、manifest、README、`package.json`、`bun.lock`を手作業で個別更新しない。隣接する
S11t checkoutのコミット済み`HEAD`から自動配備する。working tree由来のversion `0.0.0`は、S11tをcommitしてcanaryを発行するまで正式な配備候補として扱わない。

```bash
cd ../S11t
pnpm deploy:nightworkers-canary -- --target ../nightWorkers --verify
```

このcommandはS11tのrelease dry-run、package内容、隔離ESM consumer、auditを通した後、NightWorkersの
vendorと依存関係を更新する。NightWorkersのfrozen install、runtime import、CLI smokeを確認し、`--verify`
指定時はNightWorkersのtypecheckとbuildも実行する。途中で失敗した場合は管理対象fileを配備前へ戻す。

注意事項:

- canary versionはS11tの40桁commit SHAに固定される。未コミットのS11t変更は配備されない。
- npm publishやregistry installは行わない。
- CLIが存在する間は、BunがCLIのtransitive runtimeをnpmへ取りに行かないようruntime overrideを維持する。
- 配備後は`vendor/s11t/manifest.json`、`package.json`、`bun.lock`が同じtarball名を指すことを確認する。

## 検証

変更内容に対応するfocused testに加え、最低限次を実行する。

```bash
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run build:backend
```

TOMLまたは生成物を変更した場合は追加で次を実行する。

```bash
bun run s11t:lint
bun run s11t:check
```

検証では少なくとも次をassertする。

1. 期待するSystemContext keyとvariablesがgenerated TypeScriptで型検査される。
2. 日本語本文とlocale fallbackが期待通りである。
3. 不正artifact、digest不一致、未宣言variableがfail-closeする。
4. `invocation.manifest.compilerVersion`がvendorしたruntime versionと一致する。
5. backend bundleまたはdesktop sidecarからcatalog artifactを解決できる。
6. Coding AgentとMission Pilotのmodule境界を迂回するimportが増えていない。

広いmodule変更では通常の`bun run verify`も実行する。Node 20互換性が完了条件に含まれる場合は、単に
esbuildの`--target=node20`が成功しただけでなく、Node 20.19環境でvendorしたruntimeのESM importと対象経路を
実行して確認する。

## 禁止事項

- production codeから`@s11t/cli`をimportする。
- runtimeだけで稼働する経路にCLI executableの存在を要求する。
- generated TypeScriptやcatalog JSONの片方だけを更新する。
- catalog JSONを型castだけで信用し、generated factory/runtime検証を迂回する。
- S11tのhash、encoding、locale fallbackをNightWorkers側で独自再実装する。
- SystemContext以外のrole固有route、service、repository、tool contractを`api/systemContexts`へ置いてmodule境界を迂回する。
- canary tarballを展開・編集・再圧縮する。
- versionやSHAをこの文書へ固定値として複製する。現在値はvendor manifestから読む。
