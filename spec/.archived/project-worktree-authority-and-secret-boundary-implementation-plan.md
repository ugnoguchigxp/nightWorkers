# Project Worktree Authority and Secret Boundary Implementation Plan

## Status

- Plan status: `implemented`
- Document created: 2026-07-29
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Baseline branch: `main`
- Baseline HEAD: `00e33d6d9768f10d14358fded45bd9a55999f7d6`
- Baseline worktree: dirty
- Primary scope:
  - 登録済みProject rootとGit repository identity
  - base worktreeとTask専用worktree
  - branch、base SHA、expected HEAD、merge target
  - dirty state、ahead／behind、conflict
  - Coding Agentのworkspace authority
  - 別repository／temporary directoryの成果物排除
  - `.env`、provider credential、child process environment
  - event／artifact／SQLiteへのsecret非永続化
- Explicitly out of scope:
  - product authentication
  - login、session、user identity、authorization middleware
  - OAuth、cookie、token endpoint
  - 認証を前提にしたProject permission model
- Related documents:
  - `spec/trust-model.md`
  - `spec/architecture.md`
  - `spec/docs/minimal-implementation-todo-and-polyglot-worktree-bootstrap-plan.md`
  - `spec/docs/coding-agent-runtime-reliability-recovery-plan.md`

現在のworktreeにはproduct authentication削除を含む未コミット変更が存在する。本計画の
実装ではそれらを前提変更として扱い、復元、上書き、取り込み、再設計を行わない。
migration番号、schema bootstrap変更、settings変更が競合する場合は、認証削除側の変更が
確定した後の最新状態を基準に割り当て直す。

### Implementation result

- Project Git identity、Task workspace binding、Run admission attestationをversion付きで永続化した。
- 未割当workspaceとCoding Agentによるrepository bootstrap Runの例外経路を廃止した。
- side-effect commandをRun binding再検証とOS workspace confinementの内側へ移した。
- workspace artifactをworkspace ID、allocation、HEAD、digestへbindingし、nested repository、
  temporary path、secret pathを拒否した。
- `.env`等のProject secret pathをread／search／artifactから除外し、tracked secret fileは明示確認を
  要求するようにした。base worktreeからTask worktreeへのcopyは行わない。
- child process envを共通builderへ集約し、NightWorkers provider credentialの継承とworkerからの
  OS secret store参照を禁止した。
- application setting secretをOS secret storeへ移し、event／artifact／SQLite repository境界へ
  persistence firewallを追加した。
- startup reconciliation、expected／observed比較、dirty／conflict path、source対target、
  target対upstreamの観測証跡を追加した。

## 1. 目的

NightWorkersがCoding Agentへ渡す実作業workspaceを、登録済みProjectとTask専用Git
worktreeへ構造的に固定する。LLM本文、Task本文、tool引数、保存済みの生pathをauthorityに
せず、server側で保存したversion付きbindingと実行直前のGit観測結果だけを正本とする。

変更後は次を満たす。

1. 登録済みProject rootがcanonical Git top-levelとして一意に識別される。
2. base worktree、Task専用worktree、Git common dirの関係が保存・再検証できる。
3. Task branch、base SHA、expected HEAD、merge targetが混同されない。
4. dirty、ahead／behind、conflictは比較基準と観測時刻を伴う事実として扱われる。
5. 新規Coding Agent RunはTask専用worktreeなしでは開始できない。
6. resumeも同じworkspace bindingとRun lineageに対してだけ行われる。
7. Coding Agentが指定したpathやrepo rootでauthorityを差し替えられない。
8. 別repositoryやtemporary directoryのfileを成果物、差分、検証成功の正本にできない。
9. Projectの`.env`をNightWorkersがbase worktreeからTask worktreeへコピーしない。
10. NightWorkers固有provider credentialを一般child processへ継承しない。
11. secretのraw valueをevent、artifact、SQLite、temporary output fileへ保存しない。
12. workspace mismatch時はfail-closeし、Todoを暗黙更新せず、再取得可能な診断を返す。

## 2. 非目的

本計画では次を行わない。

- 認証を追加しない。
- local userを識別するためのuser tableやsessionを追加しない。
- Project accessをユーザーroleで制御しない。
- Coding Agentへ意味別mode、固定workflow、tool allowlistを追加しない。
- Task文言、Todo名、command、error messageをkeyword分類してworkspaceを選ばない。
- Mission Pilotへrepository filesystem操作の所有権を移さない。
- Coding Agentへmerge target選択やProject登録変更の所有権を移さない。
- base worktreeの未追跡`.env`を自動でTask worktreeへ複製しない。
- prompt instructionだけでworkspaceやsecretの安全性を保証したことにしない。
- temporary directoryを実装、検証、成果物の正本にしない。
- raw command outputを「ローカルだから安全」とみなして永続化しない。

## 3. 現行実装で維持する基盤

### 3.1 Task Git workspace lifecycle

`task_git_workspaces`はすでに次を保持する。

- `repository_id`
- `source_branch`
- `target_branch`
- `target_base_sha`
- `worktree_path`
- `worktree_id`
- `allocation_version`
- `expected_head_sha`
- provisioning／initialization lease

`api/modules/gitworktree/task-git-workspace.service.ts`はtarget branchからbase SHAを解決し、
新しいsource branchとworktreeを作成した後、作成結果のbranch、HEAD、canonical pathを
検証して保存する。このprovisioning、initialization、repository mutation lockは維持する。

### 3.2 Run admissionのbranch／HEAD確認

`api/modules/nightworkers/run-orchestration/start-task-run-preparation.ts`は、割当済みworkspaceの
path、status、bootstrap evidence、branch、HEADをprovider起動前に確認する。このgateは
新しいworkspace attestation serviceへ統合し、個別実装を増やさない。

### 3.3 Git closeoutとmerge CAS

