import { describe, expect, it } from 'vitest';
import {
  isReviewedSpecificationMessage,
  mergeWorkspaceTaskMessages,
} from '../src/modules/nightworkers/components/ArtifactWorkspaceViewer';
import type { ActivityArtifact, TaskMessage } from '../src/modules/nightworkers/types';

describe('mergeWorkspaceTaskMessages', () => {
  it('does not let synthetic activity artifact messages override persisted Blueprint messages', () => {
    const createdAt = new Date().toISOString();
    const taskMessage: TaskMessage = {
      id: 'message-blueprint-1',
      taskId: 'task-1',
      role: 'assistant',
      content: '# Blueprint',
      messageType: 'markdown_document',
      metadataJson: {
        intent: 'app_blueprint',
        artifactRef: { artifactId: 'artifact-blueprint-1', kind: 'app_blueprint', version: 1 },
        appBlueprint: { id: 'blueprint-1', name: 'Blueprint', screens: [] },
      },
      createdAt,
    };
    const activityArtifact: ActivityArtifact = {
      id: 'artifact-blueprint-1',
      taskId: 'task-1',
      runId: null,
      kind: 'app_blueprint',
      title: 'Blueprint',
      contentText: JSON.stringify({ id: 'blueprint-1', name: 'Blueprint', screens: [] }),
      metadataJson: {
        intent: 'app_blueprint',
        appBlueprint: { id: 'blueprint-1', name: 'Blueprint', screens: [] },
      },
      createdAt,
    };

    const messages = mergeWorkspaceTaskMessages({
      taskMessages: [taskMessage],
      activityArtifacts: [activityArtifact],
      generatedMessages: [],
    });

    expect(messages.map((message) => message.id)).toEqual(['message-blueprint-1']);
  });
});

describe('isReviewedSpecificationMessage', () => {
  it('waits for the reviewed specification before marking the status flow complete', () => {
    const createdAt = new Date().toISOString();
    const initialSpec: TaskMessage = {
      id: 'message-spec-1',
      taskId: 'task-1',
      role: 'assistant',
      content: '# Specification',
      messageType: 'markdown_document',
      metadataJson: { intent: 'draft_spec', source: 'status' },
      createdAt,
    };
    const reviewedSpec: TaskMessage = {
      ...initialSpec,
      id: 'message-spec-2',
      metadataJson: {
        intent: 'draft_spec',
        source: 'status_document_review',
        reviewedSourceMessageId: initialSpec.id,
      },
    };

    expect(isReviewedSpecificationMessage(initialSpec)).toBe(false);
    expect(isReviewedSpecificationMessage(reviewedSpec)).toBe(true);
  });
});
