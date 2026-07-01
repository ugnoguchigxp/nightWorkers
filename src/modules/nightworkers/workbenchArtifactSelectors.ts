import type {
  ActivityArtifact,
  ReviewResult,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  TaskRunTodo,
  WorkbenchArtifactContext,
  WorkbenchArtifactKind,
  WorkbenchArtifactRef,
} from './types';
import { isRecord, taskMessageMetadata, toMs } from './workbenchSelectorUtils';

export function activityArtifactToTaskMessage(artifact: ActivityArtifact): TaskMessage {
  const metadata = activityArtifactMetadata(artifact);
  const appBlueprint = metadata.appBlueprint || parseArtifactContentJson(artifact.contentText);
  return {
    id: `artifact-${artifact.id}`,
    taskId: artifact.taskId,
    runId: artifact.runId || null,
    role: 'assistant',
    content: artifact.contentText || '',
    messageType: 'markdown_document',
    metadataJson: {
      ...metadata,
      intent: metadata.intent || 'app_blueprint',
      artifactRef: { artifactId: artifact.id, kind: 'app_blueprint', version: 1 },
      appBlueprint,
    },
    createdAt: artifact.createdAt,
  };
}

export function mergeWorkspaceTaskMessages({
  taskMessages,
  activityArtifacts,
  generatedMessages,
}: {
  taskMessages: TaskMessage[];
  activityArtifacts: ActivityArtifact[];
  generatedMessages: TaskMessage[];
}) {
  const existingMessageIds = new Set(taskMessages.map((message) => message.id));
  const existingArtifactIds = new Set(
    taskMessages.map(taskMessageArtifactId).filter((id): id is string => Boolean(id))
  );
  const syntheticArtifactMessages = activityArtifacts
    .filter(
      (artifact) => artifact.kind === 'app_blueprint' && !existingArtifactIds.has(artifact.id)
    )
    .map(activityArtifactToTaskMessage)
    .filter((message) => !existingMessageIds.has(message.id));
  const nextIds = new Set([
    ...existingMessageIds,
    ...syntheticArtifactMessages.map((message) => message.id),
  ]);
  return [
    ...taskMessages,
    ...syntheticArtifactMessages,
    ...generatedMessages.filter((message) => !nextIds.has(message.id)),
  ];
}

export function isReviewedSpecificationMessage(message: TaskMessage) {
  const metadata = taskMessageMetadata(message);
  return (
    message.messageType === 'markdown_document' &&
    (String(metadata.intent) === 'feature_plan' || String(metadata.intent) === 'draft_spec') &&
    String(metadata.source) === 'status_document_review' &&
    typeof metadata.reviewedSourceMessageId === 'string'
  );
}

export function isNormalBlueprintMessage(message: TaskMessage): boolean {
  const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
  return (
    message.messageType === 'markdown_document' &&
    hasAppBlueprintMetadata(metadata) &&
    !isDataModelMessage(message)
  );
}

export function isDataModelMessage(message: TaskMessage): boolean {
  const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
  return message.messageType === 'markdown_document' && isDataModelMetadata(metadata);
}

export function buildBlueprintArtifactRef(message: TaskMessage): WorkbenchArtifactRef {
  const metadata = taskMessageMetadata(message);
  const blueprint = isRecord(metadata.appBlueprint) ? metadata.appBlueprint : {};
  const display = isRecord(metadata.display) ? metadata.display : {};
  const artifactRef = isRecord(metadata.artifactRef) ? metadata.artifactRef : {};
  const title = String(blueprint.name || display.title || metadata.title || 'App Blueprint');
  const artifactId = artifactRef.artifactId;
  return {
    id: typeof artifactId === 'string' ? `artifact-${artifactId}` : `message-${message.id}`,
    taskId: message.taskId,
    runId: message.runId || undefined,
    kind: 'app_blueprint',
    title: `Blueprint: ${title}`,
    summary: String(display.summary || message.content.slice(0, 160)),
    source:
      typeof artifactId === 'string'
        ? { type: 'artifact_row', artifactId }
        : { type: 'task_message', messageId: message.id },
    createdAt: String(message.createdAt),
    metadata,
  };
}

export function buildQuestionnaireWorkspaceArtifactRef(
  message: TaskMessage,
  initialTab: 'questionnaire' | 'status' = 'questionnaire'
): WorkbenchArtifactRef {
  return {
    id: `blueprint-workspace-${message.taskId}`,
    taskId: message.taskId,
    runId: message.runId || undefined,
    kind: 'blueprint_workspace',
    title: 'Specification Workspace',
    summary: message.content.slice(0, 160),
    source: { type: 'task_message', messageId: message.id },
    createdAt: String(message.createdAt),
    metadata: {
      specificationSource: 'design_questionnaire_ready',
      questionnaireSessionId: taskMessageMetadata(message).questionnaireSessionId,
      initialTab,
    },
  };
}