現在のcloseoutはbaseline HEAD、dirty path、staged path、owned pathを確認し、mergeは
record version、source commit、observed target SHA、target dirty stateを再検証する。
明示commit／merge操作、repository Git mutation lock、merge preview CASは維持する。

### 3.4 Workspace dependency bootstrap

Task worktree作成後のdependency bootstrap、Task専用HOME／TMP／cache、secret redaction utility、
初期化完了前のRun停止は維持する。本計画はbootstrapをCoding Agentの任意commandへ戻さない。

## 4. 現行の不足

### 4.1 Project rootのidentityがpath文字列に留まる

`repositories.local_path`はcanonical Git top-level、Git common dir、base worktreeを保存しない。
subdirectory、symlink経由path、secondary worktree、同じGit repositoryの重複登録を永続的に
区別できない。

Project登録時のGit probeはbranch検証を行うが、非Git directoryもrepository
materialization用として登録可能であり、既存Git Projectと未materialize Projectの状態が
同じrecordへ混在する。

### 4.2 TaskとRunのpath projectionがauthorityとして利用される

`tasks.worktree_path`と`task_runs.worktree_path`はworkspace IDやallocation revisionを持たない。
Run recordも`base_ref`とpathだけであり、どの`task_git_workspaces` revisionを採用したかを
一意に再現できない。

### 4.3 legacy Runとunassigned workspaceのfallback

`start-task-run-entry.ts`は過去Runが存在するTaskを新しいworktreeへ移さず、登録Project rootで
継続できる。`allowUnassignedWorkspace`もProject bootstrapからRun開始まで同じ入口を通る。
これにより「新規RunはTask専用worktreeだけ」という不変条件が成立しない。

### 4.4 path policyがprocess filesystem境界ではない

worker toolのpath policyはtool引数とcwdをcanonicalizeするが、shell command内部の絶対path、
redirection、processが辿るsymlink、別repository、一般temporary directoryをOSレベルで
閉じない。keywordや正規表現を増やしても完全なfilesystem confinementにはならない。

`externalAllowedPaths`はread sourceとwrite destinationを区別しないため、設定によっては
別repositoryをwrite先または実行cwdとして扱える。

### 4.5 command outputがtemporary file、event、artifact、SQLiteへ到達する

`run-command.ts`は大きいstdout／stderrを`os.tmpdir()`配下へraw JSONとして保存する。
background processはraw outputを`background_processes.latest_output`、activity artifact、
activity event payloadへ保存する。Native tool eventもtool argumentsとresult payloadを
ledgerへ送る。

### 4.6 child process environmentが統一されていない

- `run_command`はenvironment未指定時にNodeの既定動作で親envを継承する。
- background commandもenvironment未指定時に親envを継承する。
- worker process managerは`process.env`全体をcopyする。
- worker settings snapshotはsecret scopeを含むJSONを環境変数へ入れる。
- command Hookは`process.env`全体をcopyする。
- workspace bootstrap version probeは`process.env`全体を渡す。
- Git CLI、MCP stdio、provider subprocessはそれぞれ別のenv規則を持つ。

### 4.7 secretがSQLiteに保存される

provider credentials等は`application_setting_secrets`にJSONとして保存される。
API response maskingは表示上の保護であり、SQLite、WAL、backupへのraw secret保存を防がない。

## 5. Target Invariants

### 5.1 Project identity

既存Git Projectが`ready`になるには次をすべて満たす。

1. `registeredRootCanonical`が存在するdirectoryである。
2. `git rev-parse --show-toplevel`のcanonical pathと完全一致する。
3. `git rev-parse --path-format=absolute --git-common-dir`を取得できる。
4. `git worktree list --porcelain -z`に登録rootが存在する。
5. 登録rootのworktree IDをGit common dirとcanonical pathから決定できる。
6. target ref `refs/heads/<branch>`がcommitへ解決できる。
7. 同じcanonical Git common dirを持つ別のactive Projectが存在しない。
8. identityはrevisionとdigestを持つ。

非Git Projectは`materialization_pending`として登録できるが、Coding Agent Runを開始できない。
repository materialization完了後に同じProject recordへGit identityを確定し、`ready`へ遷移する。

### 5.2 base worktree

- base worktreeはProject登録rootと同一のworktreeとして保存する。
- base worktree ID、canonical path、branch、HEAD、dirty stateを観測する。
- base worktreeのdirty stateはTask worktreeへコピーしない。
- base worktreeがdirtyでもTask provisioning自体は可能だが、base worktreeを直接Task実行rootに
  しない。
- merge target branchをcheckoutしているworktreeがbase worktreeと異なる場合は、その
  target worktreeを別の観測対象として扱い、base worktreeと混同しない。
- Project rootを別worktreeへ変更する操作はactive Task workspaceがある間は拒否する。

### 5.3 Task workspace binding

Task workspace bindingは次を保存する。

```ts
type TaskWorkspaceBinding = {
  workspaceId: string;
  allocationVersion: number;
  taskId: string;
  repositoryId: string;
  repositoryIdentityRevision: number;
  repositoryIdentityDigest: string;
  baseWorktreeId: string;
  baseWorktreePathCanonical: string;
  taskWorktreeId: string;
  taskWorktreePathCanonical: string;
  gitCommonDirDigest: string;
  sourceRef: `refs/heads/${string}`;
  sourceBranch: string;
  targetRef: `refs/heads/${string}`;
  targetBranch: string;
  targetBaseSha: string;
  expectedHeadSha: string;
  integrationPolicyRevision: number;
};
```

- `targetBaseSha`はallocation時の不変値とする。
- `expectedHeadSha`はhostが確認したcommit成功時だけCAS更新する。
- 実行中のfile editはHEADを変えないため、expected HEADを暗黙更新しない。
- `tasks.worktreePath`はUI互換projectionとし、bindingのauthorityにしない。
- source／targetはshort branch nameだけでなくfull refを保存する。
- binding確定後にrepository identity revisionが変わった場合は`attention`へ遷移する。

### 5.4 Run workspace binding

`task_runs`へ次を追加する。

