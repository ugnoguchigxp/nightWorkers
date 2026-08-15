# Security Intelligence Executable Integration 実装計画

## Status

- Plan status: Code implemented; rollout default OFF; pilot evidence pending
- Last updated: 2026-08-15
- Applies to: `vulnWorkbench`, `NightWorkers`, `contextStill`
- Source concept: [Security Intelligence Integration Concept](./security-intelligence-integration-concept.md)
- Existing producer plan: `vulnWorkbench/spec/security-intelligence-pr4-nightworkers-pilot-plan.md`
- Scope: Concept Stage 0からStage 3までを実行可能にするためのcross-repository変更
- Implementation in this change: SI-00からSI-INT-01までのcode pathを3 repositoryへ実装済み。SI-PILOT-01の実環境1-pair / 10-pair pilotとdated GO / ITERATE / STOP decisionは未実施であり、Stage 2 / Stage 3 completeはまだ宣言しない。

## 1. 結論

構想の方向性は変更しない。現在不足しているのは、新しいscannerや別Agent runtimeではなく、次の接続と永続化である。

1. `vulnWorkbench`が既に返せるrevision-bound assessmentを、`NightWorkers`がstrictに解釈し、scan開始時のproject / revision / digestへ結び付けて保存する。
2. `NightWorkers`がSecurity ContractをTask / Runへimmutableかつversionedに保存し、User、Mission Pilot、Coding Agentのいずれから操作された場合も同じapplication commandと同じRun contractへ接続する。
3. 採用済みFeature Plan、明示project policy、またはdirect Runの明示completion conditionがSecurity Contractを参照する場合だけ、そのconditionを完了評価へ渡す。hostは本文から必要性や合否を推測しない。
4. `contextStill`のPostgreSQL、TypeScript SQLite、Rust native SQLiteでcandidate lifecycleを揃え、登録直後のcandidateを`active` Knowledgeにしない。
5. NightWorkersからcontextStillへのmutationはdurable outboxとidempotentな専用ingressを通し、candidate登録失敗でTaskやscanを巻き戻さない。

初回実装はStage 2までを第一tranche、Stage 3を第二trancheとする。第一trancheでは、実装前assessmentをTask Revision Snapshotへ、実装後assessmentをRunのcanonical Evidence Subjectへ別々にbindingし、同じSecurity Contractから変更後verificationまで追跡できるpre / post loopを成立させる。Knowledge candidate送信はそのintegrityをpilotで確認した後に接続する。

## 2. 変更しない境界

本計画では次を変更対象にしない。

- Mission PilotとCoding Agentの所有責務を統合しない。
- User操作とMission Pilot操作を別の権限model、別workflow、別completion policyへ分けない。Mission PilotはUserに許可されたapplication commandを使用する。
- Coding AgentのUser直結RunとMission Pilot handoff Runでruntime、tool contract、semantic modeを分けない。
- User、Mission Pilot、Coding Agentのどれがartifactを作成したかはaudit provenanceとして保持できるが、provenance文字列から権限、tool、完了条件を切り替えない。
- Security evidenceが存在すること自体を全Runの固定completion gateにしない。
- `off / shadow / advisory / required`のようなTask-level activation stateをSecurity Contractへ追加しない。
- hostがFeature Plan本文、Task本文、LLM本文をkeywordや正規表現で分類しない。
- vulnWorkbenchのassessmentをNightWorkersが独自にconfirmed findingへ変換しない。
- contextStillのcandidateをNightWorkersまたはvulnWorkbenchが直接`active`化しない。
- 各productのprivate databaseを他productから読まない。
- 新scanner、大規模Ontology、自動policy緩和、自動verification省略、automatic Knowledge promotionは追加しない。
- 既存Security Scan integration v1を破壊的変更しない。

## 3. Implementation-start codebase baseline

2026-08-15の実装着手時点を基準とする。以下の不足欄は実装前の差分であり、現在の実装状況は17節を正本とする。

| ID | Repository | 現在あるもの | 実行可能にするための不足 |
| --- | --- | --- | --- |
| B-01 | vulnWorkbench | `GET /api/integrations/nightworkers/security-intelligence/v1/scans/:scanRunRef/assessment`、strict bundle schema、auth、owner/project binding、target/evidence binding、payload上限、default OFF flagが実装済み | NightWorkers consumerが未実装。Security Intelligence専用capability responseも未実装 |
| B-02 | NightWorkers | Security Scan preview/start/status/findings/report clientとbinding履歴がある | `shared/schemas/security-scan.schema.ts`のbindingは`scanRunRef`、input selection/target、createdAtだけで、provider project ref、resolved source revision、resolved target digestを保持しない |
| B-03 | NightWorkers | scan startはproviderのstrict responseを受け取る | `api/modules/securityScan/security-scan.routes.ts`はstart結果のtarget identityをbindingへ保存せず、requestのtarget selectorだけを保存する |
| B-04 | NightWorkers | Task Runにtask revision、workspace authority、admitted HEAD、context snapshotがあり、evidence subject snapshotにsource state / diff digestがある | Security Intelligence assessment receipt、Security Contract、completion conditionとの構造的参照がない |
| B-05 | NightWorkers | security scan binding履歴をapplication settingsへ保存する | `api/modules/securityScan/security-scan-settings.service.ts`でrepositoryごと20件に切られるため、Task / Run evidenceの正本にはできない |
| B-06 | NightWorkers | standard Run prompt snapshotに既存`securityOracle`設定がある | Security Contractとassessment referenceがCoding Agent contextへ渡らない |
| B-07 | contextStill | PostgreSQLの`registerCandidate`はdistillation target、candidate result、queueへ登録し、finalizeでKnowledgeを`draft`にする | TypeScript SQLite経路だけembedding後にKnowledgeを`active`で直接insertする |
| B-08 | contextStill | desktopで使用するRust native MCPに`register_candidates`がある | Rust native SQLite経路もKnowledgeを`active`で直接insertし、返却値だけ`next: distillation_pipeline`としている |
| B-09 | contextStill | SQLite core schemaにもcandidate / covering / finalize pipelineのtableがある | TypeScript SQLiteとRust nativeがそのpipelineを使用していない |
| B-10 | Cross-repository | vulnWorkbenchにassessmentのpositive fixture、negative fixture、canonical digest検証がある | NightWorkers側assessment consumer fixtureと、NightWorkers / contextStill間のcandidate batch fixtureがない。3 product共通のidentity / redaction fixtureもない |
| B-11 | NightWorkers | Task revision snapshot、workspace authority、Evidence Subject snapshot、Run final judgment columnがある | assessmentのpre / post phase binding、Security Contract head CAS、両runtime lane共通のstructured final judgment提出経路がない |
| B-12 | NightWorkers / vulnWorkbench | Security Scanの既定transportに`local_cli`があり、HTTP transportとは別のscan lifecycleを持つ | Security Intelligence bundleを取得するlocal CLI consumer contractはない。Tranche Aで対応transportを明示しないとdefault構成のavailabilityが曖昧になる |

既存実装として完了しているvulnWorkbench producerを作り直さない。`vulnWorkbench/spec/security-intelligence-initial-implementation-roadmap.md`のPR 1からPR 3、およびPR 4 producer部分をbaselineとして利用する。

## 4. Target lifecycle

```text
pre-implementation Security Scan preview
  -> Security Scan start
  -> durable Scan Binding
       projectRef + scanRunRef + sourceRevisionRole + sourceRevision + targetDigest
  -> assessment fetch
  -> strict parse + exact binding validation
  -> immutable Assessment Receipt
  -> pre-implementation Assessment Subject Binding
       Task Revision Snapshot
  -> role-side LLM creates/updates task-scoped Security Contract
  -> explicit completion condition may reference the Contract
  -> same Run context for direct and handoff Runs
  -> implementation
  -> role / human explicitly requests planned post-implementation assessment
  -> post-implementation scan against server-resolved Task workspace
  -> post-implementation Assessment Receipt
  -> post-implementation Assessment Subject Binding
       Run + canonical Evidence Subject Snapshot
  -> verification / rerun correlation
  -> role-side LLM evaluates explicit completion conditions
  -> evidence-bound final judgment
  -> LLM or human proposes generalized Knowledge Candidates
  -> NightWorkers outbox
  -> contextStill candidate pipeline (not active Knowledge)
  -> review / distillation
  -> draft, then independent promotion policy
```

### 4.1 Semantic decision boundary

LLMへ残す判断:

- Taskに関係するinvariant、guardrail、verification candidateの選択
- Security Contract本文の作成と更新提案
- assessment、coverage、unknown、residual riskのTask-specific解釈
- 明示されたcompletion conditionを満たしたか、needs-humanか、blockedかの評価
- finding、修正、rerunから再利用可能なKnowledge Candidateを提案するか
- Security Contract、Todo、Feature Planに基づきpost assessment application commandを実行するか

host / serverが強制する不変条件:

- schema version、payload size、authorization、project ownership
- task revision snapshot、run / workspace authority、Evidence Subject、projectRef、scanRunRef、sourceRevision role、targetDigestの一致
- immutable reference、digest、idempotency、revision conflict
- explicit completion conditionがfinal judgmentから欠落していないこと
- staleまたはforeign evidenceをcurrent evidenceとして参照しないこと
- outboxのtransaction、retry上限、停止手段、receipt
- secret、credential、LLM-visible / durable integration artifact内のabsolute private pathの拒否またはredaction。既存scan v1 requestと5.3のauthenticated短命grant requestはserver-only例外とし、response / telemetry / receiptへ残さない

hostはSecurity ContractやFeature Plan本文の語句からcompletion gateを生成しない。role側LLMが返した意味判断を固定文へ置き換えない。

## 5. Versioned contracts

### 5.1 Provider Scan Binding v2

NightWorkers内部のdurable schemaとする。既存provider wire contract v1は変更しない。

```ts
type ProviderScanBindingV2 = {
  version: 2;
  bindingRef: string;
  repositoryId: string;
  provider: "vulnworkbench";
  identityMappingVersion: 1;
  providerProjectRef: string;
  scanRunRef: string;
  selection: SecurityScanSelection;
  requestedTarget: SecurityScanTarget;
  resolvedTarget: {
    kind: "full" | "working_tree";
    sourceRevisionRole: "snapshot_revision" | "base_revision";
    sourceRevision: string | null;
    targetDigest: string;
  };
  bindingDigest: string;
  createdAt: string;
};

type SecurityIntelligenceBindingProofV1 = {
  version: 1;
  proofRef: string;
  rawProjectRef: string;
  canonicalProjectRef: `project:${string}`;
  rawScanRunRef: string;
  canonicalScanRunRef: `scan-run:${string}`;
  target: {
    kind: "diff";
    baseRevision: string;
    assessedRevision: string;
    rawTargetDigest: string;
    canonicalTargetDigest: `sha256:${string}`;
  };
  proofDigest: `sha256:${string}`;
};
```

Rules:

- `providerProjectRef`は既存capabilities responseの`project.ref`から取得する。
- `resolvedTarget`はpreview/start responseのprovider観測値から作り、request selectorで代用しない。
- v1 wire identityとSecurity Intelligence v1 identityの対応を次で固定し、文字列の見た目による推測を実装ごとに重複させない。

