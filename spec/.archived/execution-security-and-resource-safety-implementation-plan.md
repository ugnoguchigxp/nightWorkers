# Execution Security / Resource Safety 実装計画

## Status

- Plan status: `proposed`
- Document created: 2026-08-16
- Parent program: [Codebase Review Remediation Program](./codebase-review-remediation-program-index.md)
- Findings: `C1`, `C2`, `C3`, `M4`, `M12`, `m5`
- Implementation authorization: not started

## 1. 目的

Coding Agentが利用するcommand、URL fetch、background process、Git subprocess、file readを、
文字列prefixの偶然やprocess lifetimeに依存しない構造的なsecurity/resource境界へ変更する。

変更後は次を満たす。

1. 許可されたcommandの後ろにshell operatorを追加して別commandを実行できない。
2. Project secretは`read_file`だけでなく、command subprocessからも取得できない。
3. `fetch_content`はloopback、private、link-local、metadata、redirect先のprivate addressへ接続しない。
4. 外部reader serviceへURLを無断送信しない。
5. Run所有background processはRun終端時に停止する。
6. Git subprocessとfile readに明示的なresource上限がある。

## 2. 非目的

- ユーザー文言やerror messageからcommandの意図を推測しない。
- Coding Agentへ意味別mode、固定workflow、新しいtool allowlistを追加しない。
- 任意のremote URLをdomain allowlistへ固定しない。
- OS再起動後にPIDだけを根拠として未知processをkillしない。
- Git merge、Review、Task完了の意味判断をこのAreaへ移さない。
- `read_file`の出力圧縮、digest、paging contractを削除しない。

## 3. 現行の確認済み不足

### 3.1 Command policy

- `hasUnsafeChain`は`&&`と`;`だけを拒否する。
- 実行はBash `-c`であり、pipe、OR、改行、redirectがshellとして評価される。
- `echo ok | touch PWNED`、`echo ok || touch PWNED`、改行、`>`が`read_only`として受理される。

### 3.2 Secret boundary

- `project-secret-paths`は存在するが、`run_command`のpolicy enforcementから参照されない。
- `cat .env`と`rg . .env`が許可される。
- command引数だけを検査しても、scriptやchild process経由のreadを防げない。

### 3.3 Outbound fetch

- URL validationは`http:`/`https:`のみである。
- native fetchの自動redirect後にaddressを再検査しない。
- 127.0.0.1、localhost、169.254.169.254、`::1`が受理される。
- HTTP errorまたはlow-signal HTML時にJina Readerへ自動fallbackする。

### 3.4 Process / file resource

- background processはdetached process groupとして起動するが、Run単位の停止経路がない。
- Git merge helperは`maxBuffer`を持つがtimeoutと統一された非対話環境を持たない。
- `read_file`は全内容をUTF-8として読み込んだ後に1,000行へ切り詰める。

## 4. Target invariants

1. Shell構文の安全性判定は、quoteを認識するparserまたはargv contractを正本とし、正規表現の
   substring判定を正本にしない。
2. `run_command`がshell文字列を受け付ける期間は、単一command node以外をfail-closeする。
3. Project secretへのread denyは、tool引数検査とsubprocess confinementの両方で強制する。
4. Outbound HTTPは、接続するIP addressを検査した同一requestで使用し、redirectごとに再検査する。
5. URL userinfo、非HTTP scheme、loopback/private/link-local/unspecified/multicast/metadata addressを拒否する。
6. Third-party reader fallbackは既定無効とし、明示設定と監査eventなしに使用しない。
7. Run終端cleanupはidempotentで、同じprocessを複数回停止しても結果が変わらない。
8. subprocess timeoutはtyped failureとなり、timeoutを通常のcommand failureへ曖昧化しない。
9. file size超過とbinary判定はread前またはbounded prefix read時に行う。

## 5. Ownership

| Concern | Owner |
| --- | --- |
| Command AST / argv policy | `api/services/worker-tools` |
| Secret path catalog | `api/services/security` |
| Workspace subprocess confinement | `api/services/execution` |
| Safe outbound HTTP | `api/services/security`またはagent非依存のHTTP service |
| `fetch_content` adapter | `api/services/worker-tools` |
| Background process lifecycle | `api/services/background-processes` |
| Run terminal hook | Area Bが所有するapplication command / port |
| Git subprocess runner | agent非依存の`api/services/execution` |

`api/services/background-processes`からNightWorkers Run repositoryを直接操作しない。Area Bが公開する
terminal hookまたはapplication portから、`runId`を指定してcleanupを呼び出す。

## 6. Implementation phases