```ts
type RunWorkspaceBinding = {
  workspaceId: string;
  workspaceAllocationVersion: number;
  repositoryIdentityRevision: number;
  admissionAttestationId: string;
  admissionAttestationDigest: string;
  admittedHeadSha: string;
};
```

- 新規Run作成とbinding保存は同一transactionで行う。
- runtime contextへ生の任意pathをauthorityとして保存しない。
- resumeは元Runと同じworkspace ID、allocation version、repository identity revisionを要求する。
- 元workspaceをretire、remove、rebindした後はresumeを拒否する。
- `repoRoot`はRun bindingからserver側で解決し、provider tool argumentから受け取らない。

### 5.5 Workspace attestation

重要操作の直前に共通の`WorkspaceAttestationService`を呼ぶ。

対象操作:

- Queue release
- 新規Run admission
- resume admission
- side effectを伴うworker tool
- background command start
- completion snapshot
- commit closeout
- merge preview
- merge execute
- target push
- startup recovery

attestationは次を観測する。

```ts
type WorkspaceObservation = {
  repositoryIdentityDigest: string;
  registeredRootCanonical: string;
  gitCommonDirCanonical: string;
  worktreeId: string;
  worktreePathCanonical: string;
  sourceRef: string | null;
  observedHeadSha: string | null;
  expectedHeadSha: string;
  targetRef: string;
  targetObservedSha: string | null;
  status: {
    stagedPaths: string[];
    modifiedPaths: string[];
    untrackedPaths: string[];
    conflictPaths: string[];
  };
  comparisons: {
    sourceVsTarget: {
      sourceSha: string;
      targetSha: string;
      ahead: number;
      behind: number;
    };
    targetVsUpstream: {
      targetSha: string;
      upstreamRef: string | null;
      upstreamSha: string | null;
      ahead: number | null;
      behind: number | null;
      fetchedAt: string | null;
      freshness: "local_only" | "fetched" | "upstream_missing";
    };
  };
  observedAt: string;
};
```

`ahead`／`behind`は必ず比較した2 SHAとrefを伴う。remote fetchは明示policyまたはユーザー操作で
実行し、単なるlocal tracking ref比較をremote最新状態と表示しない。

attestationの成功条件はpurposeごとに構造化するが、Taskやerror本文からpurposeを推定しない。
呼び出し側が`run_admission`、`side_effect`、`closeout`、`merge`等のoperationを明示する。

### 5.6 dirty stateとconflict

- 新規Task workspaceの初回Runはcleanかつconflictなしを必須にする。
- resumeは同じRun lineageが保存したowned dirty snapshotとの一致を要求する。
- pre-existing dirty pathを新しいRunの成果物へ暗黙採用しない。
- conflictが1件でもあるworkspaceでは新しいside effectを開始しない。
- conflict解消は人間または明示されたrework Runで扱い、hostがTodoを更新しない。
- dirty pathはrepo-relative pathだけを保存し、file内容はattestationへ保存しない。
- `.env`等secret pathはdirty path listで存在を示しても、diffや内容を保存しない。

### 5.7 mismatch時の扱い

最低限、次のtyped failureを持つ。

```text
PROJECT_ROOT_MISSING
PROJECT_ROOT_NOT_GIT_TOPLEVEL
PROJECT_REPOSITORY_IDENTITY_CHANGED
PROJECT_GIT_COMMON_DIR_CONFLICT
BASE_WORKTREE_CHANGED
TASK_WORKSPACE_REQUIRED
TASK_WORKSPACE_MISSING
TASK_WORKSPACE_PATH_CHANGED
TASK_WORKSPACE_COMMON_DIR_MISMATCH
TASK_WORKSPACE_BRANCH_MISMATCH
TASK_WORKSPACE_DETACHED
TASK_WORKSPACE_HEAD_MISMATCH
TASK_WORKSPACE_DIRTY_AT_ADMISSION
TASK_WORKSPACE_DIRTY_OWNERSHIP_MISMATCH
TASK_WORKSPACE_CONFLICTED
TASK_WORKSPACE_BINDING_STALE
RUN_WORKSPACE_BINDING_MISSING
RUN_WORKSPACE_BINDING_MISMATCH
MERGE_TARGET_REF_MISSING
MERGE_TARGET_CHANGED
MERGE_TARGET_DIRTY
MERGE_TARGET_CONFLICTED
MERGE_PREVIEW_STALE
WORKSPACE_SANDBOX_UNAVAILABLE
WORKSPACE_PATH_ESCAPE_BLOCKED
EXTERNAL_RESULT_PROVENANCE_REJECTED
TEMPORARY_RESULT_PROVENANCE_REJECTED
```

failureにはexpected／observedの安全なmetadata、再取得先、workspace ID、revisionを含める。
secret value、raw `.env`、raw command outputは含めない。

## 6. 成果物とtool authority

### 6.1 repoRootをprovider入力から外す

`executeWorkerTool`のpublic application boundaryは次へ変更する。

```ts
type ExecuteRunWorkerToolCommand = {
  runId: string;
  taskId: string;
  toolName: WorkerToolName;
  args: Record<string, unknown>;
  expectedWorkspaceAllocationVersion: number;
  idempotencyKey?: string;
};
```

application serviceがRun、Task、workspace bindingを読み、attestation後にinternal toolへ
canonical repo rootを渡す。Native runtime、Codex MCP、verification、background processの
すべてが同じ入口を使う。

tool argumentに`repositoryId`、`runId`、absolute repo rootが含まれても、request-scoped
authorityを上書きしない。差がある場合は実行せずtyped mismatchを返す。

### 6.2 read sourceとwrite destinationを分離する

現行の`externalAllowedPaths`を次へ分割する。

```ts
type WorkspacePathCapabilities = {
  readRoots: Array<{
    id: string;
    canonicalPath: string;
    sourceKind: "registered_template" | "declared_dependency" | "user_grant";
  }>;
  writeRoot: {
    workspaceId: string;
    canonicalPath: string;
  };
  transientRoot: {
    runId: string;
    canonicalPath: string;
  };
};
```

