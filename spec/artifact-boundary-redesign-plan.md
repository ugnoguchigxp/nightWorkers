# Artifact Boundary Redesign Plan

## Problem

Blueprint preview が raw JSON message に落ちる不具合は、単一 parser の問題だけではない。
現状は `task_messages.content` / `task_messages.message_type` / `task_messages.metadata_json` が、少なくとも次の用途を同時に背負っている。

- Chat transcript の本文。
- Artifact の永続データ。
- Artifact preview の入力。
- Activity replay のイベント復元元。
- Timeline 上の artifact card 表示条件。
- Planning evidence / readiness 判定。

そのため、LLM 出力の shape、metadata の欠落、replay payload の差分、UI の表示条件のどれかが少し壊れると、artifact と chat の両方に波及する。

## Current Evidence

- `api/modules/nightworkers/nightworkers.repository.ts::createTaskMessage(...)`
  - task message を保存した直後に activity event を作る。
  - `messageType === "markdown_document"` かつ `metadataJson.intent === "app_blueprint"` かつ `metadataJson.appBlueprint` のとき、activity artifact も同時作成する。
  - realtime も同じ message を publish する。
- `src/modules/nightworkers/workbenchSelectors.ts::buildWorkbenchArtifactRefs(...)`
  - `task_messages` の `messageType` と `metadataJson` から workspace / artifact refs を復元する。
  - Blueprint / DB Design / implementation plan / spec の分類が message metadata に依存している。
- `src/modules/nightworkers/components/ArtifactWorkspaceViewer.tsx`
  - preview に使う Blueprint を `taskMessages[].metadataJson.appBlueprint` から探す。
  - API の specification workspace と message-derived state を同時に扱う。
- `src/modules/nightworkers/components/ThreadTimelineMessagePayload.tsx`
  - chat timeline card も `messageType === "markdown_document"` と `metadataJson.appBlueprint` で artifact と判断する。
- `src/modules/nightworkers/components/ThreadTimeline.tsx::isUserVisibleChatMessage(...)`
  - raw diagnostic を chat から隠す判断も message metadata に依存する。

## Target Contract

Artifact を primary data とし、chat message は artifact を指す projection にする。

### Artifact Record

Artifact の canonical source は dedicated artifact record に寄せる。

Required fields:

- `id`
- `taskId`
- `runId`
- `kind`
- `status`: `draft | valid | invalid | superseded`
- `title`
- `contentJson`
- `contentText`
- `schemaName`
- `schemaVersion`
- `validationJson`
- `generationJson`
- `sourceJson`
- `createdMessageId`
- `createdAt`

`activity_artifacts` を拡張するか、新しい `task_artifacts` を作る。既存の `activity_artifacts` は replay/event ledger 用の投影として残す方が安全。

### Chat Projection

Chat 側は artifact 本体を持たない。

Message metadata should contain:

- `intent`: `artifact_created | artifact_failed | artifact_updated`
- `artifactRef`: `{ artifactId, kind, version? }`
- `display`: `{ title, summary, cardKind }`
- `diagnosticRef?`: raw output / parse error を別に辿るための参照

Chat `content` は人間向けの短い表示文だけにする。
Blueprint JSON や schema payload を chat content に入れない。

### Preview Input

Preview は `artifactId` から artifact record を読む。

- `ArtifactPane` / `BlueprintPreview` は `message.metadataJson.appBlueprint` を primary input にしない。
- realtime で message が来た場合も、message の `artifactRef` から artifact を fetch する。
- optimistic UI が必要なら、message payload ではなく artifact snapshot payload を別 event として流す。

### Replay Input

Replay は実行再現ではなく、保存済み artifact/event ledger を再投影する。

- Artifact created event は `artifactId` を持つ。
- Timeline は event/message から `artifactRef` を読んで card を表示する。
- Artifact content は artifact record から読む。

## Generation Flow

1. LLM provider returns raw output.
2. Provider boundary extracts JSON only and returns raw + parsed candidate.
3. Artifact service validates and normalizes into `AppBlueprint`.
4. Artifact service writes canonical artifact record.
5. Activity ledger writes `artifact.created` event with `artifactId`.
6. Chat service writes projection message with `artifactRef`.
7. UI receives message/event and opens/fetches artifact by `artifactId`.

Failure flow:

1. Raw output and parse/validation error are stored as diagnostic record, not visible chat content.
2. Chat projection says artifact creation failed and links diagnostic only in debug/admin surfaces.
3. No preview is attempted without valid artifact record.

## Migration Steps

### Phase 1: Introduce Read Model Without Removing Existing Messages

- Add an `ArtifactRef` resolver that prefers artifact records and falls back to legacy `task_messages.metadataJson`.
- Move `isBlueprintArtifactMessage` / `isBlueprintDbDesignArtifactMessage` into a shared artifact classifier module.
- Add typed helpers:
  - `createBlueprintArtifact(...)`
  - `createArtifactProjectionMessage(...)`
  - `resolveArtifactForPreview(...)`

### Phase 2: Write Artifact First

- Change Blueprint generation paths to call `createBlueprintArtifact(...)` first.
- Create chat projection messages with `artifactRef` only.
- Keep legacy `metadataJson.appBlueprint` during migration, but mark it as compatibility-only.

### Phase 3: Preview Reads Artifact

- Update `ArtifactPane`, `ArtifactWorkspaceViewer`, and `BlueprintPreview` entry points to load by `artifactId`.
- Keep legacy message fallback for old data.
- Add tests that prove preview works when chat message has no embedded `appBlueprint`.

### Phase 4: Replay Reads Artifact

- Make `activity_artifacts` / artifact records the source for replay artifact content.
- Timeline reconstructs artifact cards from `artifactRef`, not embedded payload.
- Add replay tests for old and new shapes.

### Phase 5: Remove Embedded Payload Dependency

- Stop writing full Blueprint JSON into chat message metadata.
- Keep only `artifactRef` and display summary.
- Retain raw diagnostics outside normal user-visible timeline.

## Guardrails

- Provider/parser compatibility belongs only in artifact parsing services.
- UI must not repair LLM JSON.
- Chat timeline must not infer artifact content from raw JSON text.
- Artifact preview must not depend on user-visible message content.
- Failure diagnostics must be observable, but not regular assistant messages.
- Planning/readiness checks must depend on artifact existence, not assistant prose.

## Verification Matrix

- Blueprint created from Workbench appears as chat card and preview opens.
- Blueprint created from Questionnaire Status appears in Specification Workspace.
- Chat projection without embedded `appBlueprint` still opens preview by `artifactId`.
- Legacy `markdown_document` messages with embedded `metadataJson.appBlueprint` still render.
- Raw invalid JSON creates failure projection and diagnostic record, not a preview.
- Activity replay reconstructs artifact card and preview from artifact record.
- Planning readiness prefers adopted artifact records over newer projection messages.

## Open Decisions

- Use a new `task_artifacts` table or make `activity_artifacts` canonical.
  - Recommended: add `task_artifacts`; keep `activity_artifacts` as ledger projection.
- Whether artifact versioning is needed immediately.
  - Recommended: include `version` now, even if only `1`.
- Whether DB Design remains encoded as `app_blueprint` with `dbDesignTarget`.
  - Recommended: give DB Design its own `kind` and schema name in the artifact record.