| Semantic identity | Security Scan v1 | Security Intelligence v1 | Comparison rule |
| --- | --- | --- | --- |
| project | raw provider UUID/ref | `project:<raw-ref>` | `identityMappingVersion: 1`のadapterでprefixを1回だけ付与・除去する |
| scan run | raw provider UUID/ref | `scan-run:<raw-ref>` | 同上 |
| target digest | 64桁lowercase hex | `sha256:<hex>` | algorithm prefixを検証後、hex部分をconstant-time相当の比較へ渡す |
| working-tree base | start `sourceRevision` | binding proof `target.baseRevision` | `sourceRevisionRole = base_revision`として比較する |
| assessed revision | startでは取得不能 | binding proof `target.assessedRevision` + assessment `target.sourceRevision` | proofとassessmentを比較し、receiptに別fieldで保存する |
| full snapshot revision | start `sourceRevision` | capabilityが対応をadvertiseしたassessment field | 対応fieldがcontract fixtureで確定するまでassessment対象外 |

- `working_tree`ではstartの`sourceRevision`をassessmentの`target.sourceRevision`へ直接比較しない。前者は`baseSha`、後者は`headSha`または`working-tree/<digest>`である。
- producer project refはcapabilitiesとpreview/startの間で変化し得る。またworking-tree start responseはbase revision、assessmentはassessed revisionしか公開しない。この差を推測で埋めず、Security Intelligence route rootへread-only binding proof endpointを追加し、producerが保持するscan bindingからraw / canonical project・scan ref、base / assessed revision、raw / canonical digestを返す。
- NightWorkersはstart response、binding proof、assessment bundleの三者を検証する。mismatch時はreceiptもTask/Run associationも作らない。将来scan start responseへproject refを追加する場合は既存strict v1へfieldを足さず、新versionで行う。
- binding proofのsemantic canonical payloadは`proofRef`と`proofDigest`を除外し、`proofRef = sibp:v1:<proof digest hex>`とする。同じscan refへ異なるproof digestを返した場合はintegrity conflictとする。
- start前previewのdigestとstart responseのdigestが一致しない場合はbindingを作らず、scanをTaskへ関連付けない。
- `bindingDigest`はversionを含むcanonical payloadから決定的に算出する。
- binding作成後に同じ`scanRunRef`へ異なるdigestを登録した場合はconflictとする。
- 既存settings内bindingから不足fieldを推測してbackfillしない。`legacy_unverifiable`として履歴表示だけを許可し、assessment consumerの入力には使わない。

### 5.2 Assessment Receipt v1

NightWorkersがproducer payloadを再解釈せず、受領時のbindingと状態を保存する。

```ts
type SecurityAssessmentReceiptV1 = {
  version: 1;
  receiptRef: string;
  repositoryId: string;
  scanBindingRef: string;
  providerBindingProofRef: string;
  providerBindingProofDigest: `sha256:${string}`;
  providerProjectRef: string;
  scanRunRef: string;
  canonicalProjectRef: `project:${string}`;
  canonicalScanRunRef: `scan-run:${string}`;
  normalizedTarget: {
    kind: "diff" | "snapshot" | "commit";
    sourceRevision: string;
    baseRevision?: string;
    targetDigest: `sha256:${string}`;
  };
  producerContractVersion: 1;
  bundleRef: string;
  assessmentRefs: string[];
  payloadDigest: `sha256:${string}`;
  payload: NightworkersSecurityIntelligenceBundleV1;
  receivedAt: string;
};
```

Rules:

- producer fixtureをNightWorkers側のstrict Zod schemaでparseする。
- bundle、各assessment、各evidence refのproject / scan / target bindingを再検証する。
- raw scan binding、producer binding proof、bundleの比較は5.1の`identityMappingVersion`を通す。normalized targetをscan v1 fieldへ直接文字列比較しない。
- producer側strict schemaをruntime packageとして共有しない。wire fixture、JSON Schema相当の契約、canonical hashをrepositoryごとに検証する。
- 同じ`bundleRef`、同じprovider binding proof digest、同じpayload digestの再取得はreplayとして扱う。いずれかが異なる場合はintegrity conflictとする。
- source本文、raw scanner artifact、absolute pathをNightWorkersへ複製しない。既存bundleのbounded referenceだけを保存する。
- `inconclusive`、`unknown`、`unavailable`をsuccessへ正規化しない。

### 5.3 Post-workspace target grant and Assessment Subject Binding v1

Assessment ReceiptとTask / Runの関連付けは別のimmutable rowとし、repository-level receiptを暗黙にcurrent Runへ流用しない。

```ts
type CreateProviderWorkspaceTargetGrantRequestV1 = {
  version: 1;
  providerProjectRef: string;
  workspaceSubjectRef: string;
  workspacePath: string; // server-resolved absolute path; LLM / browser inputは禁止
  expectedGitCommonDirDigest: `sha256:${string}`;
  expectedHeadSha: string;
};

type ProviderWorkspaceTargetGrantV1 = {
  version: 1;
  grantRef: string;
  providerProjectRef: string;
  workspaceSubjectRef: string;
  expectedGitCommonDirDigest: `sha256:${string}`;
  expectedHeadSha: string;
  providerWorkspaceStateDigest: `sha256:${string}`;
  expiresAt: string;
  grantDigest: `sha256:${string}`;
};

type SecurityAssessmentSubjectBindingV1 =
  | {
      version: 1;
      bindingRef: string;
      phase: "pre_implementation";
      assessmentReceiptRef: string;
      taskId: string;
      taskRevisionSnapshotId: string;
      taskRevision: number;
      taskDigest: string;
      repositoryIdentityRevision: number;
      repositoryBaseWorktreeId: string;
      expectedBaseHeadSha: string;
      bindingDigest: string;
      createdAt: string;
    }
  | {
      version: 1;
      bindingRef: string;
      phase: "post_implementation";
      assessmentReceiptRef: string;
      taskId: string;
      taskRevisionSnapshotId: string;
      taskRevision: number;
      taskDigest: string;
      implementationRunId: string;
      evidenceSubjectSnapshotId: string;
      providerWorkspaceTargetGrantRef: string;
      providerWorkspaceTargetGrantDigest: `sha256:${string}`;
      providerWorkspaceStateDigest: `sha256:${string}`;
      workspaceId: string;
      workspaceAllocationVersion: number;
      admittedHeadSha: string;
      sourceStateHash: string;
      diffDigest: string;
      bindingDigest: string;
      createdAt: string;
    };

type RequestPostSecurityAssessmentCommandV1 = {
  version: 1;
  runId: string;
  expectedTaskRevisionSnapshotId: string;
  expectedWorkspaceId: string;
  expectedWorkspaceAllocationVersion: number;
  selection: SecurityScanSelection;
};

type RequestPostSecurityAssessmentResultV1 =
  | { status: "completed"; assessmentAttemptRef: string; assessmentSubjectBindingRef: string }
  | { status: "not_applicable"; assessmentAttemptRef: string; reasonCode: string }
  | { status: "unavailable"; assessmentAttemptRef: string; reasonCode: string; retryable: boolean };
```

Rules:

- pre bindingはRun開始前のconstraint入力であり、Task Revision Snapshotとscanのbase / target identityを照合する。
- 既存scan v1はcanonical pathごとにprovider Projectを解決するため、Task worktree pathをそのまま渡して別Projectを作らない。vulnWorkbenchへSecurity Intelligence専用のworkspace-target grant endpointを追加する。
- grant作成requestだけはNightWorkers serverが解決したworkspace pathを既存authenticated server-to-server transportで渡す。vulnWorkbenchはowner / allowed root、symlink解決、登録Projectと同じGit common directory、expected HEADを検証し、provider側でworkspace state digestをcaptureして短命opaque `grantRef`を返す。pathをresponse、audit detail、telemetry、receipt、promptへ保存しない。
- post scan preview / startはpathではなく`grantRef`を受け、grantのProject、expiry、single workspace stateを再検証する。previewはgrantを消費せずtarget digestを固定し、startはexpected digestとidempotency keyを検証してCAS consumeする。同じstart replayは同じscanを返し、異なるrequestでの再consumeをrejectする。既存strict scan v1へfieldを追加せず、Security Intelligence route rootの独立version contractとする。
- post bindingは、serverがRunから解決した登録済みTask workspaceと有効なgrantだけをscan対象にできる。commandは同じworkspace stateからcanonical Evidence Subject Snapshotを作成または再利用し、LLMからabsolute pathを受け取らない。
- post scanは既存workspace mutation / closeout authorityのlease内で実行し、scan開始前後でworkspace allocation、admitted HEAD、source stateが変化していないことを確認する。drift時はreceiptをcurrent Runへbindingせず、canonical `evidence_subject_snapshots` rowへFKしない。
- pre receiptをpost evidenceとして、または別Runのpost receiptをcurrent evidenceとして使用しない。
- pre / postで異なるdigest algorithmを使用する場合、文字列一致を装わず、versioned correlation fixtureで「どのfieldを比較するか」を固定する。
- post assessmentはUser、Mission Pilot、Coding Agentが同じagent-neutral application commandで明示要求する。pre receiptの存在からhostが自動挿入せず、別runtime modeや固定Security workflowを作らない。
- post commandのrequest digestはRun、Task Revision Snapshot、workspace ID / allocation、Evidence Subject digest、selectionから算出する。同じdigestのretryは同じattempt / scan / receiptへ収束し、異なるworkspace stateを同じattemptとして再利用しない。
- 明示要求後に対象変更がない場合はcommandがtyped `not_applicable`を、transport / capability不足では`unavailable`を返し、同じruntime laneのcontextへ戻す。hostがsuccessへ正規化しない。

### 5.4 Security Contract v1

Security ContractはNightWorkersが所有するTask-scoped projectionであり、vulnWorkbench assessmentやcontextStill Knowledgeの正本を複製しない。

```ts
type SecurityContractV1 = {
  version: 1;
  contractRef: string;
  contractRevision: number;
  taskId: string;
  taskRevisionSnapshotId: string;
  taskRevision: number;
  taskDigest: string;
  repositoryId: string;
  projectRef: `project:${string}`;
  sourceState: {
    phase: "pre_implementation";
    assessmentSubjectBindingRef: string;
    revisionRole: "assessed_revision";
    revision: string;
    targetDigest: `sha256:${string}`;
  };
  affectedAssets: Array<{ kind: string; ref: string }>;
  declaredInvariantRefs: string[];
  knowledgeRefs: string[];
  assessmentSubjectBindingRefs: string[];
  requiredBaselineVerificationRefs: string[];
  targetedVerificationCandidateRefs: string[];
  nonGoals: string[];
  approvedBounds: {
    policyRefs: string[];
    budgetRefs: string[];
  };
  unknowns: Array<{ source: string; reasonCode: string }>;
  supersedesContractRef?: string;
  contractDigest: string;
  createdAt: string;
  authorPrincipalRef: string;
};
```

Rules:

- rowはimmutableとし、更新は新`contractRevision` + `supersedesContractRef`で行う。
- `version`はwire/schema version、`contractRevision`はTask revision snapshot内の単調増加revisionであり、混同しない。
- update commandは`expectedCurrentContractRef`と`expectedHeadRevision`を必須とする。repositoryは新row insertと`security_contract_heads`更新を同一transactionで行い、head不一致はtyped conflictとして自動mergeしない。
- 初回createは`expectedCurrentContractRef = null`、`expectedHeadRevision = 0`だけを許可する。既存headがあるTask Revision Snapshotへcreateを再実行した場合はupdateへ暗黙変換しない。
- `security_contract_heads.task_revision_snapshot_id`をuniqueにし、同じ親Contractから複数のcurrent successorを作らない。競合後の本文mergeと再提案はLLMまたはUserへ戻す。
- Taskの整数revisionだけで関連付けず、既存immutable `task_revision_snapshots` rowとdigestへFKする。
- `authorPrincipalRef`はaudit用であり、User、Mission Pilot、Coding Agentを理由に権限、runtime、tool、completion処理を分岐しない。
- User UI、Mission Pilot host adapter、Coding Agent direct Run adapterは同じagent-neutral application commandを呼ぶ。
- Mission Pilot adapterは`api/composition/mission-pilot`または`src/composition/mission-pilot`に置き、`packages/mission-pilot`からNightWorkers private sourceをimportしない。
- Coding Agentの全Runで同じbounded Security Contract snapshotを使用する。handoff provenanceによるtool allowlistやprompt modeは追加しない。
- ContractにTask-level activation enumを持たせない。

### 5.5 Explicit completion condition reference

Security Contractをcompletionへ反映する条件は、Contract自身の状態ではなく、採用済みcompletion conditionからの明示参照として保存する。

```ts
type AdoptedCompletionCondition = {
  conditionRef: string;
  taskId: string;
  taskRevisionSnapshotId: string;
  taskRevision: number;
  taskDigest: string;
  conditionRevision: number;
  conditionKey: string;
  state: "adopted" | "revoked";
  source:
    | {
        kind: "feature_plan";
        artifactRef: string;
        artifactDigest: string;
      }
    | {
        kind: "project_policy";
        policyRef: string;
        policyRevision: number;
        artifactDigest: string;
      }
    | {
        kind: "direct_user_instruction";
        messageRef: string;
        artifactDigest: string;
      }
    | {
        kind: "coding_agent_todo";
        runId: string;
        todoKey: string;
        todoRevision: number;
        todoPlanRevision: number;
        artifactDigest: string;
      };
  subjectRef: string; // Security Contract refを参照できる
  supersedesConditionRef?: string;
  conditionDigest: `sha256:${string}`;
  recordedAt: string;
  authorPrincipalRef: string;
};
```

Rules:

- Feature Plan / policy / direct Run planを生成または採用するrole側LLM・User操作が、構造化commandで参照を登録する。
- User操作とMission Pilot操作は同じcommand、同じauthorization、同じrevision checkを使う。
- Coding Agent単体Runでは、Userの明示指示またはCoding Agentが明示更新したTodo / planをsourceにできる。hostの観測から暗黙追加しない。
- source artifactまたはTodoが更新されても既存conditionを暗黙更新しない。新digest / revisionを参照する新conditionをCAS付きcommandで採用し、旧conditionを`supersedesConditionRef`で置き換える。
- `task_completion_condition_heads`は`taskRevisionSnapshotId + conditionKey`をuniqueにし、update commandはexpected condition ref / head revisionを検証する。同じcondition keyのcurrent successorを分岐させない。
- condition初回createもexpected ref `null` / head revision `0`を要求し、既存headがある場合は暗黙updateしない。
- conditionを外す場合もrow削除やhost観測による暗黙削除を行わず、`state = revoked`の新revisionを明示commandで作る。final judgmentのexpected setにはcurrent headが`adopted`のconditionだけを含める。
- Run closeoutはcurrent condition setをRun開始時snapshotおよび明示的なRun中更新から再構成し、別RunのTodo、旧Todo revision、旧Task Revision Snapshot由来のconditionを拒否する。
- conditionがなければSecurity Contractはcontextとして利用できるが、完了条件へは追加しない。
- conditionがあればrole側LLMのfinal judgmentはconditionRefごとの結果とevidence refsを返す。
- hostはconditionの存在を理由にassessment outcomeを独自計算しない。condition resultの欠落、wrong revision、foreign evidenceだけを構造的に拒否する。
- 現行`securityFinalizationBlocked`をproducer statusへ直結しない。意味判断の固定boolean化は行わない。

### 5.6 Security Final Judgment v1

両Coding Agent runtime laneは同じstructured resultを返し、hostは最終本文からcondition結果を抽出しない。

```ts
type SecurityFinalJudgmentV1 = {
  version: 1;
  runId: string;
  taskRevisionSnapshotId: string;
  securityContractRef: string;
  securityContractDigest: string;
  assessmentAttemptRefs: string[];
  assessmentSubjectBindingRefs: string[];
  conditionEvaluations: Array<{
    conditionRef: string;
    result: "satisfied" | "not_satisfied" | "needs_human" | "blocked" | "not_applicable" | "unavailable";
    evidenceRefs: string[];
    limitationCodes: string[];
    rationale: string;
  }>;
  residualRisk: {
    level: "low" | "medium" | "high" | "unknown";
    rationale: string;
  };
  judgmentDigest: string;
  createdAt: string;
};

type SubmitSecurityFinalJudgmentCommandV1 = {
  version: 1;
  runId: string;
  expectedRunStatus: "running" | "finalizing" | "verifying";
  expectedTaskRevisionSnapshotId: string;
  expectedSecurityContractRef: string;
  expectedConditionRefs: string[];
  judgment: SecurityFinalJudgmentV1;
};
```

Rules:

- `RuntimeLaneResult`へoptional `securityFinalJudgment`を追加し、native API laneとCodex laneで同じstrict schemaを使用する。adopted conditionが1件以上ある場合だけrequiredとする。
- runtimeはcondition evaluationをtool / structured resultとして返す。final report本文のparse、keyword分類、host側の合否再計算を行わない。
- post assessment commandは両laneで同じtool contractを持ち、Run IDとexpected workspace allocationだけを受け取る。serverがauthoritative pathとEvidence Subjectを解決し、receipt / typed unavailableをtool resultとして同じlaneへ返してからrole側LLMがjudgmentを提出する。
- application serviceはRun、Task Revision Snapshot、current Contract head、expected condition set、assessment attempt / subject binding、evidence subject bindingを再検証する。
- final judgment保存と`run.final_judgment_created` event appendをterminal status publishより先に同一closeout transactionで完了する。CAS conflictまたはinvalid resultではterminal化せず、同じruntime laneへtyped continuationを返す。
- conditionなしのRunではfieldを省略でき、Security固有のevaluationやgateを追加しない。
- rationaleはbounded safe text、evidence refは既存receipt / Evidence Ledger / verification documentから解決できるopaque refだけを許可する。

### 5.7 Security Knowledge Candidate Batch v1

NightWorkersのoutboxとcontextStill ingressで共有するwire contractとする。

```ts
type SecurityKnowledgeCandidateBatchV1 = {
  contractVersion: 1;
  batchRef: string;
  idempotencyKey: string;
  batchPayloadDigest: `sha256:${string}`;
  producer: { system: "nightworkers"; version: string };
  correlation: { taskRef: string; runRef: string };
  items: Array<{
    candidateRef: string;
    fingerprint: string;
    payloadDigest: `sha256:${string}`;
    type: "rule" | "procedure";
    polarity: "positive" | "negative";
    title: string;
    body: string;
    applicability: {
      domains: string[];
      technologies: string[];
      changeTypes: string[];
    };
    evidenceRefs: Array<{
      assessmentRef: string;
      evidenceRef: string;
      evidenceDigest: string;
      sourceProjectRef: string;
      sourceRevision: string;
      targetDigest: string;
    }>;
    confidence: number;
    limitations: string[];
  }>;
};
```

Initial limits:

- 1 batchあたり1から10 candidate。
- UTF-8 byteでtitle 512 bytes、body 16 KiB、limitations合計8 KiB、1 item 32 KiB、batch全体256 KiBを上限とする。`evidenceRefs`は1 itemあたり1から20件とする。
- `evidenceRefs`を最低1件要求する。LLM explanationだけのcandidateは拒否する。
- bodyからproject固有identifierを除く。ただしsource project / revisionはprovenance metadataとして保持する。
- absolute path、credential pattern、control characterを拒否する。redactionで意味が変わる場合は自動修復せずitem rejectとする。
- item `payloadDigest`は当該itemから`payloadDigest`を除いたstrict canonical JSONのSHA-256とする。
- `fingerprint`はversion prefix付きとし、`type`、`polarity`、generalized `title / body`、canonical applicabilityから算出する。evidence、project / run correlation、confidenceはfingerprintへ含めず、duplicate itemでは既存candidate refへ新しいprovenanceをappendする。
- `batchPayloadDigest`は`idempotencyKey`、`batchRef`、`batchPayloadDigest`を除くsemantic batch payloadのstrict canonical JSONから算出する。`batchRef`は`skcb:v1:<batch digest hex>`とし、同じsemantic payloadから決定的に再計算できるようにする。
- idempotency keyのscopeはauthenticated producer principal + endpoint + contract versionとする。同じscopeの`idempotencyKey + batchPayloadDigest` replayは保存済みreceipt refとitem resultをそのまま返す。同じkeyで異なるbatch digestは409 conflictとし、item mutationを行わない。
- 同じsemantic batchを別idempotency keyで送った場合は新request receiptを作れるが、item fingerprint / payload digestによって各itemを`duplicate`とし、candidate pipelineを再enqueueしない。
- batch successはcandidateのtransactional受領を意味し、Knowledgeの`active`化を意味しない。
- contextStill内部では、receiptの`accepted`を既存`distillation_target_states.status = pending`、`find_candidate_results.status = selected`、対応queue rowへ写像する。この境界をquarantine相当とし、新しいKnowledge statusは増やさない。

Transaction semantics:

- auth、top-level schema、contract version、batch byte limit、batch digest mismatchはrequest全体をrejectし、receiptもitem rowも作らない。
- top-level validation後は各itemを独立に検証し、`accepted`、`duplicate`、`rejected`を同じreceiptへ記録する。1 itemのvalidation rejectで他のvalid itemをrollbackしない。
- receipt、全item result、accepted itemのcandidate pipeline enqueueは1 DB transactionとする。DB failure時は全体をrollbackし、retry可能なreceiptを捏造しない。
- accepted item 0件でも検証済みreceiptを保存し、同じkeyのreplayへ同じ結果を返す。
- payload duplicate判定はitem fingerprint / payload digestのversioned規則で行い、idempotency key replayと同じ概念にしない。
- NightWorkers producerとcontextStill ingressの双方がfingerprint、item digest、batch digest / refを再計算し、caller値と一致しないrequestをmutation前にrejectする。
- 初回valid batchはpartial / all-rejectedを含めHTTP 201とreceipt、idempotent replayはHTTP 200、same-key different-digestはHTTP 409と`idempotency_conflict`を返す。authは401 / 403、top-level schemaは400、oversizeは413、feature / token未設定は503 `integration_unavailable`とし、item validation errorをHTTP errorへ昇格させない。

Response:

```ts
type SecurityKnowledgeCandidateBatchReceiptV1 = {
  contractVersion: 1;
  batchRef: string;
  receiptRef: string;
  items: Array<{
    candidateRef: string;
    status: "accepted" | "duplicate" | "rejected";
    targetStateRef?: string;
    reasonCode?: string;
  }>;
};

type SecurityKnowledgeCandidateBatchResponseV1 = {
  replayed: boolean;
  receipt: SecurityKnowledgeCandidateBatchReceiptV1;
};
```

### 5.8 Security Knowledge Feedback Batch v1

Stage 3 feedbackはcandidate ingressと別contract / outboxにし、自由形式telemetryやLLM self-verdictをground truthとして送らない。

```ts
type SecurityKnowledgeFeedbackBatchV1 = {
  contractVersion: 1;
  batchRef: string;
  idempotencyKey: string;
  batchPayloadDigest: `sha256:${string}`;
  producer: { system: "nightworkers"; version: string };
  events: Array<{
    eventRef: string;
    eventType:
      | "retrieved"
      | "selected"
      | "actually_used"
      | "verification_outcome"
      | "user_override"
      | "false_warning"
      | "harm_signal";
    occurredAt: string;
    correlation: {
      taskRef: string;
      runRef: string;
      compileRunRef?: string;
      verificationRef?: string;
    };
    knowledgeRef: string;
    knowledgeRevision: number;
    outcome?: "supported" | "contradicted" | "inconclusive" | "not_applicable";
    evidenceRefs: string[];
    reasonCode?: string;
  }>;
};

type SecurityKnowledgeFeedbackBatchReceiptV1 = {
  contractVersion: 1;
  batchRef: string;
  receiptRef: string;
  acceptedEventRefs: string[];
  duplicateEventRefs: string[];
  rejectedEvents: Array<{ eventRef: string; reasonCode: string }>;
};

type SecurityKnowledgeFeedbackBatchResponseV1 = {
  replayed: boolean;
  receipt: SecurityKnowledgeFeedbackBatchReceiptV1;
};
```

Rules:

- 1 batchは1から100 event、batch全体は128 KiB以下とする。source本文、prompt本文、absolute path、credential、unbounded rationaleを含めない。
- `retrieved`、`selected`、`actually_used`を別eventにし、retrievalだけで利用済みと扱わない。
- `verification_outcome`、`false_warning`、`harm_signal`は独立evidenceまたはUser操作refを要求する。LLM self-verdictだけのeventは`rejected`とする。
- batch digest、replay、partial item transaction semanticsは5.7と同じcanonical helperを再利用する。
- `eventRef`はcontract version、event type、correlation、knowledge ref / revision、outcome、evidence refsから決定的に算出し、別idempotency keyで同じeventを再送してもappend-only event rowを重複させない。
- NightWorkers producerとcontextStill ingressの双方がevent ref、batch digest / refを再計算し、不一致をmutation前にrejectする。
- contextStillはfeedbackをKnowledge本文やstatusへ直接反映せず、append-only observationとして保存する。promotion / demotion policyは別計画とする。
- HTTP status / error envelopeは5.7と同じ規則を使用する。

### 5.9 Canonicalization and shared bounds

- canonical JSON v1は既存vulnWorkbench contractの意味に合わせ、NFC Unicode、finite number、plain JSON object / dense arrayだけを許可し、object keyをlexicographic sort、array orderを保持し、whitespaceなしUTF-8 JSONとしてSHA-256を計算する。
- cross-product runtime packageは共有しない。各repositoryの独立実装へ、Unicode、key order、array、number、excluded field、digest prefixを含む同じgolden vectorを通す。
- schema上set semanticsを持つref / applicability / limitation arrayはuniqueかつlexicographic orderを要求し、producer順をhostがsilent sortしてdigestを変えない。順序に意味があるevent / evaluation arrayはschemaで明示した順を保持する。
- digest fieldはすべて`sha256:<64 lowercase hex>`、refへdigestを埋める場合はcontractごとの固定prefixを要求する。raw hexとの境界は5.1だけに限定する。

| Artifact | Digest inputから除外するfield |
| --- | --- |
| Provider Scan Binding | `bindingRef`、`bindingDigest`、`createdAt` |
| Binding Proof | `proofRef`、`proofDigest` |
| Assessment Receipt payload | receipt metadata全体。strict producer `payload`だけをdigestする |
| Workspace Target Grant | `grantRef`、`grantDigest`。`expiresAt`は含める |
| Assessment Subject Binding | `bindingRef`、`bindingDigest`、`createdAt` |
| Security Contract | `contractRef`、`contractDigest`、`createdAt`、`authorPrincipalRef` |
| Completion Condition | `conditionRef`、`conditionDigest`、`recordedAt`、`authorPrincipalRef` |
| Security Final Judgment | `judgmentDigest`、`createdAt` |
| Candidate / Feedback Batch | 5.7で定義した`idempotencyKey`、`batchRef`、`batchPayloadDigest` |

- byte limitはHTTP bodyをJSON parse前に、field / canonical payload limitをstrict parse後かつDB mutation前に検証する。UTF-16 code unit数をUTF-8 byte数の代用にしない。
- Assessment Receipt payloadはproducer capabilityがadvertiseする上限か2 MiBの小さい方、Security Contractは128 KiB、current completion conditionは1 Task Revision Snapshotあたり100件、Security Final Judgmentは128 KiBを上限とする。
- Security Contractの各ref配列は1,000件、`unknowns`は200件、final judgmentのcondition evaluationはcurrent condition setとexactly同じ件数・ref集合を要求する。
- limit変更は同じcontract versionのdeployment config差にせず、新capabilityまたは新contract versionとfixture更新で行う。

## 6. Persistence changes

### 6.1 NightWorkers

追加するlogical tables:

| Table | Purpose | Key invariants |
| --- | --- | --- |
| `security_scan_bindings` | Provider Scan Binding v2の正本 | unique `scan_run_ref`、unique `binding_digest`、repository FK |
| `security_assessment_receipts` | strict producer bundleと受領binding | unique `bundle_ref`、unique `payload_digest`、scan binding FK、provider binding proof ref / digest |
| `security_assessment_attempts` | pre / post commandのdurable status | request digest、phase、Task / Run subject、completed / not_applicable / unavailable、reason / retryability |
| `security_assessment_subject_bindings` | receiptのpre / post Task・Run関連付け | receipt FK、task revision snapshot FK、postはRun / Evidence Subject / workspace FK、unique binding digest |
| `security_contracts` | immutable Task-scoped Contract revision | unique `contract_ref` / `contract_digest`、task revision snapshot FK、unique non-null supersedes ref |
| `security_contract_heads` | Contract update CAS | unique task revision snapshot、current contract ref、monotonic head revision |
| `task_completion_conditions` | 採用済みcompletion conditionの構造的参照 | task revision snapshot、source別revision、subject ref、supersedes chain |
| `task_completion_condition_heads` | condition update CASとcurrent set | unique task revision snapshot + condition key、current condition ref、monotonic head revision |
| `security_knowledge_candidate_outbox` | contextStill candidate batch delivery | unique producer principal + endpoint + contract version + idempotency key、batch payload digest、attempt、next attempt、last error |
| `security_knowledge_candidate_receipts` | batch/item acknowledgement | outbox FK、receipt ref、per-item status |
| `security_knowledge_feedback_outbox` | contextStill feedback batch delivery | candidate outboxとは別scopeのunique producer principal + endpoint + contract version + idempotency key、batch digest、bounded retry |
| `security_knowledge_feedback_receipts` | feedback batch acknowledgement | outbox FK、receipt ref、per-event status |

Implementation placement:

- schema: `api/db/security-intelligence-schema.ts`
- bootstrap: `api/db/security-intelligence-schema-bootstrap.ts`
- export / startup registration: `api/db/schema.ts`、既存bootstrap composition
- migration: 実装開始時点のlatest migration番号を再確認し、Drizzle migrationを生成する
- domain schema / application command / query / repository: `shared/schemas/security-intelligence*.ts`、`api/modules/securityIntelligence/`
- existing scan start connection: `api/modules/securityScan/security-scan.routes.ts`とprovider client。post phaseではRunからserver-sideでTask workspaceを解決するapplication commandを追加し、request pathを受け取らない。
- Run snapshot connection: `api/modules/nightworkers/run-orchestration/start-task-run-*.ts`と既存`evidence_subject_snapshots`
- final judgment connection: `api/modules/codingAgent/runtime/shared/contracts.ts`、native / Codex各laneのstructured result adapter、`api/modules/nightworkers/run-orchestration/runtime-execution.ts`のterminal publish前closeout
- Mission Pilot connection: `api/composition/mission-pilot`または`src/composition/mission-pilot`のhost port implementation
- Coding Agent connection: `api/modules/codingAgent`の既存runtime context / final judgment adapter。全Coding Agent Runで同じcontractを使う。

Migration policy:

- existing settings bindingを削除しない。
- 不足するprojectRef / sourceRevision / targetDigestをrepository pathや現在HEADから推測して埋めない。
- migration後に作られたscanだけをv2 eligibleとする。
- history queryはv2 rowを優先し、legacy rowは`legacy_unverifiable`表示に限定する。
- migration failure時に既存Security Scan v1が使用不能にならない順序で導入する。
- migration番号はこの計画へ固定しない。他作業のmigrationと衝突しない番号を実装開始時に採る。

### 6.2 contextStill

既存candidate pipelineを正本として再利用する。

- PostgreSQL: `src/modules/registerCandidate/register-candidate.service.ts`の現行pipelineを基準にする。
- TypeScript SQLite: direct `upsertKnowledgeFromSource(status: "active")`を削除し、SQLiteの`distillation_target_states`、`find_candidate_results`、`finding_candidate_queue`へtransactionalにenqueueする。
- Rust native SQLite: `crates/context-stilld/src/domains/mcp_lifecycle/native_knowledge.rs`のdirect `knowledge_items(status = 'active')` insertを削除し、同じlogical candidate rowsとqueue eventをtransactionalに作る。
- finalize: 現行`src/modules/finalizeDistille/domain.ts`の`status: "draft"`を維持する。
- candidate ingress receipt / idempotency tableとfeedback ingress receipt / append-only event tableは、PostgreSQL schema、TypeScript SQLite core schema、Rust SQLite writer schemaのすべてへ追加する。
- logical nameは`security_candidate_batch_receipts` / `security_candidate_batch_items`、`security_feedback_batch_receipts` / `security_feedback_events`とし、3 backendで同じkey、status、reason codeを持つ。物理命名差が必要な場合もfixture projectionは同一にする。

既存のdirect-active data:

- `metadata.sqliteDirectRegistration`または`metadata.rustDirectRegistration`で識別できる既存rowを自動demoteしない。
- read-only audit commandで件数、source、statusを確認可能にする。
- Security Intelligence pilotでは、独立validationを受けていない既存direct-active rowをcandidate promotion成功例へ数えない。
- data correctionが必要と判断された場合は、この実装とは別の承認済みmigration planに分ける。

### 6.3 vulnWorkbench post-workspace grant