- writeはTask worktreeだけに許可する。
- transient rootはcommand内部の一時fileだけに許可し、成果物登録を禁止する。
- readRootsからTask worktreeへのcopyは、copy後のTask worktree deltaだけを成果物にする。
- 別repositoryのHEAD、diff、test resultをTask成功証拠にしない。
- nested Git repositoryは明示登録済みsubmodule以外rejectする。
- submoduleを扱う場合も成果物は親repositoryのgitlink変更と宣言済みsubmodule bindingに限定する。

### 6.3 OS-level workspace process sandbox

shell commandをkeyword分類だけで閉じず、`WorkspaceProcessSandboxPort`を追加する。

sandbox contract:

- Task worktree: read/write
- Run専用transient root: read/write、終了時削除
- Git common dir:必要最小限のread-only。Git statusでは`GIT_OPTIONAL_LOCKS=0`を使用する。
- base worktree: mount／grantしない
- 他の登録Project: mount／grantしない
- NightWorkers runtime dir: mount／grantしない
- OS home: Task専用HOMEへ置換
- network:既存Project safety policyに従うが、filesystem authorityとは分離する

platform adapter:

- macOS:利用可能なprocess sandbox backendを検出し、profileでpathを固定する
- Linux:`bubblewrap`等のmount namespace backend
- Windows:restricted token／Job Object／ACLを組み合わせたbackend

backendがauthorityを保証できないplatformでは、side effect commandをfail-closeする。
prompt warningやcommand blocklistへfallbackして成功扱いしない。

### 6.4 Artifact reference

workspace file artifactは次の正本型だけを受け付ける。

```ts
type WorkspaceArtifactRef = {
  workspaceId: string;
  allocationVersion: number;
  relativePath: string;
  contentDigest: string;
  observedHeadSha: string;
  source: "workspace_file" | "workspace_diff" | "verification_projection";
};
```

artifact repositoryは次を拒否する。

- absolute path
- `..`を含むpath
- canonicalized targetがTask worktree外
- temporary root内
- 別repository root内
- workspace ID／allocation revision不一致
- current attestationと異なるGit common dir
- secret path

command outputはworkspace file artifactへ変換しない。

## 7. Secret Boundary

### 7.1 Secret分類

```ts
type SecretClass =
  | "nightworkers_provider_credential"
  | "project_environment_secret"
  | "integration_credential"
  | "registry_credential"
  | "request_scoped_capability";
```

- NightWorkers provider credential: parent provider boundaryだけが利用する。
- Project environment secret: Task worktree内commandだけが利用する。
- integration／registry credential:明示されたintegration／bootstrap boundaryだけが利用する。
- request-scoped capability:短寿命、Run／operation／expiryを持ち、raw provider keyではない。

### 7.2 `.env`の正本

- Project `.env`の正本はProject Tree内のuser-managed fileだけとする。
- `git worktree add`で生成されないuntracked／ignored `.env`をNightWorkersがcopyしない。
- base worktreeの`.env`をTask worktreeへcopy、symlink、hardlinkしない。
- Task worktreeで必要ならユーザーがTask worktreeへ用意する。
- NightWorkersは`.env`をTask metadata、event、artifact、SQLiteへ取り込まない。
- read_file、search、structure inspection、Project exploration、diff projectionからsecret pathを除外する。
- `.env.example`はsecret pathに含めない。ただしsecret-like valueはpersistence firewallを通す。
- tracked `.env`が存在するProjectはProject登録時にattentionを表示し、内容を読み込まず、明示確認前に
  Coding Agent Runを開始しない。

secret path contractは共通定数として一元化する。

```ts
const PROJECT_SECRET_FILE_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  ".npmrc",
  ".pypirc",
  "credentials.json",
];
```

patternはfile boundary用であり、Task本文やerror messageの意味分類には使用しない。

### 7.3 Child process environment

すべての`spawn`、`exec`、`execFile`、Codex SDK、Hook、MCP stdio、bootstrap、Git CLIが共通の
`ChildProcessEnvironmentBuilder`を使用する。

```ts
type ChildProcessPurpose =
  | "git"
  | "workspace_bootstrap"
  | "workspace_command"
  | "background_command"
  | "hook"
  | "mcp_stdio"
  | "task_worker"
  | "provider_runtime";
```

purposeはprocessの構造的責務を表し、Coding Agentの意味別modeではない。

共通規則:

1. `process.env`をspreadしない。
2. PATH、platform runtime、locale、certificate path等の共通allowlistから構築する。
3. workspace HOME／TMP／cacheを明示追加する。
4. secret-like keyはdefault denyとする。
5. provider credentialはworkspace command、background、Hook、MCP、Git、bootstrapへ渡さない。
6. Project `.env`値をNightWorkers process envへloadしない。
7. child env key名だけをdiagnosticへ保存できるが、値は保存しない。
8. testではchildが`env`を出力し、禁止keyが存在しないことを確認する。

### 7.4 Provider credential broker

isolated task workerへprovider secretをsettings snapshotやambient envとして渡さない。

- worker settings snapshotはpublic settingsだけにする。
- provider callはparent processが所有する`ProviderCredentialBrokerPort`を介す。
- childはRun、provider endpoint、model、expiryへ限定したrequest-scoped capabilityを受け取る。
- capabilityはmemory上で発行し、event／artifact／SQLiteへ保存しない。
- capabilityは別Run、別provider、一般HTTP requestへ再利用できない。
- worker crash、Run終了、timeoutで失効する。

Codex SDK／CLIがraw credentialをchild processへ要求する場合は、次の順で対応する。

1. parent側loopback provider brokerを利用し、childへraw provider keyを渡さない。
2. provider runtimeをparent-owned boundaryへ移し、tool requestだけをrequest-scoped IPCでworkerへ渡す。
3. どちらも実装できないruntime laneはstrict secret boundary対応済みとして有効化しない。