### Phase A0: Failing regression tests

#### Implementation

- command policyに次のtable-driven testを追加する。
  - `|`、`||`、`&`、改行、CRLF、`>`、`>>`、`<`、heredoc。
  - backtick、`$()`、process substitution。
  - quote内のliteral operatorとoperator nodeを区別するcase。
- `cat .env`、`rg . .env`、absolute secret path、symlink経由、script経由のreadを追加する。
- `fetch_content`にIPv4/IPv6 private address、hostname解決、redirect chain、mixed address record、
  redirect limit、userinfo、Jina opt-inのtestを追加する。
- Run終端時のbackground process cleanup、Git timeout、large/binary fileのtestを追加する。

#### Acceptance

- `C1`〜`C3`の既知caseがproduction code変更前に失敗する。
- test内で実在Project secretを出力しない。fixture secretをisolated repositoryに作成する。

### Phase A1: Command structureをfail-closeする

#### Implementation

1. command文字列をquote-awareにparseし、単一のsimple command nodeへ正規化する。
2. pipeline、list、redirect、background、subshell、command/process substitutionを構造として拒否する。
3. executableとargvをpolicy decisionへ渡し、先頭tokenだけでread-only判定しない。
4. `run_command`と`run_background_command`が同じparser/decision contractを使用する。
5. parse不能なcommandは`COMMAND_BLOCKED`とし、Bashへ渡さない。
6. policy decisionに拒否した構造種別を保持するが、raw secretをlogへ保存しない。

#### Migration

- tool inputの`command: string`は互換期間中維持する。
- 内部では`ParsedCommand`へ変換し、実行層へraw commandだけを渡さない。
- 将来の`program`/`args` contract化は別versionとして行い、本PhaseでAPIを二重化しない。

#### Acceptance

- 許可された単一commandは従来どおり実行できる。
- operatorを追加した全caseがBash起動前に拒否される。
- command policyと実行層が異なる構文解釈を持たない。

### Phase A2: Secret readをsubprocess境界で拒否する

#### Implementation

1. `project-secret-paths`からcanonical deny pathを生成する共通関数を追加する。
2. parsed argvに現れるpathはrealpathとworkspace rootを基準に検査する。
3. workspace confinement profileへsecret pathのread denyを追加し、script/child process経由も拒否する。
4. symlink、relative traversal、case sensitivity、`.env.*`、`*.pem`、`*.key`、registry credential fileを
   既存catalogと同じ意味で扱う。
5. confinementを要求するagent Runから、非confinement command executionへfallbackしない。
6. deny時はfile内容を含まないtyped errorと監査eventを返す。

#### Acceptance

- `read_file`、`search_files`、`run_command`、background commandでsecret判定が一致する。
- shell script内からsecretを開くcaseもOS confinementで失敗する。
- `.env.example`など、catalog上secretでないfixtureの扱いを明示testする。

### Phase A3: SSRF-safe outbound fetch

#### Implementation

1. agent非依存の`safeOutboundFetch`を追加する。
2. hostnameを解決し、返った全addressをIPv4/IPv6分類する。
3. 許可済みaddressへ接続を固定し、Host/SNIは元hostnameを維持する。
4. redirectを自動追従せず、上限付きで1 hopずつresolve・validateする。
5. response bodyはContent-Lengthとstreamed byte countの両方で上限を強制する。
6. Jina fallbackは既定無効にする。使用可能にする場合は設定、対象public URLの再検査、
   third-party disclosure eventを必須にする。
7. `finalUrl`は実際に検証済みの最終URLだけを返す。

#### Acceptance

- loopback/private/metadataへ直接またはredirectで到達できない。
- public hostnameがprivate addressも返す場合はfail-closeする。
- redirect loopと上限超過がtyped failureになる。
- Jina無効時に第三者requestが一度も発生しない。

### Phase A4: Run-owned background process cleanup

#### Implementation

1. `listRunningBackgroundProcessesForRun(runId)`と`stopBackgroundProcessesForRun(runId, reason)`を追加する。
2. managed process groupへSIGTERMを送り、猶予後も生存する場合だけSIGKILLする。
3. DB rowのterminal updateをstatus CASにし、close eventとの競合をidempotentに扱う。
4. Area Bのterminal transition成功後にcleanup portを呼ぶ。
5. API restart後にtrackingを失ったPIDはkillせず`lost`として記録する。

#### Acceptance

- cancelled、failed、timed_out、completedの各Runでrun-owned processが残らない。
- repository-ownedでRunに属さないprocessは停止しない。
- cleanup失敗はRun terminal stateを巻き戻さず、監査eventと再試行可能な状態を残す。

