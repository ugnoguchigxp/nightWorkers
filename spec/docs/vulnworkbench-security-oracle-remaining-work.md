# Security Oracle / Ontology 規模境界 是正計画

## Status

remediation-planned

## 背景

NightWorkers と vulnWorkbench の Security Oracle / Ontology 連携本体は実装済みである。

- vulnWorkbench の正式な外部 entrypoint は
  `bun run oracle:security -- --project-path <repo-root>` である。
- strict JSON schema、stable fingerprint、truncation、blocking fingerprint、exit code 契約は
  vulnWorkbench commit `95d3f06` で確定済みである。
- NightWorkers には strict consumer、Review finding、implementation closeout gate、
  `security_fix` Todo、fingerprint rerun、50,000 LOC判定、Ontology handoff、設定UIが存在する。
- Review / Ontology domain の module 集約も完了済みである。

元計画に含まれていた大規模 domain refactor、CLI契約追加、blocking gate、Todo loop、
Ontology handoffの再実装は行わない。本書は規模境界とProject設定の是正だけを扱う。

## 問題

現行実装は Ontology tool set だけを50,000 source LOCで制限し、Security Oracleは
小規模Projectでも常時実行する。

- settings response は `securityOracle.alwaysEnabled=true` を返す。
- Project設定は `ontologyToolsEnabled` だけを持ち、Security Oracleを無効化できない。
- implementation closeout はProject規模にかかわらずSecurity Oracleを実行する。
- CLI未設定やscanner failureは、小規模Projectでも `needs_human` となり完了を妨げる。
- Review Run の `securityReview` も同じ規模・設定境界を共有していない。

これは「Security / Ontology toolingは大規模Projectだけで有効にし、設定画面から明示的に
ON/OFFできる」という運用境界と一致しない。

## Locked Decisions

1. Security OracleとOntology拡張tool setのeligibility thresholdは、どちらも
   保存済み `sourceEffectiveLines >= 50_000` とする。
2. 50,000 LOC未満、計測不能、計測失敗では、Security OracleとOntologyをともに実効無効とする。
3. Project設定に `securityOracleEnabled` を追加し、`ontologyToolsEnabled` と分けて保存する。
4. 既存Projectとの互換性のため、設定値が存在しない場合のstored defaultは両方 `true` とする。
   ただし実効状態は必ずeligibilityと組み合わせる。
5. Security Oracleが実効無効ならOntologyも実効無効とする。保存済み
   `ontologyToolsEnabled` は保持し、Security Oracleを再度有効にした際に復元できる。
6. Project設定や規模条件で無効な場合は、implementation closeoutをblockしない。
   `needs_human` にせず、明示的なskipped reasonをsnapshot / eventへ残す。
7. eligibilityを満たし、Security Oracleが有効なのにCLIが未設定、timeout、schema invalid、
   inconclusiveとなった場合は、現行どおり `needs_human` とする。
8. Review Runの `securityReview` は強制有効化手段にしない。共通resolverで実効無効なら
   CLIを呼ばず、診断を実行できない理由をReview artifactへ残す。
9. NightWorkersからvulnWorkbenchへ渡す外部入力は `--project-path` のままとし、
   vulnWorkbenchのCLI schemaやDBを変更しない。

## 正本となる状態計算

```ts
const SECURITY_INTELLIGENCE_MIN_SOURCE_LOC = 50_000;

const eligible = measurement.status === "available"
  && measurement.sourceLoc >= SECURITY_INTELLIGENCE_MIN_SOURCE_LOC;

const effectiveSecurityOracleEnabled = eligible
  && settings.securityOracleEnabled;

const effectiveOntologyToolsEnabled = effectiveSecurityOracleEnabled
  && settings.ontologyToolsEnabled;

const toolProfile = effectiveOntologyToolsEnabled
  ? "ontology_extended"
  : "standard";
```

`standard` はSecurity Oracleが常時動くことを意味しない。Ontology専用toolをモデルへ渡さない
通常runtime profileを表す。Security Oracleの実行可否は
`effectiveSecurityOracleEnabled` で別に判定する。

reasonは少なくとも次を区別する。

- `enabled`
- `user_disabled`
- `below_threshold`
- `measurement_unavailable`
- `oracle_disabled`
- `installation_unavailable`

## API / 保存契約

Project設定を次へ更新する。

```ts
type ProjectSecurityIntelligenceSettings = {
  securityOracleEnabled: boolean;
  ontologyToolsEnabled: boolean;
  securityMaxIterations: number;
};
```

設定responseは `alwaysEnabled` を廃止し、stored intentと実効状態を分ける。

```ts
type ProjectSecurityIntelligenceSettingsResponse = {
  settings: ProjectSecurityIntelligenceSettings;
  eligibility: {
    thresholdSourceLoc: 50_000;
    measuredSourceLoc: number | null;
    eligible: boolean;
    scannedAt: string | null;
    reason: "enabled" | "below_threshold" | "measurement_unavailable";
  };
  securityOracle: {
    configured: boolean;
    effectiveEnabled: boolean;
    reason: "enabled" | "user_disabled" | "below_threshold" | "measurement_unavailable" | "installation_unavailable";
  };
  ontology: {
    effectiveEnabled: boolean;
    toolProfile: "standard" | "ontology_extended";
    reason: "enabled" | "user_disabled" | "below_threshold" | "measurement_unavailable" | "oracle_disabled";
  };
};
```