raw provider keyを環境変数へ戻すcompatibility fallbackは追加しない。

### 7.5 Secret store

provider／integration credentialの永続化先をOS secret storeへ移す。

```ts
interface SecretStorePort {
  put(input: { scope: string; name: string; value: string }): Promise<SecretRef>;
  resolve(ref: SecretRef): Promise<string>;
  delete(ref: SecretRef): Promise<void>;
}

type SecretRef = {
  provider: "keychain" | "credential_manager" | "libsecret" | "session";
  id: string;
};
```

- macOS Keychain
- Windows Credential Manager
- Linux libsecret
- test用memory store
- secret store未利用環境ではsession-onlyを明示し、SQLite fallbackを行わない

SQLiteにはprovider endpoint、secretRef、設定revision、last validation statusだけを保存する。
secret value、encoded value、hashを保存しない。secret同一性比較が必要な場合もsecret store側の
opaque revisionを使用する。

### 7.6 Persistence firewall

event、artifact、activity、Run summary、final report、error、background process、command
evidenceを保存する全repositoryの手前に`SecretPersistenceFirewall`を置く。

```ts
type PersistenceFirewallResult<T> =
  | { ok: true; value: T; redactionCount: number }
  | { ok: false; code: "SECRET_PERSISTENCE_REJECTED"; paths: string[] };
```

firewallは次を実行する。

1. 構造的secret keyを持つfieldをrejectまたはmaskする。
2. in-memory secret registryのexact valueとURL encoded／base64 variantをredactする。
3. Authorization、cookie、token、registry auth、URL userinfoをredactする。
4. command、args、error、nested JSONを再帰処理する。
5. redaction前のvalueをlogへ出さない。
6. unknown fieldをraw JSONとして迂回保存できないようschema-firstにする。

firewall適用前の直接INSERTをarchitecture checkで禁止する。SQLite repository自身で強制し、
callerがsanitize済みと自己申告するだけのAPIにしない。

### 7.7 Command output

- `/tmp/nightworkers-command-artifacts`へのraw output保存を削除する。
- raw stdout／stderrをfileへspillしない。
- bounded streamとしてmemory内で処理する。
- Project secretへアクセス可能なcommandは、isolated executor内部でsecret valueを認識し、
  redaction後のchunkだけをNightWorkersへ返す。
- event／SQLiteへ保存するのはexit code、signal、duration、byte count、digest、redaction count、
  bounded redacted excerptだけとする。
- modelへ返すtool resultもredacted outputだけとする。
- background commandも同じexecutorとstream redactorを使用する。
- Run終了時にmemory bufferとRun transient rootを破棄する。

任意commandがsecretを変形して出力する経路を一般的な文字列redactionだけで完全には判定できない。
strict guaranteeを要求するProjectでは、secret fileが存在するcommandのunrestricted outputを
modelやpersistenceへ返さず、exit statusと信頼済みverification adapterの構造化結果だけを返す。
この制約をpromptやcommand keywordから推定せず、Project secret file presenceと明示security
policyから構造的に決定する。

## 8. Schema and Migration

### 8.1 `repositories`

追加候補:

```text
repository_kind
repository_identity_status
registered_root_canonical
git_common_dir_canonical
base_worktree_path_canonical
base_worktree_id
repository_identity_digest
repository_identity_revision
repository_identity_verified_at
```

`local_path`はcompatibility projectionとして残す。新しいread pathは
`registered_root_canonical`を優先する。

unique index:

```text
active canonical project root
active canonical Git common dir
```

非Git materialization pending recordはGit common dir unique indexの対象外とする。

### 8.2 `task_git_workspaces`

追加候補:

```text
repository_identity_revision
repository_identity_digest
base_worktree_id
base_worktree_path_canonical
task_worktree_path_canonical
git_common_dir_digest
source_ref
target_ref
attestation_revision
last_attestation_id
last_attestation_digest
```

既存`worktree_path`はcompatibility projectionとして残し、backfill完了後にauthority利用を停止する。

### 8.3 `task_runs`

追加候補:

```text
workspace_id
workspace_allocation_version
repository_identity_revision
admission_attestation_id
admission_attestation_digest
admitted_head_sha
```

新規RunではすべてNOT NULL相当をapplication schemaで要求する。DB NOT NULL化はlegacy migration
完了後のfinal migrationで行う。

### 8.4 `workspace_attestations`

append-only tableを追加する。

```text
id
workspace_id
run_id nullable
operation
repository_identity_revision
workspace_allocation_version
observation_json
observation_digest
result
failure_code nullable
observed_at
```

`observation_json`へfile内容、diff、command output、env value、secret valueを保存しない。
path listはrepo-relativeに限定する。

### 8.5 merge record

追加候補:

```text
source_attestation_id
target_attestation_digest
preview_source_sha
preview_target_sha
```

既存`observed_target_sha`とrecord versionを維持し、preview／execute間のattestation一致を追加する。

### 8.6 secret settings

- public settings tableには`secretRef`だけを保存する。
- `application_setting_secrets`への新規writeを先に停止する。
- OS secret store移行完了後、read fallbackを削除する。
- migrationはlive rowをsecret storeへ移し、public recordへsecretRefを保存する。
- rollback用にraw secretを別table、event、fileへcopyしない。
- SQLite row削除後にWAL checkpointとdatabase再構築を実施する。
- 旧DB、backup、OS snapshotからの物理消去はplatform依存であるため、移行UIで残存可能性と
  credential rotationを案内する。

migration番号は現在進行中の認証削除migration確定後に割り当てる。

## 9. Module Ownership

### 9.1 `gitworktree` module

新規候補:

- `api/modules/gitworktree/project-repository-identity.service.ts`
- `api/modules/gitworktree/project-repository-identity.repository.ts`
- `api/modules/gitworktree/workspace-attestation.service.ts`
- `api/modules/gitworktree/workspace-attestation.repository.ts`
- `api/modules/gitworktree/workspace-authority-errors.ts`
- `api/modules/gitworktree/workspace-observation.ts`
- `api/modules/gitworktree/task-workspace-binding.ts`

