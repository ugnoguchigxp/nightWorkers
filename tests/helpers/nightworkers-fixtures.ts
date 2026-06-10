import type {
  ActivityArtifact,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
} from '../../src/modules/nightworkers/types';

const defaultTimestamp = '2026-06-02T00:00:00.000Z';

export function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    repositoryId: '22222222-2222-4222-8222-222222222222',
    title: 'NightWorkers task',
    description: 'Implement the requested change',
    objective: 'Complete the task',
    acceptanceCriteria: 'The relevant tests pass',
    status: 'draft',
    compiledPrompt: null,
    timeoutSeconds: 3600,
    priority: 0,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
    ...overrides,
  };
}

export function buildTaskRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    taskId: '11111111-1111-4111-8111-111111111111',
    repositoryId: '22222222-2222-4222-8222-222222222222',
    status: 'running',
    workerKind: 'native-local',
    timeoutSeconds: 3600,
    contextSnapshot: null,
    summary: null,
    finalReport: null,
    finalJudgment: null,
    startedAt: defaultTimestamp,
    endedAt: null,
    finishedAt: null,
    logContent: null,
    diffPatch: null,
    testResults: null,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
    ...overrides,
  };
}

export function buildTaskMessage(overrides: Partial<TaskMessage> = {}): TaskMessage {
  return {
    id: 'message-1',
    taskId: '11111111-1111-4111-8111-111111111111',
    runId: null,
    role: 'assistant',
    content: 'Message',
    messageType: 'text',
    metadataJson: null,
    createdAt: defaultTimestamp,
    ...overrides,
  };
}

export function buildBlueprintMessage(overrides: Partial<TaskMessage> = {}): TaskMessage {
  return buildTaskMessage({
    id: 'message-blueprint-1',
    content: '# App Blueprint',
    messageType: 'markdown_document',
    metadataJson: {
      intent: 'app_blueprint',
      appBlueprint: { id: 'blueprint-1', name: 'Blueprint', screens: [] },
    },
    ...overrides,
  });
}

export function buildTaskEvent(overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    id: 'event-1',
    taskRunId: '33333333-3333-4333-8333-333333333333',
    runId: '33333333-3333-4333-8333-333333333333',
    seq: 1,
    type: 'checkpoint',
    actor: 'system',
    eventType: 'system.info',
    message: 'Event',
    payloadJson: {},
    timestamp: defaultTimestamp,
    createdAt: defaultTimestamp,
    ...overrides,
  };
}

export function buildActivityArtifact(overrides: Partial<ActivityArtifact> = {}): ActivityArtifact {
  return {
    id: 'artifact-1',
    taskId: '11111111-1111-4111-8111-111111111111',
    runId: null,
    kind: 'app_blueprint',
    path: null,
    contentText: null,
    metadataJson: null,
    createdAt: defaultTimestamp,
    ...overrides,
  };
}