- `nightworkers_workspace_target_grants`をSecurity Intelligence integration moduleが所有し、integration client、provider project、workspace subject ref、canonical workspace path、Git common directory digest、expected HEAD、provider-captured workspace state digest、expiry、consumed stateを保存する。
- canonical workspace pathはscan実行に必要なprovider-side短命secretとして扱い、response、audit detail、telemetry、assessment、reportへ出さない。expiryまたはterminal scanへのbinding後にcleanup対象とし、cleanup失敗をscan結果へ影響させない。
- grant createとconsumeはrevision / state CASを使う。期限切れ、別client、別Project、別Git common directory、workspace drift、異なるrequestでの二重consumeをrejectし、同じidempotency replayは同じscanへ収束させる。
- migration / bootstrap failure時はworkspace grant featureだけをOFFにし、既存Security Scan v1と既存assessment endpointを維持する。

## 7. Integration transport and security

### 7.1 vulnWorkbench -> NightWorkers

- 既存HTTPS / loopback HTTP integration transport、service token、scope、resource bindingを再利用する。
- assessment / binding proof endpointは既存のdefault OFF、project allowlist、response byte limit、owner / scan bindingを維持する。
- Security Intelligence専用capabilities endpointを同じversion rootへ追加し、contract version、assessment kinds、payload上限、feature availabilityを返す。
- capabilitiesは`http_service`、`local_cli`など対応transportを明示する。Tranche Aでは既存HTTP(S) integration routeをassessment取得の対象とし、NightWorkersの`local_cli` scanはSecurity Intelligence assessment `unavailable`とする。通常のlocal CLI scanは維持し、receiptやconditionを暗黙生成しない。
- local CLI assessment対応を追加する場合は、local scan recordとvulnWorkbench persisted scanのidentity差を解決する独立version contract / work packageを必要とし、本計画では推測adapterを作らない。
- project identityは既存Security Scan capabilitiesの`project.ref`を正本とし、NightWorkersがpathからopaque refを生成しない。
- post workspace targetは5.3の短命grantを使用する。grant create / preview / startは既存integration clientのowner、allowed root、rate limitへ加えてsame Git common directory、expected HEAD、provider-captured workspace state、expiryをserver側で検証する。
- capabilities、binding proof、assessmentは既存scan read scope、grant create / grant-based startはscan write scopeを要求する。grantRefをbearer credentialとして扱わず、すべてintegration token認証とresource authorizationを再実行する。
- assessment fetchはserver-side adapterだけが行い、LLM-visible arbitrary URL toolを追加しない。

### 7.2 NightWorkers -> contextStill

- primary bridgeはversioned JSONを受ける専用local HTTP endpointとし、MCP mutation toolはcross-product bridgeにしない。
- endpoint例: `POST /api/integrations/security-intelligence/v1/candidate-batches`。
- feedback endpointは`POST /api/integrations/security-intelligence/v1/feedback-batches`とし、candidate ingressと別のscopeを要求する。
- scope名はcandidateを`security-intelligence:candidates:write`、feedbackを`security-intelligence:feedback:write`として固定し、token principal、scope、endpointをauditへ残す。token値は残さない。
- `api/app.ts`のAPI認証をcentral dispatcherへ整理し、public health、Security Intelligence integration path、general admin APIを明示分岐する。integration pathではpath / scope限定token、その他の`/api/*`では既存admin keyを要求し、どのpathも認証middlewareの外へ置かない。
- admin keyをintegration tokenとして再利用せず、integration token未設定時はrouteをfail closedの`unavailable`とする。admin key未設定時の既存development behaviorをintegration routeへ継承しない。
- integration route以外で同tokenをadmin API keyとして使えないことをnegative testで固定する。
- server起動時のhostnameを明示し、既定を`127.0.0.1`とする。`localhost`というlog表示だけをloopback保証にしない。external bindは明示configがあり、既存production security policyに従うTLS reverse proxyが確認できる場合だけ許可し、起動時validationを行う。
- request byte limit、timeout、rate limit、idempotency、stable error codeをserver側で強制する。
- contextStill CLIは同じapplication serviceへJSON stdinで接続できるthin adapterとして用意し、fixture testとoperator smokeに使う。
- NightWorkersのtokenはserver-side secretとして保持し、Task本文、prompt snapshot、telemetry、outbox payloadへ含めない。

## 8. Failure semantics

| Condition | NightWorkers behavior | Completion effect | Retry |
| --- | --- | --- | --- |
| Security Intelligence feature未設定 | 通常scan / Runを維持し、利用していないものをfailure表示しない | explicit conditionがなければ影響なし | なし |
| capability unavailable | source limitationを記録する | explicit conditionがあればrole側評価へ渡す | retryable transportだけ |
| assessment not ready | receiptを作らず、typed statusを保持する | explicit conditionがあれば未評価としてrole側へ渡す | producer hintを上限内で利用 |
| assessment unavailable / inconclusive | successへ畳み込まず、reason / limitationを保持する | explicit conditionがなければ固定gateにしない。あればrole側がneeds-human / blocked等を判断する | retryable codeだけ |
| workspace target grant unavailable / expired / drifted | post scanを開始せずattemptへtyped reasonを保存する | pre assessmentをpost evidenceへ代用しない。explicit conditionがあればrole側評価へ渡す | transportだけbounded retry。expiry / driftは新grantを明示要求 |
| wrong project / revision / digest | payloadをTask / Runへ関連付けずintegrity incidentにする | complete evidenceとして使用不可 | 自動retryしない |
| post assessment workspace / Evidence Subject mismatch | receipt自体はrepository-level履歴として保持できるがpost subject bindingを作らない | current Run evidenceとして使用不可 | 自動retryしない。新しいauthoritative workspace snapshotで明示rerun |
| Contract head / condition revision CAS conflict | 競合rowをcurrentにせず、最新headとtyped conflictを返す | old snapshotでの新規judgmentを受理しない | transport retryしない。LLMまたはUserが最新snapshotを再取得して再提案 |
| final judgment schema / condition set mismatch | terminal publish前にrejectし、返された本文とinvalid structured payloadを監査用に保持する | semantic judgment未完了 | 同じruntime laneへbounded continuation。本文から補完しない |
| contextStill unavailable | outboxをpending / failedにし、Task / scan resultを維持する | 影響なし | bounded exponential backoff |
| candidate item rejected | item receiptとreasonを保存する | 影響なし | validation errorはretryしない |
| outbox key conflict | dead-letter相当のintegrity failureとしてoperatorへ表示する | 影響なし | 自動retryしない |
| feedback item rejected / unavailable | append-only feedback outbox / receiptに保存し、Knowledge statusを変更しない | 影響なし | transportだけbounded retry、validationはretryしない |
| LLM unavailable / invalid | deterministic assessment、Contractの旧version、evidenceを保持する | 新しいsemantic judgmentだけ未完了にする | provider policyに従う |

Retry共通規則:

- 一時的かつ明示的にretryableなtransport / provider failureだけを対象とする。
- attempt上限、next attempt、last error、手動停止、再開commandを持つ。
- schema error、auth failure、revision mismatch、idempotency conflictをretryしない。
- retry後も元payloadとidempotency keyを変更しない。

## 9. Work packages and merge order

既存vulnWorkbench PR 1からPR 4との混同を避けるため、この計画のwork packageは`SI-*`で識別する。

### SI-00: Contract freeze and participant fixtures

Repositories: all three

Changes:

1. 5.1のidentity mapping tableをmachine-readable fixtureにし、raw / namespaced project ref、raw / namespaced scan ref、raw / prefixed digest、base / assessed revision role、full target unsupported caseを3 repositoryへ配置する。
2. vulnWorkbenchの既存Security Intelligence v1 positive / negative fixtureとcanonical digestをbaselineとして固定し、start response + binding proof + assessment bundleの三者fixture、およびNightWorkersの独立consumer schema / verification testを追加する。
3. post workspace grantのsame / different Git common directory、HEAD / state drift、expiry、idempotent consume fixtureをvulnWorkbenchとNightWorkersへ配置する。
4. Security Knowledge Candidate Batch v1とreceipt v1のwire fixtureをNightWorkersとcontextStillへ配置する。
5. assessment contractにはwrong project、wrong revision role、wrong digest、absolute pathを、candidate contractにはsecret-like value、evidenceなし、batch digest mismatch、item digest mismatch、idempotency key reuse with different payloadをnegative fixtureとして固定する。
6. fixture syncはruntime code copyではなく、versioned JSON + digest verification scriptで行う。関係しないproductへcontract全体のconsumerを追加しない。

Merge gate:

- assessment fixtureをvulnWorkbench producer testとNightWorkers consumer testが同じ意味で解釈する。
- candidate batch fixtureをNightWorkers producer testとcontextStill consumer testが同じ意味で解釈する。
- 3 repositoryが共通identity / redaction fixtureを同じsemantic reason categoryで解釈する。
- working-tree startのbase revisionとassessmentのassessed revisionを直接比較するconsumerが存在しない。
- 既存Security Scan v1 fixture hashが変わらない。
- failure taxonomyとpayload上限が確定する。

### SI-VW-01: Producer capability and binding proof completion

Repository: vulnWorkbench

Depends on: SI-00

Changes:

1. 既存Security Intelligence route rootへread-only capabilities endpointを追加する。
2. existing integration auth、scope、default OFF flag、project allowlist、no-store headerを再利用する。
3. assessment routeとexisting scan v1 responseを変更しない。
4. capability responseへsupported transport、supported target kind、identity mapping version、response byte上限を追加する。
5. `GET .../scans/:scanRunRef/binding-proof`を追加し、scanのpersisted bindingから5.1のraw / canonical identity、base / assessed revision、digestを返す。assessmentと同じauthorization、owner / project binding、payload limitを適用する。

Merge gate:

- flag OFF時にavailabilityを誤advertiseしない。
- unauthorized / wrong scope / response size testが通る。
- `full`または`local_cli`を未対応のままavailableとadvertiseしない。
- start response、binding proof、assessment fixtureの三者でidentity mapping golden vectorが成立し、wrong owner / project / scanではproofを返さない。
- 既存producer contract fixtureとassessment endpoint regressionが通る。

Rollback:

- producer Security Intelligence flagをOFF。既存scan v1は維持する。

### SI-VW-02: Authenticated post-workspace target grant

Repository: vulnWorkbench

Depends on: SI-00, SI-VW-01

Changes:

1. 5.3のgrant create、grant-based preview / start endpointとstrict schemaをSecurity Intelligence route rootへ追加する。
2. integration client owner / allowed root、canonical path / symlink、registered provider ProjectとのGit common directory、expected HEAD、provider-captured workspace state、expiryを検証する。
3. provider-side短命grant repositoryとcleanupを追加し、既存scan executor / persisted scan bindingへ同じprovider Project IDで接続する。worktreeを別Projectとしてauto-createしない。
4. capability responseへworkspace target grant availability、TTL、request / response上限を追加する。

Merge gate:

- 同じGit common directoryの登録済みTask worktreeだけが元のprovider Projectへbindingされる。
- 別repository、symlink escape、wrong owner、expired grant、state drift、異なるrequestでの二重consumeをscan作成前にrejectし、同じstart replayではscanが重複しない。
- response、audit detail、telemetry、assessment fixtureにworkspace absolute pathが出ない。
- flag OFFでgrant routeはunavailableとなり、既存scan v1 / assessment routeにobservable regressionがない。

Rollback:

- workspace target grant flagをOFFにする。pre assessmentと既存Security Scan v1は維持する。

### SI-NW-01: Durable scan binding

Repository: NightWorkers

Depends on: SI-00

Changes:

1. `security_scan_bindings` schema、bootstrap、migration、repositoryを追加する。
2. capabilitiesで得たprovider project ref、identity mapping version、preview/startで得たresolved targetとsource revision roleを一つのtransactional bindingへ保存する。
3. settings binding read/writeをv2正本から外し、legacy read-only fallbackにする。
4. target identity mismatch、duplicate scan ref with different digest、legacy bindingのnegative testsを追加する。

Merge gate:

- 新規scanはprojectRef + scanRunRef + sourceRevisionRole + sourceRevision + targetDigestで一意に再読できる。
- working-tree bindingは`sourceRevisionRole = base_revision`、full bindingは`sourceRevisionRole = snapshot_revision`となり、roleなしのrevisionを保存しない。
- restart後もbindingが残る。
- legacy bindingをassessmentへ使わない。
- v1 scan start / history / status workflowが非破壊である。

Rollback:

- consumer未接続のため新table書込だけを停止できる。既存settings historyは残す。

### SI-NW-02: Assessment consumer and receipt

Repository: NightWorkers

Depends on: SI-00, SI-VW-01, SI-NW-01

Changes:

1. Security Intelligence capabilities / binding proof / assessment clientを`api/modules/securityScan`のprovider adapterから分離したagent-neutral integration moduleへ追加する。
2. response byte limit後にstrict parseし、5.1のidentity adapterでstart binding、producer binding proof、assessment bundleのsemantic exact matchを検証する。
3. immutable assessment receiptを保存する。
4. Repository / scan detailでassessment ref、coverage、unknown、limitationをsource別に表示可能なprojectionを追加する。Task / Run表示はsubject binding追加後のSI-NW-03で行う。
5. default OFF consumer flagとempty project allowlistを追加する。

Merge gate:

- producer fixtureをNightWorkersがstrict parseできる。
- raw UUID / namespaced ref、raw / prefixed digest、base / assessed revision fixtureを正しく正規化し、mapping version不明時はfail closedする。
- binding proofなし、proof digest mismatch、start / proof / assessment三者のいずれかのmismatchではreceiptを作らない。
- wrong project / scan / revision / digestはreceiptを作らない。
- unavailable / inconclusive / unknownをsuccess表示しない。
- flag OFFで通常Runと既存Security Scanにobservable regressionがない。

Pilot gate:

- `vulnWorkbench/spec/security-intelligence-pr4-nightworkers-pilot-plan.md`の1-pair smokeとrollback drillを実行する。
- integrity STOP条件が0件の場合だけ10件以上のpaired sampleへ進む。

### SI-NW-03: Pre/post subject binding, Security Contract, and Run integration

Repository: NightWorkers

Depends on: SI-NW-02, SI-VW-02

Changes:

1. Assessment Attempt / Subject Binding、Security Contract、Contract head、completion condition、application command / query、immutable repositoryを追加する。
2. pre assessmentをTask Revision Snapshotへbindingする。post assessmentは両runtime lane共通のagent-neutral commandで明示要求し、Runからserver-side解決したTask workspaceのcanonical Evidence Subject Snapshotを作成または再利用してscanした後、そのsnapshotへbindingする。LLM / clientからworkspace pathを受け取らない。
3. User UI、Mission Pilot host adapter、Coding Agent direct Run adapterを同じContract / condition commandへ接続し、Contract updateをhead CASで直列化する。
4. standard Run context snapshotへbounded Contract、pre / post assessment subject binding refs、current condition setを追加する。
5. compaction後もContract ref、adopted condition refs、unknown、実行済みverification refsを保持し、正本を再取得可能にする。
6. `RuntimeLaneResult`と両runtime laneへ5.6のstructured final judgmentを追加し、同じsubmission application serviceへ接続する。
7. final judgment保存とevent appendをterminal status publish前に行い、closeoutはcondition欠落、CAS conflict、stale / foreign evidenceだけを構造的に拒否する。
8. Task / Run detailへpre / post attempt、subject binding、coverage、unknown、limitation、final judgmentをphase別に表示する。

Merge gate:

- User直結RunとMission Pilot handoff Runで同じContract schema、同じapplication command、同じCoding Agent runtime contextを使う。
- pre bindingはTask Revision Snapshot、post bindingは同じRunのEvidence Subject SnapshotへFKし、repository rootで取得したreceiptをworktreeのpost evidenceに流用できない。
- post scan中にworkspace stateがdriftしたcaseではsubject bindingとfinal judgment evidence associationを作らず、typed conflictになる。
- source changeありのpilot Runはpost assessmentまたはtyped unavailable resultを持ち、pre receiptだけでpost verification済みと表示しない。
- pre receiptの存在だけではpost commandをhostが自動実行せず、同commandがdirect / handoff Runの両laneで同じ結果を返す。
- 同時Contract更新の一方だけがhead CASに成功し、他方は最新headを含むtyped conflictになる。
- Todo更新後に旧`todoRevision` / `todoPlanRevision`由来conditionをcurrentとして提出できない。
- native API laneとCodex laneの両方が同じfinal judgment schemaを返し、terminal publish前に保存される。
- provenanceを変えてもtool contract、completion policy、runtime laneが変わらない。
- condition refなしのRunにSecurity固有completion gateが増えない。
- condition refありのRunではfinal judgmentから当該conditionを欠落できない。
- hostがFeature Plan本文またはresult本文の語句からconditionを生成しない。

### SI-CS-01: Candidate lifecycle parity

Repository: contextStill

Can run after: SI-00

Changes:

1. TypeScript SQLite `registerCandidate`を既存candidate pipeline enqueueへ変更する。
2. Rust native `register_candidates`を同じlogical pipeline enqueueへ変更する。
3. PostgreSQL、TypeScript SQLite、Rust nativeのcontract testを同じfixture tableで実行する。
4. `candidate_registered`の意味を「pipelineへ永続化済み」とし、Knowledge active化ではないことをtool descriptionとresponseで一致させる。
5. existing direct-active rowのread-only audit commandを追加する。

Merge gate:

- 3 backend / runtimeで登録直後に`knowledge_items.status = active`のrowが作られない。
- enqueue transaction失敗時にpartial candidate / active Knowledgeが残らない。
- finalize後もinitial Knowledge statusは`draft`である。
- embedding serviceが停止していてもcandidate受領自体は成立し、後段failureとして観測できる。

Rollback:

- old direct-active behaviorへ戻すのではなく、candidate registrationを停止して既存retrievalだけを維持する。

### SI-CS-02: Authenticated candidate batch ingress

Repository: contextStill

Depends on: SI-00, SI-CS-01

Changes:

1. strict batch / receipt schema、canonical digest helper、5.7のpartial item transactionを実装するapplication serviceを追加する。
2. central auth dispatcher、scoped integration auth、explicit loopback bind、HTTP route、CLI JSON adapterを追加する。
3. idempotency receipt、item validation result、audit logをPostgreSQL / SQLiteへ保存する。
4. accepted itemを既存candidate pipelineへenqueueする。

Merge gate:

- integration tokenはcandidate batch routeにだけ使える。
- same key / same digest replayは同じreceiptを返す。
- same key / different digest、secret、absolute path、evidenceなし、oversizeをrejectする。
- top-level rejectではmutationが0件、item rejectではvalid itemと全item receiptが同一transactionでcommitされる。
- integration tokenはgeneral admin APIへ使えず、admin keyはintegration routeの代用にならず、token未設定時はfail closedする。
- default listenerが実際にloopbackへbindし、external bindの起動validationが通らない構成ではserverを開始しない。
- accepted itemがactive Knowledgeとして検索されない。
- service restart後もreceiptとdedupeが維持される。

### SI-NW-04: LLM-proposed candidate outbox

Repository: NightWorkers

Depends on: SI-NW-03, SI-CS-02

Changes:

1. Security Contract final evaluation後、role側LLMまたはhumanがstructured candidate batch proposalを同じagent-neutral commandへ渡せるようにする。
2. hostによるfinding textのkeyword抽出や自動candidate生成は行わない。
3. application serviceはstrict semantic proposalからitem / batch digestとbatch refを算出し、command ref由来のidempotency keyを付与する。LLMがdigestやidempotency結果を自己申告しない。
4. proposalとoutbox rowをtransactionalに保存する。
5. dispatcherはbounded retryとreceipt保存を行う。
6. Task / Run detailへpending / delivered / partial / rejected / dead-letterを表示する。

Merge gate:

- Task / scan completion成功だけでcandidateが自動生成されない。
- LLM-only claimでevidence refがないproposalはschemaで受理されない。
- contextStill停止中もTask / scanの確定結果が維持される。
- delivery receipt前にregistered / active表示しない。
- retryでcandidateが重複しない。

### SI-INT-00: Feedback contract freeze and ingress

Repositories: NightWorkers, contextStill

Can run after: SI-00, SI-CS-01

Changes:

1. 5.8のfeedback batch / receipt、canonical digest、event taxonomy、byte limitを両repositoryのversioned fixtureで固定する。
2. contextStillへcandidate ingressと別scopeのHTTP / CLI adapterを追加し、append-only feedback eventとreceiptをPostgreSQL / TypeScript SQLite / Rust SQLiteへ保存する。
3. NightWorkersへcandidate outboxと別のfeedback outbox / dispatcher / receipt repositoryを追加する。
4. retrieved、selected、actually used、verification outcome、User overrideを各正本eventから明示的に生成し、LLM本文からkeyword抽出しない。
5. application serviceがevent / batch ref、digest、idempotency keyを正本event refから決定的に算出し、callerによるdigest自己申告を信頼しない。

Merge gate:

- same key / same digest replay、same key / different digest conflict、restart後dedupeが両repositoryで一致する。
- `verification_outcome`、`false_warning`、`harm_signal`はevidenceまたはUser操作refなしでは受理されない。
- feedback受領でKnowledge本文、status、promotion stateが変化しない。
- feedback failureがTask、Run、scan、candidate receiptを巻き戻さない。
- candidate tokenとfeedback token / scopeの相互利用をrejectする。

### SI-INT-01: Retrieval shadow and outcome feedback

Repositories: NightWorkers, contextStill

Depends on: SI-NW-04, SI-INT-00

Changes:

1. Security-related context compilationでcandidate / draftを実行指示へ混ぜず、shadow retrievalとして記録する。
2. SI-INT-00で固定したcontractを用い、retrieved、selected、actually used、verification outcome、user override、false warning、harm signalを別eventとして記録する。
3. feedback送信はcandidateとは別のoutbox + idempotencyを使う。
4. LLM self-verdictだけをKnowledge usefulnessのground truthにしない。

Merge gate:

- shadow itemがCoding Agentのconstraintやverification省略へ影響しない。
- harmful / irrelevant retrievalを計測できる。
- feedback failureがTask / scan resultを巻き戻さない。
- promotionは本work packageに含めない。

### SI-PILOT-01: Stage 2 / Stage 3 decision

Repositories: all three

Depends on: first SI-NW-02, then SI-NW-03; Stage 3 decisionはSI-INT-00、SI-NW-04、SI-INT-01後

Execution:

1. 1 repository / 1 Task Revision Snapshotでpre assessment、1 Run / Evidence Subjectでpost assessmentを取得し、wrong-target / wrong-subject testとrollback drillを実行する。
2. 10件以上のvalid pre/post pairでbaselineとassessment-enabled Runを比較する。preだけ、postだけ、typed unavailableも除外せず記録する。
3. Stage 2のGO後に限り、1 batchのcandidate ingress、duplicate replay、contextStill停止を試す。
4. feedback contract smokeとして1 batchのretrieved / selected / actually-used / verification outcomeを送り、duplicate replayとscope rejectionを確認する。
5. Stage 3 shadow sampleを集め、dated GO / ITERATE / STOP recordを作る。

default ONはこのwork packageの成果に含めない。別decisionとactivation PRを必要とする。

## 10. Dependency graph

```text
SI-00
  ├─> SI-VW-01 ─┬─> SI-VW-02 ─────────────────────────────┐
  │              └────────────────┐                        │
  ├─> SI-NW-01 ───────────────────┴─> SI-NW-02 ───────────┴─> SI-NW-03
  └─> SI-CS-01 ─┬─> SI-CS-02
                └─> SI-INT-00

SI-NW-03 ─┐
SI-CS-02 ─┴─> SI-NW-04 ─┐
SI-INT-00 ───────────────┴─> SI-INT-01
```

Parallelization:

- SI-VW-01、SI-NW-01、SI-CS-01はSI-00 fixture確定後に並行実装できる。SI-VW-02はSI-VW-01 capability schemaを待つ。
- SI-NW-02はproducer capabilityとdurable bindingの両方を待つ。
- SI-NW-03はassessment receiptのidentityとpost workspace grant contractが固定されてから実装する。
- SI-CS-02はcandidate lifecycle parityを先に満たす。
- SI-NW-04はStage 2 integrity pilotとcontextStill ingressの双方を待つ。
- SI-INT-00はSI-00とcandidate lifecycle parity後にSI-NW-03 / SI-NW-04と並行できるが、SI-INT-01はfeedback ingress / outboxの両側mergeを待つ。

## 11. Verification plan

実装PRごとにfocused test、typecheck、architecture check、migration smokeを実行し、期待結果と失敗時の停止条件をPR descriptionへ記録する。

### 11.1 vulnWorkbench

```bash
bun test api/modules/integrations/nightworkers api/modules/security-intelligence api/app/env.test.ts
bunx vitest run shared/schemas/nightworkers-security-intelligence.schema.test.ts shared/schemas/nightworkers-security-intelligence-pilot.schema.test.ts
bunx vitest run shared/schemas/nightworkers-security-scan-integration.schema.test.ts shared/schemas/security-intelligence-assessment.schema.test.ts
bun run verify:security-intelligence-contract
bun run typecheck
git diff --check
```

追加必須case:

- capability flag OFF / ON
- capability target / transport support (`working_tree` HTTP available、`full` / `local_cli` unavailable)
- wrong auth scope
- assessment endpoint contract non-regression
- existing Security Scan v1 fixture hash non-regression
- working-tree fixtureでbase revision、assessed revision、raw / prefixed digestがそれぞれ正しいroleに固定される
- workspace target grantのsame Git common directory successと、wrong repository / owner / symlink / expiry / state drift / double consume rejection
- grant create / preview / startのresponse、audit、telemetryにabsolute workspace pathがない
- grant table migration / restart / expiry cleanupと、cleanup failure時の既存scan result不変

### 11.2 NightWorkers

```bash
node scripts/run-vitest.mjs run <security-intelligence focused tests>
bun run typecheck
bun run check:architecture
bun run check:docs
git diff --check
```

追加必須case:

- fresh database migration / bootstrap parity
- restart後のscan binding、receipt、pre / post subject binding、Contract head、candidate / feedback outbox再読
- legacy settings bindingはunverifiable
- wrong project / revision role / target digest / bundle digest / Evidence Subject rejection
- raw / namespaced ref、raw / prefixed digestのidentity mapping parityとunknown mapping version rejection
- pre receiptをpost evidenceへ流用できず、post scan pathがRunのworkspace authorityからだけ解決される
- post command same request digest replayでscan / receiptが重複せず、workspace state変更後は旧attemptを再利用しない
- Contract同時更新CAS、stale head conflict、同一親からのcurrent successor分岐防止
- stale Todo revision / Todo plan revision condition rejection
- User操作 / Mission Pilot操作が同じapplication command結果になる
- direct Coding Agent Run / handoff Runが同じContract snapshotを受け取る
- provenance差でruntime / tool contract / completion behaviorが変わらない
- explicit conditionなしではSecurity completion gateなし
- explicit conditionありではcondition result欠落をreject
- native API / Codex両laneの同一structured final judgment、invalid judgment continuation、terminal publish前persist
- unavailable / inconclusive / unknown rendering
- contextStill timeout、retryable / non-retryable、dead-letter、replay

### 11.3 contextStill

実際のpackage scriptとtest pathは着手時に再確認し、最低限次を行う。

```bash
bunx vitest run <register-candidate and integration focused tests>
bun test <sqlite candidate lifecycle tests>
cargo test -p context-stilld register_candidates
bun run typecheck
git diff --check
```

追加必須case:

- PostgreSQL / TypeScript SQLite / Rust native同一fixture parity
- candidate受領直後にactive Knowledgeが0件
- finalize後のdraft
- embedding unavailable時のcandidate durability
- scoped token cannot access general admin API
- admin key cannot access integration route、candidate token cannot access feedback route、token未設定fail closed
- explicit loopback bindとexternal bind startup rejection
- idempotent replay / conflict
- batch digest / item digest verification、partial rejectionのtransaction semantics、DB failure全rollback
- candidate fingerprint / ref、feedback event refの再計算不一致reject
- secret / absolute path / oversize / evidenceなしreject
- restart後dedupe
- feedback event parity、evidenceなしverification outcome / harm signal reject、feedbackでKnowledge status不変

SQLite integration suiteでembedding daemonを必要とするtestは、daemon prerequisiteを明示して実行する。candidate受領test自体はembedding availabilityへ依存させない。

### 11.4 Cross-repository contract verification

各repositoryのCIで、取り込んだfixtureのversionとSHA-256を検証する。fixture更新順は次の通り。

1. assessment contractはvulnWorkbenchで新version fixtureを追加し、NightWorkers consumerがacceptしてからproducer outputを切り替える。
2. candidate batch contractはNightWorkersで新version fixtureを追加し、contextStill consumerがacceptしてからdispatcher outputを切り替える。
3. feedback batch contractはNightWorkersで新version fixtureを追加し、contextStill consumerがacceptしてからdispatcher outputを切り替える。
4. 共通identity / revision role / redaction fixtureは3 repositoryがacceptしてから各wire contractへ適用する。
5. canonical digest helperは各repositoryの独立実装に同じgolden vectorを通し、runtime packageをcross-product共有しない。
6. 関係しないproductへcontract全体のruntime parserを追加しない。
7. 旧version削除は別計画とする。

## 12. Rollout and rollback

### Rollout controls

- vulnWorkbench Security Intelligence endpoint: default OFF、project allowlist empty
- vulnWorkbench workspace target grant: default OFF、project allowlist empty、short TTL
- NightWorkers assessment consumer: default OFF、repository allowlist empty
- NightWorkers post assessment command: default OFF、repository allowlist empty
- contextStill candidate ingress: default OFF、scoped token未設定ならunavailable
- NightWorkers candidate dispatcher: default OFF
- contextStill feedback ingress: default OFF、candidateとは別scope
- NightWorkers feedback dispatcher: default OFF
- retrieval: shadow only

これらはdeployment rollout flagであり、Taskのcompletion activation stateではない。

### Rollout order

1. contract fixturesだけをmergeする。
2. contextStill candidate lifecycle parityをmergeする。ingressはOFF。
3. vulnWorkbench capability / binding proof / workspace target grantとNightWorkers durable binding / consumerをmergeする。consumerとworkspace grantはOFF。
4. 1 repositoryだけallowlistへ追加し、Task Revision Snapshotへpre assessment smokeを行う。
5. SI-NW-03をdefault OFFのままmergeし、同じTaskの1 Runで明示post command、workspace grant、Evidence Subject binding、Contract / condition / final judgment、rollback drillを両runtime laneで確認する。
6. 10件以上のpre / post paired pilot後、Stage 2 decisionを作る。
7. contextStill candidate ingressとNightWorkers candidate dispatcherを1 project / 1 batchで有効にする。
8. feedback ingress / dispatcherを1 project / 1 batchで有効にし、scope、replay、Knowledge status不変を確認する。
9. Stage 3 shadow sample後、別decisionを作る。

### Rollback order

1. NightWorkers feedback dispatcherをOFFにする。
2. contextStill feedback ingressをOFFにする。
3. NightWorkers candidate dispatcherをOFFにする。
4. contextStill candidate ingressをOFFにする。
5. NightWorkers post assessment commandをOFFにする。
6. vulnWorkbench workspace target grantをOFFにする。
7. NightWorkers assessment consumerをOFFにする。
8. vulnWorkbench Security Intelligence endpointをOFFにする。

Rollback後も次を保持する。

- 既存Security Scan v1
- Task / Runの既存実行機能
- 受領済みassessment receipt、attempt / subject binding、Contract / condition / final judgment audit history
- pending / failed outboxとreceipt
- expired / consumed workspace grantのprivacy-safe audit metadata。canonical workspace pathはretention policyに従いcleanupする
- contextStillの既存validated Knowledge

## 13. STOP conditions

次のいずれかが1件でも発生した場合、そのstageのrolloutを停止し、flagをOFFにする。

- identity mapping versionまたはrevision roleを誤り、wrong project、wrong revision、wrong target digestへassessmentを関連付けた。
- pre receiptをpost evidenceとして、または別Run / workspace / Evidence Subjectのreceiptをcurrent evidenceとして関連付けた。
- workspace target grantが別Git common directory、別provider Project、expired / drifted workspaceでscanを作成した。
- assessment内のclaim / verification evidence refを同じpayloadのbounded evidence recordまたは許可されたproducer artifact refへ解決できない。
- secret、credential、source本文、absolute private pathがassessment / candidate / feedback response、durable cross-product payload、prompt、telemetryへ漏れた。既存scan v1 requestと5.3のauthenticated短命grant request以外でpathを送った。
- unavailable / inconclusive / unknownをverified successとして表示した。
- explicit conditionのないRunへSecurity固有gateを追加した。
- stale Contract head、旧Todo revision、欠落conditionを含むfinal judgmentを保存した、またはjudgment保存前にRun terminal statusをpublishした。
- provenanceだけを理由にUser / Mission Pilot / Coding Agentのruntime、tool、completion処理を変えた。
- contextStill candidate ingressがactive Knowledgeを直接作った。
- idempotency replayでcandidate / feedback eventが重複した、または異なるbatch payloadを同一receiptとして受理した。
- candidate / feedbackのpartial item transactionでreceiptとenqueue / event rowが不一致になった。
- candidate / feedback failureがTaskまたはscanの確定結果を巻き戻した。
- 既存Security Scan v1または通常Coding Agent Runに重大regressionを起こした。

## 14. Stage exit criteria

### Stage 0 complete

- 3 repositoryが同じidentity / revision role / digest / redaction primitivesを解釈し、assessmentとcandidate batchの各producer / consumer pairが対応するfailure / receipt semanticsをfixtureで解釈する。
- existing behavior / cost / coverage baselineが保存される。
- wrong project / revision / secret fixtureが全consumerでrejectされる。