責務:

- Project Git identity
- worktree identity
- workspace binding
- Git observation
- attestation
- reconciliation
- repository mutation leaseとの連携

Coding Agent moduleからrepository implementationを直接importしない。application commandまたは
Agent非依存portを介す。

### 9.2 `agentsShare`

両roleで同じ意味を持つ参照contractだけを配置する。

- `WorkspaceBindingRef`
- `WorkspaceAttestationRef`
- `WorkspaceAuthorityFailure`

route、repository、Git CLI、role判定を置かない。

### 9.3 `codingAgent`

変更対象:

- runtime contextへbinding refを追加
- Native tool dispatcherから生repoRoot authorityを除去
- Codex MCP requestをRun bindingへ固定
- tool result persistenceをmetadata-onlyへ変更
- workspace mismatchをLLMへ構造化して返す

Coding Agentはworkspaceを選択、再bind、repairしない。

### 9.4 Agent非依存security／execution

新規候補:

- `api/services/security/secret-store.port.ts`
- `api/services/security/secret-persistence-firewall.ts`
- `api/services/security/project-secret-paths.ts`
- `api/services/execution/child-process-environment.ts`
- `api/services/execution/workspace-process-sandbox.ts`
- `api/services/execution/command-output-redactor.ts`
- `api/services/execution/provider-credential-broker.ts`

Hook、MCP、bootstrap、background process、worker process、provider adapterが再利用する。

## 10. Implementation Phases

### Phase 0: baseline characterization and leak containment

実施:

1. 現行Project登録、worktree allocation、Run admission、resume、closeout、mergeのfixtureを固定する。
2. child process spawn箇所とenv継承をinventory化する。
3. event、artifact、SQLite、temporary fileへのcommand output保存箇所をinventory化する。
4. raw command output temporary artifact作成を停止する。
5. background command outputのraw artifact化を停止する。
6. child env builderの共通contractと禁止key fixtureを追加する。
7. 現行未コミット変更の所有権を記録し、本計画の変更と分離する。

Exit criteria:

- provider key fixtureを設定した状態で一般command、Hook、MCP、bootstrap、Git childへ漏れる経路を
  test名単位で説明できる。
- 新規raw command output fileが作成されない。
- 認証route、middleware、schemaを変更していない。

### Phase 1: shared schema and repository identity

実施:

1. workspace authority shared schemaを追加する。
2. repository identity columnsとmigrationを追加する。
3. Project登録時にcanonical top-level、common dir、base worktree IDを保存する。
4. subdirectory、symlink alias、secondary worktree、common dir重複をtyped failureにする。
5. non-Git Projectを`materialization_pending`として分離する。
6. Project detail APIへexpected／observed identity、revision、verifiedAtを追加する。
7. startup reconciliationのread-only版を追加する。

Exit criteria:

- 同じGit repositoryを異なるpath表記で二重登録できない。
- registered rootとGit top-levelが一致しないProjectはreadyにならない。
- existing Projectのbackfill結果がpreviewでき、まだ旧read pathを維持している。

### Phase 2: Task workspace binding and attestation

実施:

1. `task_git_workspaces`へidentity、full ref、canonical path、attestation fieldを追加する。
2. `WorkspaceAttestationService`とappend-only repositoryを追加する。
3. provisioning後にcommon dir、worktree ID、branch、HEAD、clean、conflictを一括検証する。
4. Queue releaseをattestation成功後だけ許可する。
5. ahead／behindをsource-vs-targetとtarget-vs-upstreamへ分離する。
6. worktree UIへ比較基準SHA、freshness、observedAt、mismatchを表示する。
7. startup reconciliationでmismatch workspaceを`attention`へ遷移する。

Exit criteria:

- branch、HEAD、path、common dirのいずれかを変更するとQueue releaseできない。
- ahead／behind表示に比較対象とfreshnessが必ず存在する。
- conflict workspaceがready／activeへ進まない。

### Phase 3: Run binding and legacy cutover

実施:

1. `task_runs`へworkspace binding fieldを追加する。
2. Run作成transactionでworkspace ID、allocation version、admission attestationを固定する。
3. runtime tool contextをRun bindingから構築する。
4. resumeで元Run bindingの一致を確認する。
5. production `allowUnassignedWorkspace`を削除する。
6. repository materializationをCoding Agent Runとは別のhost application commandへ分離する。
7. 過去RunがあるTaskのbase root fallbackを削除する。
8. legacy Taskを`workspace_migration_required`として表示する。
9. userがlegacy dirty stateを新workspaceへ移す場合は、明示preview、patch、commit selectionを伴う
   migration commandを別計画または同Phase内で実装する。

Exit criteria:

- workspace IDなしの新規Runを作成できない。
- legacy Taskがbase Project rootで自動実行されない。
- resume先workspaceをTask path更新やprovider引数で差し替えられない。

### Phase 4: Tool authority and process confinement

実施:

1. worker tool application boundaryをRun-scoped commandへ変更する。
2. Native、Codex MCP、verification、background processを同じauthority resolverへ接続する。
3. readRoots、writeRoot、transientRoot capabilityへ分離する。
4. mutating toolで`externalAllowedPaths`を廃止する。
5. side effect直前attestationとallocation revision CASを追加する。
6. `WorkspaceProcessSandboxPort`とplatform adapterを追加する。
7. command終了時にTask worktree外のmutationがないことをsandbox auditで確認する。
8. sandbox unavailable時のfail-closeを追加する。
9. nested repository／undeclared submoduleの成果物採用を拒否する。

Exit criteria:

- shell commandから絶対path、symlink、redirectionを使っても別repositoryへwriteできない。
- Run transient rootへ生成したfileをartifactまたはcompletion evidenceにできない。
- command keywordを追加しなくてもfilesystem escape testが失敗する。

