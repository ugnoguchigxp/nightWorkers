# vulnWorkbench CLI Security Oracle 連携実装計画

## Status

partially-implemented-superseded-by-remaining-work

## 目的

NightWorkers が生成、修正、検証した Project 成果物を、vulnWorkbench の CLI 診断に渡し、scanner evidence から agent が実行可能な改善依頼を生成し、NightWorkers の修正ループへ戻す。

この連携の主目的は、vulnWorkbench を単なる AppSec UI ではなく、NightWorkers の closeout 前に動く Security Oracle / Security Gate として使うことである。

```text
NightWorkers
  -> implementation / focused verification / repo verify
  -> vulnWorkbench CLI scan
  -> evidence-backed improvement request
  -> NightWorkers Todo 再投入
  -> 修正
  -> repo verify + vulnWorkbench rerun
  -> contextStill knowledge capture
```

## 基本方針

- 連携は CLI を正本にする。NightWorkers から vulnWorkbench の DB や内部 service を直接読まない。
- scanner 実行、DAST、dynamic verification など重い診断は vulnWorkbench CLI が所有する。
- NightWorkers は CLI 結果を run evidence として保存し、改善依頼を Todo / gate / final report に接続する。
- LLM がソースを逐次読んで脆弱性を探す流れにしない。LLM は CLI evidence の review、優先度判断、改善依頼整形、修正実行に限定する。
- provider / llm-provider 層へ security 用 SystemContext や実行判断を分散しない。Supervisor prompt、skill reference、runtime gate、worker tool boundary で扱う。
- 登録済み Project repo root を診断対象にする。一時ディレクトリ、desktop resource directory、provider temp directory を実 workspace として扱わない。
- stdout は machine-readable JSON、stderr は人間向け log という CLI 契約を守る。

## 非目標

- vulnWorkbench を NightWorkers の内部 module として移植しない。
- NightWorkers から Semgrep / Gitleaks / OSV / Trivy / DAST を個別に直叩きしない。
- findings の一覧表示だけを作って完了にしない。
- severity だけで自動 block しない。
- LLM に scanner evidence なしの security review をさせない。
- 初期実装で PR 作成、deploy、複数 agent 並列修正までは含めない。
- contextStill へ未検証の一般論や長大な scan log を保存しない。

## 目標状態

Project の security gate が有効な場合、NightWorkers は `finalize_answer` 前に vulnWorkbench CLI を実行する。

1. CLI scan が clean、または block 条件を満たす改善依頼がなければ finalize できる。
2. block 条件を満たす改善依頼がある場合、`finalize_answer` は tool failure になり、NightWorkers は同じ run 内で security fix Todo を継続する。
3. 修正後は repo-native verify と vulnWorkbench rerun の両方を通す。
4. rerun で同一 finding が解消されるまで、security gate は完了扱いにしない。
5. max iteration、CLI failure、scan prerequisite missing、曖昧な evidence、修正範囲過大の場合は `needs_human` として停止できる。
6. false positive または accepted risk は、evidence、理由、scope、期限または再検証条件付きで記録する。

## 連携モデル

### NightWorkers の責務

- Project repo root、run id、diff summary、実行済み verify evidence を CLI 入力として渡す。
- CLI 実行結果を run event / artifact として保存する。
- Improvement Request を Todo に変換する。
- 修正時は worker tool 経由で Project repo root を編集する。
- 修正後に repo-native verify を優先実行する。
- vulnWorkbench rerun の結果を gate 判定に使う。
- 成功、失敗、false positive、accepted risk を contextStill 登録候補へ整理する。

### vulnWorkbench の責務

- CLI profile に従って scan / reproduction / dynamic / DAST を実行する。
- scanner 生出力を正規化して evidence と finding にする。
- findings を NightWorkers が実行可能な Improvement Request へ変換する。
- rerun で同一 finding の解消、残存、再分類、scanner failure を返す。
- stdout JSON の schema を安定させる。
- secret や認証情報を redaction して出力する。

### contextStill の責務

- 修正成功パターン、false positive 判定基準、allowlist 方針、再発防止条件を知識化する。
- 診断そのものを代替しない。
- 未検証の finding を確定知識として扱わない。

