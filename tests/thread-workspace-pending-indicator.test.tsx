import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ThreadWorkspace } from '../src/modules/nightworkers/components/ThreadWorkspace';

const baseProps = {
  activeSession: null,
  sessionView: null,
  activeProject: null,
  runs: [],
  latestRun: undefined,
  taskMessages: [],
  latestRunEvents: [],
  activityEvents: [],
  activityArtifacts: [],
  activeStreamingResponse: '',
  latestRunTodos: [],
  artifactRefs: [],
  isAgentWorking: false,
  isAgentThinking: false,
  realtimeStatus: 'connected' as const,
  model: 'test-model',
  thinkingDepth: 'medium' as const,
  onModelChange: vi.fn(),
  modelOptions: [],
  onThinkingDepthChange: vi.fn(),
  onSubmitInitialPrompt: vi.fn(),
  onSubmitWorkbenchMessage: vi.fn(),
  onOpenBlueprintArtifact: vi.fn(),
  isBlueprintArtifactOpen: false,
  isBlueprintActionBusy: false,
  onOpenTodoArtifact: vi.fn(),
  isTodoArtifactOpen: false,
  hasTodoArtifact: false,
  onDeleteSession: vi.fn(),
  onQueueSession: vi.fn(),
  onRemoveQueueEntry: vi.fn(),
  onRequeueQueueEntry: vi.fn(),
  onOpenArtifact: vi.fn(),
  isProjectFilesOpen: false,
  onOpenProjectFiles: vi.fn(),
};

describe('ThreadWorkspace pending indicator', () => {
  it('shows the assistant thinking indicator while the first session is still being created', () => {
    const markup = renderToStaticMarkup(
      <ThreadWorkspace {...baseProps} isAgentWorking={true} isAgentThinking={true} />
    );

    expect(markup).toContain('AIが返答を生成中です');
    expect(markup).toContain('nightworkers-thinking-dot');
  });

  it('shows the assistant thinking indicator at the end of an active running session', () => {
    const now = new Date().toISOString();
    const markup = renderToStaticMarkup(
      <ThreadWorkspace
        {...baseProps}
        activeProject={{
          id: 'repo-1',
          name: 'todolist',
          localPath: '/Users/y.noguchi/Code/todolist',
          branch: 'main',
          allowed: true,
          queueEnabled: false,
          maxConcurrentSessions: 1,
          createdAt: now,
          updatedAt: now,
        }}
        activeSession={{
          id: 'task-1',
          repositoryId: 'repo-1',
          title: 'Copy template',
          status: 'running',
          timeoutSeconds: 3600,
          priority: 0,
          createdAt: now,
          updatedAt: now,
        }}
        latestRun={{
          id: 'run-1',
          taskId: 'task-1',
          repositoryId: 'repo-1',
          status: 'running',
          workerKind: 'native-local',
          timeoutSeconds: 3600,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        }}
        isAgentWorking={false}
        isAgentThinking={true}
      />
    );

    expect(markup).toContain('AIが返答を生成中です');
    expect(markup).toContain('nightworkers-thinking-dot');
    expect(markup).not.toContain('AIが作業中');
  });
});