### Phase 5: Artifact provenance and Git closeout

実施:

1. workspace artifact ref schemaを追加する。
2. artifact repositoryへworkspace provenance validationを追加する。
3. diff、test evidence、final reportのworkspace bindingを保存する。
4. completion snapshot前にattestationし、Task worktree deltaだけをowned candidateにする。
5. commit closeoutへworkspace ID／allocation version／attestation一致を追加する。
6. expected HEADをcommit成功後にCAS更新する。
7. merge previewへsource／target attestationを保存する。
8. merge execute前にpreview SHA、target dirty、conflict、record versionを再検証する。
9. target drift時は新previewを要求し、base SHAを暗黙変更しない。

Exit criteria:

- 別repositoryのdiff／test成功をTask completion evidenceへ登録できない。
- temporary pathのartifact作成をrepositoryが拒否する。
- commit後のexpected HEADとobserved HEADが一致する。
- merge target進行後に古いpreviewでmergeできない。

### Phase 6: Secret store and child environment

実施:

1. `ChildProcessEnvironmentBuilder`を全spawn箇所へ適用する。
2. worker settings snapshotからsecret scopeを削除する。
3. provider credential brokerを追加する。
4. OS secret store adapterとmemory test adapterを追加する。
5. settings APIをsecretRef write／masked readへ切り替える。
6. `application_setting_secrets`への新規writeを停止する。
7. existing secret migration previewと実行を追加する。
8. migrated credentialのprovider smoke test後にSQLite fallbackを削除する。
9. credential rotation guidanceを表示する。

Exit criteria:

- provider keyが一般childのenvironmentに存在しない。
- worker process environmentとsettings snapshotにraw secretが存在しない。
- 新規provider secretがSQLite、WAL、event、artifactへ書かれない。
- secret store unavailable時にSQLiteへfallbackしない。

### Phase 7: Persistence firewall and command output

実施:

1. persistence firewallを共通security serviceへ追加する。
2. task event、activity event、artifact、Run、background process、review evidenceへ適用する。
3. Native tool started／finished eventからraw arguments／resultを除去し、safe metadataへ置換する。
4. command outputをbounded streaming redactorへ移行する。
5. background commandを同じexecutorへ移行する。
6. raw output artifact path、legacy full-output reader、retention処理を削除する。
7. secret pathをread、search、diff、explorationから除外する。
8. chunk境界、URL encoding、base64、nested JSONのredaction testを追加する。

Exit criteria:

- fixture secretをSQLite database file、WAL、artifact dir、runtime log、temporary dirから検索して
  0件である。
- command outputはdigestとredacted excerptだけがpersistされる。
- `.env`内容をfile toolまたはProject explorationで取得できない。

### Phase 8: rollout, canary, legacy removal

実施:

1. 既存Project identity backfillをpreview-onlyで実行する。
2. mismatch Projectを自動修復せずattentionへ分類する。
3. internal Projectで新規Task／resume／commit／merge canaryを行う。
4. secretなしProjectとTask `.env`ありProjectの両方でcanaryする。
5. Run binding coverage、attestation failure、sandbox unavailable、redaction countを計測する。
6. legacy path authority、unassigned Run、raw output artifact、SQLite secret read fallbackを削除する。
7. trust model、configuration、architecture、operator UIを更新する。
8. full verification後に新規Runのfail-closeをdefaultにする。

Exit criteria:

- 新規Runの100%がworkspace ID、allocation version、admission attestationを持つ。
- active Runの100%がTask専用worktreeを使用する。
- Project rootで実行された新規Coding Agent Runが0件である。
- raw secret persistence検査が0件である。
- 認証機能を追加していない。

## 11. Test Plan

### 11.1 Repository identity

| Test | Expected |
| --- | --- |
| Project rootそのものを登録 | ready |
| Project subdirectoryを登録 | `PROJECT_ROOT_NOT_GIT_TOPLEVEL` |
| symlink aliasで同じrootを登録 | common dir duplicate |
| secondary worktreeをProject rootとして登録 | explicit rejection |
| 同じcommon dirを別Projectへ登録 | duplicate rejection |
| registered rootを移動／削除 | attention |
| target branchを削除 | attention、Run開始なし |

### 11.2 Task workspace

| Test | Expected |
| --- | --- |
| clean worktree、branch／HEAD一致 | admission成功 |
| detached HEAD | reject |
| source branch変更 | reject |
| HEAD変更 | reject |
| common dir差し替え | reject |
| worktree path symlink差し替え | reject |
| dirty initial worktree | reject |
| conflict pathあり | reject |
| target branch進行 |base SHA維持、comparison更新 |
| upstream未fetch | freshness=`local_only` |

### 11.3 Run and resume

| Test | Expected |
| --- | --- |
| workspaceなし新規Run | `TASK_WORKSPACE_REQUIRED` |
| legacy prior Runあり | migration required |
| resume同一binding | success |
| resume後にworkspace reallocated | reject |
| Task projection pathだけ変更 | authorityは変わらずmismatch |
| providerが別repoRootを送信 | request authority mismatch |

### 11.4 Filesystem confinement

| Test | Expected |
| --- | --- |
| `cwd=..` | reject |
| absolute pathへwrite | sandbox block |
| shell redirectionで`/tmp`へ成果物 | transient外ならblock |
| symlink経由で別Projectへwrite | block |
| 別repositoryでtest成功 | Task evidenceへ採用不可 |
| Run transient rootでfile作成 | cleanup、artifact登録不可 |
| external read grantからcopy | Task deltaだけ成果物 |
| nested `.git`作成 | rejectまたはundeclared repo attention |

### 11.5 Secret