## CLI 契約

初期実装では、NightWorkers から見える vulnWorkbench CLI を次の 4 コマンドに固定する。

### 1. agent-output scan

```bash
vulnworkbench scan agent-output \
  --repo /path/to/project \
  --profile agent-output \
  --nightworkers-run-id <run-id> \
  --changed-files-json /path/to/changed-files.json \
  --verify-evidence-json /path/to/verify-evidence.json \
  --format json
```

目的:

- coding agent が触った成果物を軽量かつ再実行可能に診断する。
- static scan、secret scan、dependency scan、container scan、必要に応じた DAST / dynamic verification を profile で選ぶ。

stdout schema:

```ts
type AgentOutputScanResult = {
  version: 1;
  ok: boolean;
  scanRunId: string;
  profile: 'agent-output';
  repoRoot: string;
  startedAt: string;
  completedAt: string;
  toolRuns: Array<{
    tool: 'semgrep' | 'gitleaks' | 'osv' | 'trivy' | 'dast' | 'dynamic';
    status: 'passed' | 'finding' | 'failed' | 'skipped';
    findingCount: number;
    artifactIds: string[];
    failureKind?: string;
    message?: string;
  }>;
  findings: SecurityFindingSummary[];
  artifacts: Array<{
    id: string;
    kind: 'tool_output' | 'normalized_evidence' | 'scan_log';
    path?: string;
    redacted: boolean;
  }>;
};
```

### 2. improvement request generation

```bash
vulnworkbench improvement-request create \
  --scan-run-id <scan-run-id> \
  --target-agent nightworkers \
  --format json
```

目的:

- finding をそのまま修正命令にせず、NightWorkers が実行可能な改善依頼へ変換する。
- 修正範囲、非目標、受け入れ条件、検証コマンドを固定する。

stdout schema:

```ts
type ImprovementRequestBatch = {
  version: 1;
  ok: boolean;
  scanRunId: string;
  requests: ImprovementRequest[];
  gate: {
    status: 'passed' | 'blocked' | 'needs_human';
    blockingRequestIds: string[];
    message: string;
  };
};

type ImprovementRequest = {
  id: string;
  findingIds: string[];
  title: string;
  risk: string;
  evidence: Array<{
    tool: string;
    file?: string;
    line?: number;
    fingerprint?: string;
    artifactId?: string;
    summary: string;
  }>;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  agentActionability: 'high' | 'medium' | 'low';
  evidenceQuality: 'high' | 'medium' | 'low';
  verificationClarity: 'high' | 'medium' | 'low';
  blastRadius: 'high' | 'medium' | 'low';
  allowedScope: string[];
  nonGoals: string[];
  recommendedFix: string;
  acceptanceCriteria: string[];
  verificationCommands: string[];
  rerunCommand: string;
  falsePositiveHints?: string[];
};
```

### 3. gate evaluation

```bash
vulnworkbench gate evaluate \
  --improvement-requests-json /path/to/improvement-requests.json \
  --policy-json /path/to/nightworkers-security-policy.json \
  --format json
```

目的:

- severity だけでなく、agent actionability、evidence quality、verification clarity を含めて block 判定する。
- NightWorkers 側の設定と vulnWorkbench 側の evidence を同じ JSON 契約で突き合わせる。

初期 block 条件:

```text
block when:
  evidenceQuality >= medium
  AND severity >= medium
  AND agentActionability >= medium
  AND verificationClarity >= medium
```

`critical` / `high` でも evidenceQuality が low の場合は `needs_human` とする。自動修正で破壊範囲が広い場合も `needs_human` とする。

### 4. finding rerun

```bash
vulnworkbench rerun finding \
  --repo /path/to/project \
  --finding-id <finding-id> \
  --previous-scan-run-id <scan-run-id> \
  --format json
```

目的:

- 修正後に同一 finding の状態を確認する。
- scanner failure と finding 残存を区別する。

stdout schema:

```ts
type FindingRerunResult = {
  version: 1;
  ok: boolean;
  findingId: string;
  previousScanRunId: string;
  rerunScanRunId: string;
  status: 'resolved' | 'still_present' | 'changed' | 'not_reproducible' | 'scanner_failed';
  evidence: Array<{
    tool: string;
    artifactId?: string;
    summary: string;
  }>;
  message: string;
};
```

## NightWorkers 実装計画

### Phase 0: ベースライン確認

目的:

- 現在の closeout gate、worker command policy、MCP / hook / runtime evidence path を確認する。
- vulnWorkbench CLI の想定 path、起動方法、JSON stdout 契約、失敗時 exit code を確認する。

作業:

- `finalize_answer` 直前の gate 実行位置を確認する。
- coverage autonomy gate の実装を security gate の参照設計として読む。
- `nightworkers-quality.json` の strict schema 方針を確認する。
- worker command policy に、vulnWorkbench CLI 実行をどう許可するか確認する。
- Run artifact の保存先と event payload の上限を確認する。

完了条件:

- 追加する runtime boundary と設定ファイルが確定している。
- CLI が存在しない場合の graceful failure 方針が決まっている。
- 既存の verify / coverage gate と競合しない実行順が決まっている。

### Phase 1: vulnWorkbench CLI 契約を実装する

対象 repo:

- `/Users/y.noguchi/Code/vulnWorkbench`

作業:

- `scan agent-output` を追加する。
- `improvement-request create` を追加する。
- `gate evaluate` を追加する。
- `rerun finding` を追加する。
- stdout JSON / stderr log の契約をテストする。
- secret redaction と artifact id traceability をテストする。

完了条件:

- 各 CLI が `--format json` で安定 schema を返す。
- scanner failure、finding あり、finding なし、prerequisite missing を区別できる。
- stdout に log noise が混ざらない。
- NightWorkers から CLI だけで scan -> request -> gate -> rerun を再現できる。

検証:

```bash
bun run verify
bun run scan:agent-output -- --repo <fixture-repo> --format json
bun run improvement-request:create -- --scan-run-id <id> --target-agent nightworkers --format json
bun run gate:evaluate -- --improvement-requests-json <file> --policy-json <file> --format json
bun run rerun:finding -- --repo <fixture-repo> --finding-id <id> --format json
```

### Phase 2: NightWorkers security settings を追加する

対象 repo:

- `/Users/y.noguchi/Code/nightWorkers`

設定方針:

- 初期は `nightworkers-quality.json` に `securityGate` を追加する。
- schema は strict にし、unknown key を黙って捨てない。
- malformed config は gate bypass ではなく `needs_human` にする。

設定案:

```ts
type SecurityGateSettings = {
  securityGateEnabled: boolean;
  vulnWorkbenchCommand: string;
  profile: 'agent-output';
  blockMinimumSeverity: 'critical' | 'high' | 'medium' | 'low';
  requireEvidenceQuality: 'high' | 'medium' | 'low';
  requireAgentActionability: 'high' | 'medium' | 'low';
  requireVerificationClarity: 'high' | 'medium' | 'low';
  maxIterations: number;
  timeoutSeconds: number;
};
```

初期値:

```json
{
  "securityGateEnabled": false,
  "vulnWorkbenchCommand": "vulnworkbench",
  "profile": "agent-output",
  "blockMinimumSeverity": "medium",
  "requireEvidenceQuality": "medium",
  "requireAgentActionability": "medium",
  "requireVerificationClarity": "medium",
  "maxIterations": 3,
  "timeoutSeconds": 600
}
```

完了条件:

- Project settings API から読み書きできる。
- UI で ON/OFF と基本 threshold を設定できる。
- config error が run evidence と final report に出る。
- disabled の場合は既存挙動を変えない。

### Phase 3: NightWorkers runtime security gate を追加する

実装方針:

- `finalize_answer` の直前に deterministic gate として実行する。
- coverage gate と同じく、LLM の任意判断ではなく runtime が実行する。
- open Todo は security gate より前に処理する。未完了 Todo がある run では scanner を無駄に回さない。
- repo-native verify は security gate より前に成功していることを要求する。verify 未実行の場合は gate 実行より先に verify Todo を優先する。

