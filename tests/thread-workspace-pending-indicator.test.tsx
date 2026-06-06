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
  isDiffArtifactOpen: false,
  onDeleteSession: vi.fn(),
  onQueueSession: vi.fn(),
  onRemoveQueueEntry: vi.fn(),
  onSubmitReview: vi.fn(),
  onRequeueQueueEntry: vi.fn(),
  onArchiveQueueExecution: vi.fn(),
  onOpenArtifact: vi.fn(),
  isProjectFilesOpen: false,
  onOpenProjectFiles: vi.fn(),
  onOpenDiffArtifact: vi.fn(),
};

describe('ThreadWorkspace pending indicator', () => {
  it('shows the assistant thinking indicator while the first session is still being created', () => {
    const markup = renderToStaticMarkup(
      <ThreadWorkspace {...baseProps} isAgentWorking={true} isAgentThinking={true} />
    );

    expect(markup).toContain('AIが返答を生成中です');
    expect(markup).toContain('nightworkers-thinking-dot');
  });
});