### Stage 1 complete

- dependency changeとauthorization guard changeについて、producerが既存evidenceから説明可能なassessmentを返す。
- NightWorkersがそのassessmentをexact targetへbindingできる。
- working-treeのbase revisionとassessed revisionを別roleとして保持し、未対応full / local CLIをavailable表示しない。
- existing scan / task completionが非劣化である。

### Stage 2 complete

- pre assessmentがTask Revision Snapshotへ、post assessmentが同じRunのcanonical Evidence Subject Snapshotへbindingされ、Security Contractのconstraintが実装後verificationとevidenceまでtraceできる。
- post scanがshort-lived workspace target grantで同じprovider Projectへ結合され、別Project auto-create、path leak、workspace driftが0件である。
- Contract headとcompletion condition source revisionがCASで固定され、stale Contract / Todoからcurrent judgmentを作れない。
- direct Runとhandoff Runが同じContract / runtime contractを使う。
- explicit completion conditionの有無が構造化され、hostが本文から推測しない。
- conditionなしの通常Runを固定gateで止めない。
- native API / Codex両laneが同じstructured final judgmentをterminal publish前に保存する。
- 1-pair smoke、10件以上のpaired pilot、rollback drillが完了する。

### Stage 3 complete

- contextStillの全初期backend / runtimeでcandidateが自動active化されない。
- candidateとfeedbackの各outbox、idempotency、receipt、dedupeがrestartを跨いで安定する。
- harmful / irrelevant retrievalとoutcome feedbackを測定できる。
- feedbackがappend-only observationとして保存され、Knowledge本文、status、promotion stateを直接変更しない。
- automatic active promotion、verification省略、policy緩和が存在しない。

## 15. Implementation Definition of Done

本計画の「実行できる状態」は、Stage 3 completeまでを意味する。ただし実装承認は次の二つに分割できる。

- Tranche A: SI-00からSI-NW-03とStage 2 pilot。identity-normalized pre / post assessment + Evidence Subject binding + CAS付きSecurity Contract + structured completion traceを成立させる。
- Tranche B: SI-CS-01、SI-CS-02、SI-NW-04、SI-INT-00、SI-INT-01とStage 3 pilot。candidate + append-only feedback shadow loopを成立させる。

Tranche AのGOなしにTranche BのNightWorkers dispatcherを有効化しない。Tranche Bが未承認またはSTOPでも、Tranche Aのassessment / Contract loopは独立して利用できる。

## 16. Approval checkpoints

実装開始前にこの文書で次を確認する。

1. Stage 2までを第一trancheとし、preはTask Revision Snapshot、postはRun / Evidence Subjectへbindingする順序。
2. Security Scan v1とSecurity Intelligence v1のidentity / revision role mappingをSI-00 fixtureで固定し、既存strict v1 responseを変更しない方式。
3. Tranche Aのassessment transportはHTTP(S)とし、local CLI / full targetを誤advertiseせず、対応追加は別version work packageとする方式。
4. post scanはsame Git common directoryを検証する短命workspace target grantで元provider Projectへ結合し、Task worktreeを別Projectとしてauto-createしない方式。
5. Security Contractにactivation enumを持たせず、採用済みcompletion conditionから参照し、Contract head / Todo revisionをCASで固定する方式。
6. structured final judgmentを両runtime laneから同じcommandへ提出し、terminal publish前に保存する方式。
7. 既存settings bindingを推測backfillせず、legacy unverifiableとして残す方式。
8. Candidate Batchのbatch / item digestとpartial item transaction semantics。
9. contextStillのTypeScript SQLite / Rust native direct-active経路を先に修正する方式。
10. contextStill mutationをscoped local HTTP JSON + CLI adapterで実装し、MCPをbridgeにせず、candidate / feedback scopeを分離する方式。
11. default OFFを維持し、pre / post 1-pair smoke、10-pair pilot、dated decisionを経て次stageへ進む方式。

code実装後もrolloutを一括で有効化しない。各packageのmerge gateとSTOP conditionを満たした証跡を確認してから、依存する次stageのflagを有効化する。

## 17. Implementation record

記録日: 2026-08-15

### 17.1 Work package status

| Work package | Status | Implemented result |
| --- | --- | --- |
| SI-00 | Implemented | 3 repositoryでidentity / revision role fixtureとSHA-256を固定し、NightWorkers / contextStillでcandidate・feedback fixtureのschema、item / batch digestを検証する。working-tree assessed revisionは`working-tree/<digest>`へ統一した。 |
| SI-VW-01 | Implemented, default OFF | Security Intelligence capabilityとbinding proofを追加し、working-tree HTTPだけをadvertiseする。既存Security Scan v1 fixtureは変更しない。 |
| SI-VW-02 | Implemented, default OFF | same Git common directory、owner、HEAD、expiry、state drift、single consumeを検証する短命workspace target grant、migration、restart cleanupを追加した。 |
| SI-NW-01 | Implemented | provider project、scan ref、revision role、source revision、target digestを持つdurable binding、migration / bootstrap、legacy read-only fallbackを追加した。通常scanではconsumer flagとallowlistが一致しない限り追加provider callを行わない。 |
| SI-NW-02 | Implemented, default OFF | bounded response、strict parse、start / proof / assessment三者検証、immutable receipt、repository / scan projectionを追加した。 |
| SI-NW-03 | Implemented, default OFF | pre / post attempt・subject binding、workspace grant post scan、Security Contract / condition head CAS、両runtime lane共通tool、Task Operator command、Run context、evidence-bound Final Judgment、terminal publish前gateを追加した。conditionなしのRunはgate対象外である。 |
| SI-CS-01 | Implemented | PostgreSQL、TypeScript SQLite、Rust native SQLiteをcandidate pipelineへ揃え、ingress直後のactive Knowledge作成を廃止した。 |
| SI-CS-02 | Implemented, default OFF | candidate専用HTTP / CLI ingress、candidate scope token、loopback default、external bind guard、batch / item digest、partial receipt、idempotent replayを追加した。 |
| SI-NW-04 | Implemented, default OFF | candidate durable outbox、strict receipt、bounded exponential retry、dead-letter、restart dispatcher、Run projectionを追加した。 |
| SI-INT-00 | Implemented, default OFF | candidateとは別schema / token / tableを持つappend-only feedback ingressとoutboxを追加した。feedbackはKnowledge本文、status、promotion stateを変更しない。 |
| SI-INT-01 | Implemented as shadow | structured Security Contract contextがある場合だけcandidate / draftのrefをshadow取得し、通常compile pack / markdownへ混入させず、retrieved eventをfeedback outboxへ記録する。本文keyword分類は行わない。 |
| SI-PILOT-01 | Pending deployment evidence | 1-pair smoke、両runtime lane rollback drill、10-pair sample、Stage 3 shadow sample、dated decisionは実環境producer / consumerを有効化して別途実施する。 |

### 17.2 Rollout state

- vulnWorkbench Security Intelligence endpointとworkspace grantはdefault OFF、project allowlist emptyを維持する。
- NightWorkers assessment consumer、candidate exporter、feedback exporterは個別flagでdefault OFFを維持する。
- contextStill candidate ingressとfeedback ingressは個別flag・個別tokenでdefault OFFを維持する。
- contextStillのSecurity Intelligence retrievalはshadow metadataだけを返し、validated active Knowledgeの通常retrievalを変更しない。
- SI-PILOT-01の証跡がないため、14節のStage 2 complete / Stage 3 completeは未達として扱う。

### 17.3 Verification evidence

- vulnWorkbench: Security Intelligence / NightWorkers integration focused test 168件（534 assertions）、contract verifier、app / scripts typecheckを通過した。
- NightWorkers: cross-repository fixture、runtime lane parity、Task Operator action schema、bootstrap table、outbox default OFF / strict receipt / retry分類、既存Security Scan routeを含むfocused testを通過した。typecheckとmodule / role boundary checksを通過した。
- contextStill: fixture / scoped auth test 6件、SQLite candidate / feedback ingress 6件（21 assertions）、TypeScript typecheck、Rust native candidate lifecycle 25件を通過した。
- repository全体の`check:architecture`は、本変更外で既に作業中の`run-project-exploration-paired-pilot.ts`と`SettingsLlmPanel.tsx`が600行上限を超えているためlarge-file checkだけ未通過である。本変更で上限を超えた既存fileは分割し、Security Intelligence追加fileはすべて600行以下にした。large-file以外のmodule、Mission Pilot、SystemContext、Coding Agent、Task Operator、ontology boundary checkは通過した。

### 17.4 Post-implementation review hardening

実装後の再レビューでは、正常系の追加ではなく、同時実行、再送、境界不整合、運用時の失敗を中心に再検査し、次を補強した。

- NightWorkersのoutbox dispatcherはresponseを512 KiBでstreaming制限し、redirect時にBearer tokenを転送せず、非成功response bodyを解放する。receiptはbatch refだけでなくcandidate / eventの完全な集合、区分の排他性、永続target ref、既存receiptとのcanonical一致まで検証する。
- assessment attempt、scan binding、subject binding、assessment / outbox receiptはinsert競合後に正本rowを再読し、同時retryで異なる内容を同一idempotency結果として返さない。成功済みoutboxを並行failureが上書きしない。
- post assessmentはconsumerとは独立したdefault OFF flagを持つ。無変更workspaceは`not_applicable`、provider未到達はtyped `unavailable`とし、設定復旧後の明示rerunを旧unavailable結果へ固定しない。grant作成、preview、scan開始をadditive migrationで永続checkpoint化し、restart後は同じrequest digestとprovider idempotency keyで再開する。checkpointは`grant_created`、`previewed`、`started`の順にだけ進み、同時retryの古い書込みで後退しない。retryableなprovider 409 / 422は固定failureへ変換せず、明示rerun可能な`unavailable`として保持する。
- Task OperatorはSecurity Intelligence内部repositoryやDBへ直接依存せず、role moduleのpublic application surfaceだけを利用する。
- contextStillのPostgreSQL / SQLite ingressは同時receipt作成とcandidate fingerprintを直列化する。duplicate candidateでは新しいevidence provenanceをitem rowへappendし、削除済みtargetへのstale refを返さず新しいpipeline targetを作る。
- contextStill ingressはprincipal、固定scope、endpoint、batch / receipt refを同じtransactionのauditへ保存し、token値やsource本文を保存しない。body size、byte単位top-level制約、rate limit、request timeoutをserver側で強制する。
- candidate / feedback receipt schemaは成功itemのdurable target ref、candidate ref一意性、feedback event refの区分横断一意性をproducer / consumer双方で強制する。

再レビュー後のfocused verificationでは、NightWorkers Security Intelligence / migration 6 files / 42 tests、contextStill ingress 9 tests（31 assertions）とfixture / auth 10 tests、Rust native candidate 25 tests、SQLite schema migration 7 tests、vulnWorkbench integration 8 files / 46 tests（187 assertions）が通過した。3 repositoryすべてでTypeScript typecheckが通過し、共有fixtureはJSON正規化後に一致する。SI-PILOT-01は引き続きdeployment evidence待ちであり、このcode reviewをpilot完了証跡として扱わない。