保存先は既存の `repositories.feature_settings.securityIntelligence` を維持する。
JSON columnのため新しいtableは追加しない。旧shape読み取り時は
`securityOracleEnabled=true` を補い、次回保存時に新shapeへ正規化する。

## 実装計画

### Phase 1: 共通eligibility resolverを是正する

対象:

- `shared/schemas/ontology.schema.ts`
- `api/modules/ontology/eligibility/tool-profile.ts`
- `api/modules/ontology/ontology-settings.service.ts`

実施内容:

1. `securityOracleEnabled` と新しいresponse contractをstrict schemaへ追加する。
2. Security OracleとOntologyのstored / eligible / effective stateを1つのresolverで返す。
3. 49,999 / 50,000 / 50,001 LOC、計測不能、各toggle OFFのtable-driven testを追加する。
4. 既存の `ontologyToolsEnabled` / `securityMaxIterations` だけを持つ設定を互換読み取りする。

完了条件:

- 50,000 LOC未満では両機能が実効無効になる。
- 50,000 LOC以上ではSecurity Oracle toggleが優先され、OFFならOntologyも無効になる。
- stored intentとeffective stateが混同されない。

### Phase 2: implementation closeoutとruntime snapshotを統一する

対象:

- `api/modules/nightworkers/run-orchestration/start-task-run.ts`
- `api/modules/nightworkers/run-orchestration/runtime-security-closeout.ts`
- 関連runtime snapshot / event schema

実施内容:

1. run開始時に共通resolverのSecurity Oracle / Ontology状態をsnapshotへ保存する。
2. `effectiveSecurityOracleEnabled=false` では `runSecurityOracleGate` を呼ばない。
3. 無効理由をeventへ保存し、security gate未実行をpassやfailureへ偽装しない。
4. 実効有効時だけ現行のclean / continue / needs_human、`security_fix`、rerunを維持する。
5. Ontology handoffはSecurity Oracle passかつ `ontology_extended` の場合だけ実行する。

完了条件:

- 小規模Projectのimplementation runはCLI未設定でもSecurity Oracleを理由にblockされない。
- eligibleかつ有効なProjectでは、CLI未設定やinconclusiveをpass扱いしない。
- snapshot、prompt、tool exposure、closeout、handoffが同じresolver結果を使用する。

### Phase 3: Settings UIとReview Runを揃える

対象:

- `src/modules/ontology/components/SettingsOntologyPanel.tsx`
- ontology settings command / types / i18n
- `api/modules/review/review-run.service.ts`
- Review artifact / result表示

実施内容:

1. 「Security Oracle 常時ON」表示を削除し、Security Oracle toggleを追加する。
2. threshold未達では両toggleをdisabled表示し、stored intentと実効OFF理由を表示する。
3. Security OracleをOFFにした場合、Ontology toggleのstored値は保持しつつ実効OFFを表示する。
4. `securityReview=true` でも実効無効ならCLIを起動せず、skipped理由をartifactへ保存・表示する。
5. 保存後はserver responseを再取得し、client側でeffective stateを推測しない。

完了条件:

- UI、Settings API、Review Run、implementation runtimeで同じ有効状態が表示・使用される。
- checkboxやclient stateだけでthresholdを迂回できない。

### Phase 4: 回帰検証と文書削除

focused tests:

- eligibility: 49,999 / 50,000 / 50,001、missing、各toggle組合せ
- compatibility: 旧settings shape、Project分離、strict unknown-key rejection
- closeout: ineligible skip、user-disabled skip、eligible clean、action required、CLI unavailable
- Review Run: ineligible / disabledではCLI未実行、eligible / enabledでは既存finding contract維持
- UI: stored / eligible / effective / configuredの表示と保存失敗
- regression: fingerprint rerun、`security_fix` Todo、Ontology handoff、module boundary

代表gate:

```bash
bun run verify
```

完了後、実装と検証結果をコミットし、本書を `spec/archive` へ移さず削除する。

## Out of Scope

- vulnWorkbench CLI契約、scanner profile、fingerprint生成の再設計
- 50,000 LOC threshold自体の再検討
- Review / Ontology moduleの再移設
- Run Control KernelやMission Pilotの変更
- Project repoへの設定ファイル追加
- Security findingの自動修正範囲拡大

## 完了条件

- 50,000 LOC未満または計測不能ではSecurity Oracle / Ontologyが実行されない。
- 50,000 LOC以上ではProject設定からSecurity Oracleを明示的にON/OFFできる。
- Security Oracle OFF時にOntologyが実効有効にならない。
- 無効状態はnon-blocking skip、有効状態の診断失敗は `needs_human` として区別される。
- implementation、Review Run、Settings UI、runtime snapshotが同じresolverを使用する。
- 既存Project設定を破壊せず新shapeへ移行できる。
- actionable finding、fingerprint rerun、`security_fix`、Ontology handoffの既存契約が維持される。
- focused testsと `bun run verify` が成功する。