export function buildArtifactContext(
  artifact: WorkbenchArtifactRef | null,
  activeSessionId: string | null
): WorkbenchArtifactContext | null {
  if (!artifact || artifact.taskId !== activeSessionId) return null;
  const metadata = artifact.metadata || {};
  const appBlueprint = isRecord(metadata.appBlueprint) ? metadata.appBlueprint : {};
  const screens = Array.isArray(appBlueprint.screens) ? appBlueprint.screens : [];
  const screenNames = screens
    .map((screen) => (isRecord(screen) ? screen : null))
    .filter(isRecord)
    .map((screen) => String(screen.name || screen.id || ''))
    .filter(Boolean)
    .slice(0, 6);
  const sectionNames = screens
    .flatMap((screen) => {
      const record = isRecord(screen) ? screen : {};
      return Array.isArray(record.sections) ? record.sections : [];
    })
    .map((section) => (isRecord(section) ? section : null))
    .filter(isRecord)
    .map((section) =>
      String(section.name || section.title || section.componentName || section.id || '')
    )
    .filter(Boolean)
    .slice(0, 10);
  const databaseSchema = isRecord(appBlueprint.databaseSchema) ? appBlueprint.databaseSchema : {};
  const tables = Array.isArray(databaseSchema.tables) ? databaseSchema.tables : [];
  const tableNames = tables
    .map((table) => (isRecord(table) ? table : null))
    .filter(isRecord)
    .map((table) => String(table.label || table.name || ''))
    .filter(Boolean)
    .slice(0, 10);
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    source: artifact.source,
    metadata: {
      intent: typeof metadata.intent === 'string' ? metadata.intent : undefined,
      artifactType: typeof metadata.artifactType === 'string' ? metadata.artifactType : undefined,
      appBlueprintName: String(appBlueprint.name || appBlueprint.id || '') || undefined,
      screenNames: screenNames.length ? screenNames : undefined,
      sectionNames: sectionNames.length ? sectionNames : undefined,
      tableNames: tableNames.length ? tableNames : undefined,
      initialTab: typeof metadata.initialTab === 'string' ? metadata.initialTab : undefined,
      blueprintCount:
        typeof metadata.blueprintCount === 'number' ? metadata.blueprintCount : undefined,
    },
  };
}