想定 module:

```text
api/services/security/vulnworkbench-cli.ts
api/services/security/security-gate.ts
api/services/security/security-gate-report.ts
api/services/settings/security-gate-settings.ts
```

gate result:

```ts
type SecurityGateResult = {
  version: 1;
  status: 'disabled' | 'passed' | 'continue' | 'needs_human';
  allowFinalize: boolean;
  shouldContinue: boolean;
  scanRunId?: string;
  blockingRequestIds: string[];
  improvementRequests: ImprovementRequest[];
  commandResults: Array<{
    command: string;
    ok: boolean;
    exitCode: number;
    stdoutPreview: string;
    stderrPreview: string;
    artifactPath?: string;
  }>;
  message: string;
};
```

完了条件:

- finding なしなら `passed`。
- block 対象ありなら `continue` で `finalize_answer` を失敗させる。
- max iteration 到達、CLI missing、schema invalid、scanner prerequisite missing は `needs_human`。
- gate payload が run event と final report に残る。

### Phase 4: Improvement Request を Todo 再投入に接続する

作業:

- blocking request を `security_fix` taskType の Todo に変換する。
- Todo description には allowed scope、non-goals、acceptance criteria、verification commands、rerun command を含める。
- 複数 request がある場合は、risk と actionability で順序付ける。
- blast radius が high の request は自動修正せず `needs_human` にする。
- 修正後 Todo には repo-native verify と vulnWorkbench rerun を必須 evidence とする。

Todo 例:

```text
title: Security fix: fixture secret を本物の secret と区別可能にする
taskType: security_fix
description:
  evidence: gitleaks finding fingerprint ...
  allowed scope: tests/fixtures/**, .gitleaks.toml
  non-goals: production auth flow は変更しない
  acceptance:
    - 同一 fingerprint が rerun で出ない
    - bun run verify が成功する
    - allowlist は path + fingerprint に限定される
```

完了条件:

- LLM が finding だけを見て自由修正するのではなく、Improvement Request を実行単位にする。
- allowed scope 外の変更がある場合は gate が止まる。
- rerun 成功まで security fix Todo を pass にしない。

### Phase 5: rerun loop を実装する

作業:

- security fix 後に `vulnworkbench rerun finding` を実行する。
- rerun result を request id / finding id と紐付けて保存する。
- `resolved` のみ pass とする。
- `still_present` は同じ Todo を継続する。
- `changed` は新しい Improvement Request を作り直す。
- `not_reproducible` は evidenceQuality に応じて `needs_human` または accepted risk review に回す。
- `scanner_failed` は修正成功扱いにしない。

完了条件:

- 修正が実際に同一 finding を解消したことを CLI evidence で確認できる。
- scanner failure と finding 残存が混ざらない。
- rerun の artifact id が final report に残る。

### Phase 6: contextStill knowledge capture を追加する

作業:

- resolved request から再利用可能な rule / procedure candidate を作る。
- false positive は、判断根拠、scope、再検証条件を含める。
- accepted risk は期限や再評価条件なしで登録しない。
- raw secret、長大な scanner output、未redacted log は送らない。

登録候補の例:

```text
Use when:
Gitleaks が test fixture を secret として検出し、fixture が本物の secret と区別しづらいときに使う。

Workflow:
1. fixture 値を clearly_fake_ prefix に変更する。
2. allowlist が必要な場合は path + fingerprint に限定する。
3. production secret handling は変更しない。
4. gitleaks rerun と repo verify を実行する。

Verification:
- 同一 fingerprint が rerun で出ない。
- repo-native verify が成功する。

Avoid:
- secret pattern 全体を broad allowlist しない。
- production auth flow を fixture 対応のついでに変えない。
```

完了条件:

- 成功した security fix が次回の改善依頼生成に使える粒度で保存される。
- false positive が future scan suppression ではなく、判断基準として保存される。
- 未検証の finding は登録しない。

## 実行順