### Phase A5: Git runner / bounded file read

#### Implementation

- `nightworkers.git-merge.service.ts`の全Git呼び出しを既存のbounded runnerへ寄せる。
- command別の明示timeout、output cap、`GIT_TERMINAL_PROMPT=0`等の非対話環境を設定する。
- timeout、signal、output overflowをtyped resultへ変換する。
- `read_file`はstatで上限を確認し、bounded prefixでbinary判定してからtextを読む。
- 明示range readは必要範囲だけをstreamで読み、全fileのsplitを避ける。
- cache/digestを作る場合も最大read sizeを超えない。

#### Acceptance

- Git processがtimeout後に残存しない。
- merge/abort失敗時にrepository状態を成功扱いしない。
- large/binary fileはNode heapを大きく消費する前に拒否またはbounded resultとなる。

## 7. Terra実行チケット台帳

以下は実装時の作業単位である。各ticketは単独でreview可能な差分にし、`write set`外の変更が
必要なら停止して後続ticketを追加する。`A-T4`だけはArea Bのterminal transition command完成後に行う。

### A-T0: P0 security regressionを固定する

- Findings: `C1`, `C2`, `C3`
- Write set: 新規`tests/worker-tools/worker-tool-security-regression.test.ts`、新規
  `tests/worker-fetch-content-security.test.ts`
- Read-only参照: `command-policy.ts`、`run-command.ts`、`run-background-command.ts`、
  `project-secret-paths.ts`、`workspace-process-confinement.ts`、`fetch-content.ts`
- 実装: 一時repository内にmarkerとfixture `.env`を作り、pipe/OR/改行/redirectでmarkerが作られないこと、
  `cat`/`rg`/script/symlinkからfixture secretを読めないこと、private addressとredirect先private addressへ
  requestしないことをtest化する。secret値はassertion failure messageへ含めない。
- Red確認: production codeを変える前に各suiteを個別実行し、少なくともoperator実行、secret read、
  private URL受理の3群が想定理由で失敗することを記録する。
- Stop: OS confinementを実行できないtest環境ではsecret suiteをskipで成功扱いにせず、対象platformと
  未検証理由を記録する。
- Done: A-T1〜A-T3後に同じtestが通り、mock call countだけでなくmarker/file/requestの実害を検証する。

### A-T1: shellを実行境界から除去する

- Findings: `C1`
- Write set: `api/services/worker-tools/command-policy.ts`、
  `api/services/worker-tools/tool-policy-enforcer.ts`、`api/services/worker-tools/run-command.ts`、
  `api/services/worker-tools/run-background-command.ts`、
  `api/services/background-processes/index.ts`、
  `api/services/execution/workspace-process-confinement.ts`、A-T0のcommand test、
  `tests/services.workspace-process-confinement.test.ts`、`tests/worker-tools/services-worker-tools-05.test.ts`、
  `tests/worker-tools/services-worker-tools-06.test.ts`
- 新規symbol: `parseSingleCommand(command): ParsedSingleCommandResult`。成功値は`program`と`args`を持ち、
  execution層は`execFile`/`spawn`相当へこの値だけを渡す。`/bin/bash -c`へraw commandを渡さない。
- 実行主体: `run_background_command`は`background-processes`へ委譲するため、同serviceと
  confinement adapterも`ParsedSingleCommand`を受け取るように変更する。wrapperだけを変更して
  raw commandのshell実行を残さない。
- Parser contract: stateはunquoted/single-quoted/double-quoted/escapedを持つ。空文字、NUL、CR/LF、
  unquotedの`|`, `||`, `&`, `&&`, `;`, `<`, `>`、subshell、command/process substitution、先頭の
  environment assignmentを拒否する。single quote内の文字はliteral、quoteはargvから除去する。
  unclosed quote/escapeは`parse_error`で拒否する。
- Policy contract: executableはparse済み`program`から分類し、raw文字列の先頭tokenを再parseしない。
  `read_only`/`mutating`/`destructive`/`unknown`の既存decision名とapproval意味は維持する。
- Compatibility: glob、redirect、pipelineが必要な処理は専用toolまたは明示argvへ移し、このticketで
  shell fallbackを設けない。既存test corpusで許可済み単一commandのquote/space/empty argumentを固定する。
- Stop: 既存のproduction callerがshell-only構文へ依存していた場合、そのcallerと代替toolを列挙し、
  A-T1を拡張せず別ticketへ切り出す。
- Done: 拒否caseでは`execFile`/`spawn`が0回、許可caseではparse結果と実行argvが一致し、foregroundと
  backgroundで同じparser/decisionを使う。