export function buildWorkbenchArtifactRefs(input: {
  task: Task;
  latestRun?: TaskRun;
  todos?: TaskRunTodo[];
  events?: TaskEvent[];
  reviews?: ReviewResult[];
  messages?: TaskMessage[];
  activityArtifacts?: ActivityArtifact[];
}): WorkbenchArtifactRef[] {
  const refs: WorkbenchArtifactRef[] = [];
  const run = input.latestRun;
  const blueprintArtifactRows = (input.activityArtifacts || []).filter(isBlueprintActivityArtifact);
  const blueprintArtifactMessageIds = new Set(
    blueprintArtifactRows
      .map((artifact) => activityArtifactMetadata(artifact).messageId)
      .filter(
        (messageId): messageId is string => typeof messageId === 'string' && messageId.length > 0
      )
  );
  const blueprintArtifactIds = new Set(blueprintArtifactRows.map((artifact) => artifact.id));
  const blueprintMessages = (input.messages || []).filter(
    (message) =>
      message.messageType === 'markdown_document' &&
      isBlueprintArtifactMessage(message) &&
      !isMessageCoveredByActivityArtifact(
        message,
        blueprintArtifactMessageIds,
        blueprintArtifactIds
      )
  );
  const dataModelMessages = (input.messages || []).filter(
    (message) => message.messageType === 'markdown_document' && isDataModelArtifactMessage(message)
  );
  const decisionReviewMessages = (input.messages || []).filter(
    (message) =>
      message.messageType === 'markdown_document' &&
      String(taskMessageMetadata(message).intent) === 'design_decision_review'
  );
  const implementationPlanMessages = (input.messages || []).filter(
    (message) =>
      message.messageType === 'markdown_document' &&
      (String(taskMessageMetadata(message).intent) === 'implementation_plan' ||
        String(taskMessageMetadata(message).intent) === 'draft_spec')
  );
  if (
    blueprintArtifactRows.length > 0 ||
    blueprintMessages.length > 0 ||
    dataModelMessages.length > 0 ||
    decisionReviewMessages.length > 0 ||
    implementationPlanMessages.length > 0
  ) {
    const latestWorkspaceMessage =
      [
        ...blueprintMessages,
        ...dataModelMessages,
        ...decisionReviewMessages,
        ...implementationPlanMessages,
      ].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))[0] || blueprintMessages.at(-1);
    const latestBlueprintArtifactRow = [...blueprintArtifactRows].sort(
      (a, b) => toMs(b.createdAt) - toMs(a.createdAt)
    )[0];
    const workspaceSource = latestWorkspaceMessage
      ? { type: 'task_message' as const, messageId: latestWorkspaceMessage.id }
      : latestBlueprintArtifactRow
        ? { type: 'artifact_row' as const, artifactId: latestBlueprintArtifactRow.id }
        : { type: 'task_message' as const, messageId: '' };
    refs.push({
      id: `blueprint-workspace-${input.task.id}`,
      taskId: input.task.id,
      kind: 'blueprint_workspace',
      title: 'Specification Workspace',
      summary: [
        `${blueprintArtifactRows.length + blueprintMessages.length} Blueprint artifact${
          blueprintArtifactRows.length + blueprintMessages.length === 1 ? '' : 's'
        }`,
        `${decisionReviewMessages.length} Decision Review${decisionReviewMessages.length === 1 ? '' : 's'}`,
        `${implementationPlanMessages.length} Implementation Plan${implementationPlanMessages.length === 1 ? '' : 's'}`,
      ].join(' · '),
      source: workspaceSource,
      createdAt: String(
        latestWorkspaceMessage?.createdAt ||
          latestBlueprintArtifactRow?.createdAt ||
          input.task.updatedAt
      ),
      metadata: {
        blueprintCount: blueprintArtifactRows.length + blueprintMessages.length,
        dataModelCount: dataModelMessages.length,
        decisionReviewCount: decisionReviewMessages.length,
        implementationPlanCount: implementationPlanMessages.length,
      },
    });
  }
  for (const artifact of blueprintArtifactRows) {
    refs.push(activityArtifactRef(input.task.id, artifact));
  }
  for (const message of input.messages || []) {
    if (message.messageType !== 'markdown_document') continue;
    if (
      isBlueprintArtifactMessage(message) &&
      isMessageCoveredByActivityArtifact(message, blueprintArtifactMessageIds, blueprintArtifactIds)
    ) {
      continue;
    }
    const kind = inferDocumentArtifactKind(message);
    refs.push({
      id: `message-${message.id}`,
      taskId: input.task.id,
      runId: message.runId || undefined,
      kind,
      title: artifactTitleForKind(kind, message),
      summary: message.content.slice(0, 160),
      source: { type: 'task_message', messageId: message.id },
      createdAt: String(message.createdAt),
      metadata: isDataModelArtifactMessage(message)
        ? { ...taskMessageMetadata(message), initialTab: 'data-model' }
        : taskMessageMetadata(message),
    });
  }
  if (run?.diffPatch?.trim())
    refs.push(runFieldRef(input.task.id, run, 'diff', 'Code Diff', 'diffPatch'));
  if (run?.testResults)
    refs.push(runFieldRef(input.task.id, run, 'test_result', 'Test Result', 'testResults'));
  for (const review of input.reviews || []) {
    refs.push({
      id: `review-${review.id}`,
      taskId: input.task.id,
      runId: review.runId,
      kind: 'review_result',
      title: `Review: ${review.verdict}`,
      summary: review.note || review.outcome.summary,
      source: { type: 'review_result', reviewId: review.id },
      createdAt: review.createdAt,
      metadata: { review },
    });
  }
  return refs.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

function activityArtifactRef(taskId: string, artifact: ActivityArtifact): WorkbenchArtifactRef {
  const metadata = activityArtifactMetadata(artifact);
  const appBlueprint = metadata.appBlueprint || parseArtifactContentJson(artifact.contentText);
  const appBlueprintRecord = isRecord(appBlueprint) ? appBlueprint : null;
  const title = String(appBlueprintRecord?.name || metadata.title || 'App Blueprint');
  return {
    id: `artifact-${artifact.id}`,
    taskId,
    runId: artifact.runId || undefined,
    kind: 'app_blueprint',
    title: `Blueprint: ${title}`,
    summary:
      typeof appBlueprintRecord?.description === 'string'
        ? appBlueprintRecord.description
        : (artifact.contentText || '').slice(0, 160),
    source: { type: 'artifact_row', artifactId: artifact.id },
    createdAt: String(artifact.createdAt),
    metadata: {
      ...metadata,
      appBlueprint,
      artifactRef: { artifactId: artifact.id, kind: 'app_blueprint', version: 1 },
    },
  };
}