| Test | Expected |
| --- | --- |
| base worktreeだけに`.env` | Task worktreeへcopyされない |
| userがTask worktreeへ`.env`作成 | commandだけ利用可 |
| `read_file .env` | secret path rejection |
| Project exploration | `.env`内容なし |
| 一般commandで`env`出力 | provider keyなし |
| Hook／MCP／Git／bootstrapで`env`出力 | provider keyなし |
| worker snapshot inspection | raw secretなし |
| stdoutにexact secret | redacted |
| secretがchunk境界を跨ぐ | redacted |
| URL encoded／base64 secret | redacted |
| background outputにsecret | DB／artifact／eventへraw値なし |
| final reportにsecret fixture | persistence firewall reject／redact |
| SQLite file／WAL byte scan | raw fixture 0件 |
| temporary directory byte scan | raw fixture 0件 |

### 11.6 Git closeout and merge

| Test | Expected |
| --- | --- |
| expected HEADとcloseout HEAD不一致 | commit不可 |
| pre-existing dirty pathあり | owned pathへ含めない |
| staged pathがownership外 | commit不可 |
| commit成功 | expected HEAD CAS更新 |
| preview後source branch進行 | merge不可 |
| preview後target進行 | stale preview |
| target dirty／conflict | merge不可 |
| merge成功 | target after SHA保存 |
| push前target進行 | push不可 |

## 12. Verification Commands

Phaseごとのtargeted testに加え、最終的に次を実行する。

```bash
bun run typecheck
bun run check:architecture
bun run check:docs
bun run test -- tests/task-git-workspace-schema.test.ts
bun run test -- tests/start-task-run-workspace.test.ts
bun run test -- tests/gitworktree/gitworktree-service.test.ts
bun run test -- tests/plan-time-git-workspace-merge.test.ts
bun run test -- tests/nightworkers-git-closeout.test.ts
bun run test -- tests/worker-process-isolation.test.ts
bun run test -- tests/background-processes.test.ts
bun run test -- tests/services.background-processes-unit.test.ts
bun run test -- tests/workspace-dependency-bootstrap.test.ts
bun run verify:base
```

新規targeted test候補:

```text
tests/project-repository-identity.test.ts
tests/workspace-attestation.test.ts
tests/run-workspace-authority.test.ts
tests/workspace-process-sandbox.test.ts
tests/workspace-artifact-provenance.test.ts
tests/child-process-environment.test.ts
tests/provider-credential-broker.test.ts
tests/secret-persistence-firewall.test.ts
tests/project-secret-file-boundary.test.ts
tests/migrations.workspace-authority.test.ts
tests/migrations.secret-store-cutover.test.ts
```

secret persistence testは通常のAPI response検査だけでなく、test database、WAL、artifact directory、
runtime log directory、Run transient directoryのbyte scanを行う。

## 13. Rollout and Recovery

### 13.1 Feature rollout

段階導入は次の順とする。

1. shadow attestation:観測とdiagnosticだけを保存し、旧Runをblockしない。
2. Project registration enforcement:新規Projectだけidentity必須。
3. new Task enforcement:新規Task workspaceだけbinding必須。
4. new Run enforcement:新規Runをfail-close。
5. resume enforcement:legacy Runをmigration requiredへ移行。
6. tool authority cutover:Run-scoped resolverへ統一。
7. secret persistence cutover:新規SQLite secret write停止。
8. legacy removal:旧path authorityとsecret fallback削除。

各段階は個別のschema revisionとmetricを持つ。認証の有無をrollout条件にしない。

### 13.2 Startup reconciliation

起動時にactive Project／workspace／Runをread-only probeし、次を分類する。

- verified
- stale observation
- attention required
- missing
- identity conflict
- secret migration required

自動でbranch、HEAD、path、Todo、Task statusを採用し直さない。attention reasonと再probe actionだけを
保存する。

### 13.3 Rollback

- 新schema columnは旧read pathと共存させる。
- enforcement flagを戻してもraw secret persistenceを再有効化しない。
- OS secret store移行後にSQLite secret writeへrollbackしない。
- legacy Runのbase root executionをrollback先にしない。
- sandbox unavailable時はcommandを停止し、unsandboxed executionへfallbackしない。

## 14. Observability

保存可能なmetric:

- Project identity verification success／failure count
- workspace attestation operation、result、failure code
- allocation version conflict count
- Run binding missing count
- workspace mismatch count
- source-vs-target ahead／behind
- upstream freshness category
- sandbox backend／availability／block count
- child env key count
- redaction count
- persistence rejection count
- transient cleanup success／failure

保存禁止:

- env value
- secret value／hash
- `.env`内容
- raw stdout／stderr
- raw provider request credential
- raw provider responseに含まれるsecret
- unrestricted command args
- absolute external pathを含むmodel-visible payload

## 15. Definition of Done

次をすべて満たしたときだけ本計画を完了とする。

1. Project root、Git common dir、base worktreeがversion付きidentityとして保存される。
2. Task workspaceがProject identityと同じGit repositoryに属することを再検証できる。
3. Task workspace bindingがsource ref、target ref、base SHA、expected HEADを保持する。
4. Runがworkspace ID、allocation version、admission attestationを保持する。
5. 新規RunとresumeがTask専用worktree以外で開始できない。
6. dirty、ahead／behind、conflictが比較基準と観測時刻付きで表示される。
7. toolのrepo rootがRun bindingからserver側で解決される。
8. shell commandがOS-level sandboxでTask worktree外へwriteできない。
9. 別repositoryのdiff、test、fileを成果物または完了証拠にできない。
10. temporary directoryのfileを成果物または完了証拠にできない。
11. base worktreeの`.env`がTask worktreeへcopyされない。
12. Project secret fileをfile tool、exploration、artifactから取得できない。
13. provider credentialが一般child processへ継承されない。
14. raw secretがevent、artifact、SQLite、WAL、runtime log、temporary outputへ保存されない。
15. SQLite secret write pathとlegacy fallbackが削除される。
16. startup reconciliationがmismatchをattentionへ分類し、自動採用しない。
17. targeted test、architecture check、docs check、`verify:base`が成功する。
18. 既存の認証削除変更を上書き、復元、再導入していない。
19. product authenticationを追加していない。