### A-T2: Project secret denyをOS subprocess境界へ追加する

- Findings: `C2`
- Depends on: `A-T1`
- Write set: `api/services/security/project-secret-paths.ts`、
  `api/services/execution/workspace-process-confinement.ts`、`api/services/worker-tools/run-command.ts`、
  `api/services/worker-tools/run-background-command.ts`、`api/services/background-processes/index.ts`、
  `tests/services.project-secret-paths.test.ts`、A-T0のsecret test
- 新規symbol: `listExistingProjectSecretPaths(repositoryRoot)`。tracked fileだけでなくworkspace内に実在する
  catalog一致fileを列挙し、`realpath`がroot外へ出るsymlinkはsecret候補としてdenyする。内容は読まない。
- macOS contract: 生成するsandbox profileに各canonical secret pathのread denyを追加し、workspace全体の
  allow ruleよりdenyが優先されることを実processで証明する。
- Linux contract: `bwrap`起動時にsecret fileを空のread-only bindでmaskするか、同等にkernelでreadを
  拒否する。既存fileをmaskできなければconfinement preflightをtyped failureにし、非confinementへ
  fallbackしない。
- Caller contract: `api/modules/codingAgent/mcp/nightworkers-codex-mcp.ts`と
  `native-api-tool-dispatcher.ts`の`confinementRequired: true`を維持する。argv path検査は早期error用であり、
  script/child processを防ぐsecurity boundaryの代替にしない。
- Stop: 対象OSでsecret denyをkernel境界に構成できない場合は、そのlaneをequivalentと報告しない。
  secret filenameや内容をerror payload/logへ出さず、採用可能なcontainment方式の再設計へ戻す。
- Done: direct path、absolute path、symlink、`rg`、interpreter script、background childの全caseが拒否され、
  `.env.example`と通常fileは従来どおり読める。

### A-T3: DNS pinning付きsafe outbound HTTPへ置換する

- Findings: `C3`
- Write set: 新規`api/services/security/safe-outbound-fetch.ts`、
  `api/services/worker-tools/fetch-content.ts`、A-T0のfetch test、
  `tests/worker-fetch-content-extra-coverage.test.ts`
- 新規contract: `safeOutboundFetch({url, signal, timeoutMs, maxRedirects, maxResponseBytes})`。URL credentials、
  非HTTP(S)、localhost/`.localhost`、loopback/private/link-local/unspecified/multicast/metadataのIPv4/IPv6を
  接続前に拒否する。
- Resolution: `dns.promises.lookup(hostname, {all: true, verbatim: true})`相当で全A/AAAAを取得し、1件でも
  non-publicならfail-closeする。Node `http`/`https` requestの`lookup`へ検証済みaddressを固定し、Hostと
  TLS SNIは元hostnameを維持する。DNS事前確認後にnative `fetch`で再解決する実装は禁止する。
- Redirect: auto-followを使わず最大5 hop、相対`Location`を現在URLから解決し、各hopでURL検証、DNS、
  pinningをやり直す。Location欠落、不正URL、loop、上限超過はtyped failureにする。
- Resource: connect+response timeoutをAbortSignalへ結合し、Content-Lengthとdecoded stream byte countの
  両方で上限を強制する。gzip/deflate/brも展開後のbyte数を上限に含める。
- Reader mirror: JinaへのHTTP error/low-signal自動fallbackを削除し、既定経路から第三者requestを0にする。
  将来のopt-in設定は別ticketとし、このticketで未公開flagを追加しない。
- Tests: literal private、mixed DNS、redirect-to-private、DNS rebindingを模したlookup、redirect 6 hop、
  oversized compressed body、abortをresolver/transport境界で検証する。
- Stop: 接続先addressをpinできないtransportしか利用できない場合、DNS precheckだけで完了扱いにしない。
- Done: `fetch_content`のpublic result shapeと`finalUrl`を維持しつつ、検証済み最終URL以外へ接続しない。

### A-T4: terminal Runからbackground processを回収する

- Findings: `M4`
- Depends on: `B-T3`
- Write set: `api/services/background-processes/index.ts`、
  `api/modules/nightworkers/nightworkers.background-process.service.ts`、Area Bが確定したterminal hook adapter、
  `tests/background-processes.test.ts`、`tests/services.background-processes-unit.test.ts`、新規
  `tests/background-process-run-lifecycle.test.ts`
- 新規symbol: `stopBackgroundProcessesForRun(runId, reason)`。runId一致かつrunningのmanaged process groupだけを
  対象にし、SIGTERM、既存猶予時間、必要時SIGKILL、terminal row更新をidempotentに行う。