function isBlueprintActivityArtifact(artifact: ActivityArtifact): boolean {
  const metadata = activityArtifactMetadata(artifact);
  return (
    (artifact.kind === 'app_blueprint' || metadata.schemaName === 'app_blueprint') &&
    !isDataModelMetadata(metadata)
  );
}

function activityArtifactMetadata(artifact: ActivityArtifact): Record<string, unknown> {
  return isRecord(artifact.metadataJson) ? artifact.metadataJson : {};
}

function parseArtifactContentJson(content: string | null | undefined): unknown {
  if (!content?.trim()) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function taskMessageArtifactId(message: TaskMessage): string | null {
  const metadata = taskMessageMetadata(message);
  const artifactRef = isRecord(metadata.artifactRef) ? metadata.artifactRef : null;
  return typeof artifactRef?.artifactId === 'string' ? artifactRef.artifactId : null;
}

function isMessageCoveredByActivityArtifact(
  message: TaskMessage,
  artifactMessageIds: Set<string>,
  artifactIds: Set<string>
): boolean {
  const artifactRef = isRecord(taskMessageMetadata(message).artifactRef)
    ? taskMessageMetadata(message).artifactRef
    : {};
  const artifactId = artifactRef.artifactId;
  return (
    artifactMessageIds.has(message.id) ||
    (typeof artifactId === 'string' && artifactIds.has(artifactId))
  );
}

function runFieldRef(
  taskId: string,
  run: TaskRun,
  kind: WorkbenchArtifactKind,
  title: string,
  field: string
): WorkbenchArtifactRef {
  return {
    id: `run-${run.id}-${field}`,
    taskId,
    runId: run.id,
    kind,
    title,
    source: { type: 'run_field', runId: run.id, field },
    createdAt: String(run.finishedAt || run.updatedAt || run.createdAt),
  };
}

function inferDocumentArtifactKind(message: TaskMessage): WorkbenchArtifactKind {
  const metadata = taskMessageMetadata(message);
  const intent = String(metadata.intent);
  if (isDataModelArtifactMessage(message)) return 'blueprint_workspace';
  if (isBlueprintArtifactMessage(message)) return 'app_blueprint';
  if (intent === 'component_design' || metadata.componentDesign) return 'component_design';
  if (intent === 'design_delta' || metadata.designDelta) return 'design_delta';
  if (intent === 'draft_spec') return 'spec';
  if (intent === 'implementation_plan') return 'implementation_plan';
  return 'spec';
}

function isBlueprintArtifactMessage(message: TaskMessage): boolean {
  return isNormalBlueprintMessage(message);
}

function isDataModelArtifactMessage(message: TaskMessage): boolean {
  return isDataModelMessage(message);
}

function isDataModelMetadata(metadata: Record<string, unknown>): boolean {
  return (
    (metadata.artifactKind === 'plan_mode_dedicated_view' && metadata.view === 'data_model') ||
    metadata.artifactType === 'data_model' ||
    metadata.source === 'data-model'
  );
}

function hasAppBlueprintMetadata(metadata: Record<string, unknown>): boolean {
  return metadata.intent === 'app_blueprint' || Boolean(metadata.appBlueprint);
}

function artifactTitleForKind(kind: WorkbenchArtifactKind, message: TaskMessage): string {
  const metadata = taskMessageMetadata(message);
  const metadataTitle = String(metadata.title || '');
  if (metadataTitle.trim()) {
    if (isDataModelArtifactMessage(message)) return `Data Model: ${metadataTitle}`;
    if (kind === 'blueprint_workspace') return `Specification Workspace: ${metadataTitle}`;
    if (kind === 'app_blueprint') return `Blueprint: ${metadataTitle}`;
    if (kind === 'component_design') return `Component: ${metadataTitle}`;
    if (kind === 'design_delta') return `Design Delta: ${metadataTitle}`;
    if (kind === 'implementation_plan') return metadataTitle;
    if (kind === 'spec' && String(metadata.intent) === 'design_decision_review')
      return metadataTitle;
  }
  if (kind === 'blueprint_workspace') return 'Specification Workspace';
  if (kind === 'app_blueprint') return 'App Blueprint';
  if (kind === 'component_design') return 'Component Design';
  if (kind === 'design_delta') return 'Design Delta';
  if (kind === 'implementation_plan') return 'Implementation Plan';
  return 'Spec';
}