1. vulnWorkbench CLI 契約を fixture で完成させる。
2. NightWorkers の security settings を disabled default で追加する。
3. NightWorkers runtime gate を disabled / CLI missing / clean scan まで実装する。
4. blocking Improvement Request で `finalize_answer` を止める。
5. security fix Todo 再投入を追加する。
6. rerun loop を追加する。
7. contextStill knowledge capture を追加する。
8. UI 表示と user-facing report を整える。
9. NightWorkers 自身を fixture target にして dogfood する。

## 検証計画

### vulnWorkbench 側

- CLI stdout が JSON だけであること。
- scanner failure と finding を区別できること。
- redaction が効くこと。
- `agent-output` profile が Semgrep / Gitleaks / OSV / Trivy / DAST を必要な範囲で起動できること。
- rerun が同一 finding の解消を判定できること。

### NightWorkers 側

- `securityGateEnabled: false` では既存 closeout が変わらないこと。
- CLI missing は success ではなく `needs_human` evidence になること。
- clean scan は finalize を通すこと。
- blocking request は finalize を止め、Todo 継続へ戻すこと。
- security fix 後に repo-native verify と rerun が両方必要になること。
- malformed `nightworkers-quality.json` は bypass されないこと。
- allowed scope 外の変更がある場合は自動完了しないこと。

### 統合 smoke

```bash
# vulnWorkbench fixture
vulnworkbench scan agent-output --repo <fixture-repo> --profile agent-output --format json
vulnworkbench improvement-request create --scan-run-id <scan-run-id> --target-agent nightworkers --format json
vulnworkbench gate evaluate --improvement-requests-json <file> --policy-json <file> --format json

# NightWorkers
bun run verify:base
bun run verify
```

## Stop Conditions

- CLI schema が安定していない場合、NightWorkers 接続へ進まない。
- stdout に non-JSON log が混ざる場合、NightWorkers 接続へ進まない。
- scanner output の redaction が未確認の場合、改善依頼生成へ進まない。
- NightWorkers の gate が finding と CLI failure を区別できない場合、Todo 再投入へ進まない。
- rerun で同一 finding を追跡できない場合、security fix Todo を pass にしない。
- contextStill に送る candidate が一般論だけになる場合、knowledge capture を実装完了扱いにしない。

## リスクと対策

| リスク | 対策 |
| --- | --- |
| CLI が重く、毎 closeout で開発ループが遅くなる | `agent-output` profile を軽量 default にし、DAST / dynamic は条件付きにする |
| severity high だが evidence が薄い finding で agent が過剰修正する | evidenceQuality / verificationClarity を block 条件に含め、低品質 evidence は `needs_human` にする |
| LLM が scope 外を修正する | Improvement Request に allowedScope / nonGoals を持たせ、diff guard で止める |
| false positive が broad allowlist になる | allowlist は path + fingerprint など限定条件を acceptance criteria に入れる |
| scanner failure が security pass と誤認される | CLI failure は `needs_human` または `continue` にし、pass にしない |
| Project repo が汚れる | scan artifacts は NightWorkers runtime artifact または vulnWorkbench data root に保存し、Project repo には要求された修正以外を書かない |
| provider prompt が肥大化する | scanner raw output ではなく Improvement Request summary と artifact ids だけを渡す |

## レビュー観点

1. CLI 契約が NightWorkers から見て十分に安定しているか。
2. `nightworkers-quality.json` に security settings を同居させる判断が妥当か。分離ファイルにすべきか。
3. block 条件が厳しすぎる、または緩すぎる箇所がないか。
4. `needs_human` と `continue` の境界が運用上分かりやすいか。
5. rerun loop が scanner failure を成功扱いしない設計になっているか。
6. contextStill に保存する知識が、次回の診断と修正に使える形になっているか。

## 最初の実装単位

最初の PR は大きくしない。次の範囲に限定する。

1. vulnWorkbench 側で `scan agent-output` と `improvement-request create` の fixture smoke を作る。
2. NightWorkers 側で disabled default の `securityGate` settings schema を追加する。
3. NightWorkers runtime gate は `disabled` と `CLI missing -> needs_human` まで実装する。

この時点では自動修正再投入までは入れない。CLI 契約、設定保存、gate event の形が安定してから、blocking request、Todo 再投入、rerun loop の順に広げる。