- Hook contract: `B-T3`のRun/Task/Queue transactionがcommitした後、CAS winnerだけがcleanupを呼ぶ。
  CAS loser/stale callerはcleanupを起動せず最新terminal snapshotを返す。
- Failure contract: cleanup失敗でRun terminal statusを戻さない。失敗process IDと再試行可能状態を既存の
  process record/evidenceへ残すが、OS再起動後の未確認PIDをkillしない。
- Done: completed/cancelled/failed/timed_out、複数process、二重呼出、kill失敗、Run非所有processのcaseが通る。

### A-T5: Git merge serviceを既存bounded runnerへ移す

- Findings: `M12`
- Write set: `api/modules/gitworktree/gitworktree-cli.ts`、
  `api/modules/nightworkers/nightworkers.git-merge.service.ts`、
  `tests/gitworktree/gitworktree-cli.test.ts`、`tests/nightworkers-git-merge-extra-coverage.test.ts`
- Contract: merge serviceへ`GitCommandRunner`を注入し、query系15秒、merge/merge-tree/abort系60秒、output
  8 MiB、`GIT_TERMINAL_PROMPT=0`と非対話環境を明示する。service内の`execFile`直呼出を0件にする。
- Error mapping: timeout、signal、output overflowを既存`AppError`/merge resultのmachine codeへ一度だけ写像し、
  stderr本文とrepository stateを成功へ正規化しない。
- Stop: 既存testの`child_process` module mockがrunner注入と競合したら、同じticketでfake runnerへ移す。
- Done: success、conflict、abort失敗、timeout、overflowでprocess残存と成功誤判定がない。

### A-T6: `read_file`を4 MiB/regular textに限定する

- Findings: `m5`
- Write set: `api/services/worker-tools/read-file.ts`、
  `tests/worker-tools/services-worker-tools-04.test.ts`、新規
  `tests/worker-tools/read-file-resource-boundary.test.ts`
- Contract: `MAX_READ_FILE_BYTES = 4 * 1024 * 1024`をexportせずmodule定数とする。`lstat`/`realpath`/`stat`後、
  regular fileかつ上限以下だけを読む。先頭8 KiBのNUL検査でbinaryを拒否し、size超過は`FILE_TOO_LARGE`、
  binaryは`UNSUPPORTED_FILE_TYPE`のtyped errorにする。
- Range: public paging/digest/`totalLines` contractを変えないため、4 MiB以下は現行どおり全体を読み、
  4 MiB超はrange指定があっても拒否する。超過fileを全readしてから切り詰めない。
- Cache: 拒否fileはcontent cache/digestへ保存せず、path/sizeだけを診断に含める。
- Done: sparse large file、FIFO/device、binary、symlink外部、上限ちょうど、既存paging/digestのcaseが通る。

## 8. Verification

```bash
node scripts/run-vitest.mjs run \
  tests/worker-tools/services-worker-tools-04.test.ts \
  tests/worker-tools/services-worker-tools-05.test.ts \
  tests/worker-fetch-content-extra-coverage.test.ts \
  tests/background-processes.test.ts \
  tests/services.background-processes-unit.test.ts \
  tests/nightworkers-git-merge-extra-coverage.test.ts
bun run typecheck
bun run check:architecture
bun run lint
```

OS confinementのtestはmacOS/Linuxの両方で実行し、Windowsは対応するprocess containmentの
integration testを実runnerで行う。platform未検証を共通passへ読み替えない。

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| shell構文拒否で既存verification commandが動かない | 既存command corpusをtest化し、必要な構造は専用toolまたはargv contractで表現する |
| DNS validationと実接続のTOCTOU | 検査済みaddressへ接続を固定する |
| Secret denyがbuild toolを壊す | secret catalog単位のfixture testを作り、秘密でないsample fileを区別する |
| terminal cleanupで意図的なrepository serviceを停止する | `runId`が一致するprocessだけを対象にする |
| Git timeoutが大規模repositoryで短すぎる | operation別の上限を設定し、無制限値は許可しない |

## 10. Completion criteria

1. `C1`、`C2`、`C3`の全再現caseが拒否される。
2. command parse不能時にshell processが起動しない。
3. Project secretをagent subprocessから取得できない。
4. private addressとredirect先private addressへ接続できない。
5. Jina fallbackが既定無効で、明示使用時は監査可能である。
6. Run終端後にrun-owned background processが残らない。
7. Git subprocessとfile readのresource上限testが成功する。
8. Area Bとの統合testを含む限定test、typecheck、architecture、lintが成功する。
