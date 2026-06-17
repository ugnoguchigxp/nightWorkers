import { describe, expect, it } from 'vitest';
import { projectConversationStateCardForRuntime } from '../api/services/conversation-context/state-card-projection';
import type {
  ConversationContextSnapshotRecord,
  ConversationContextSnapshotV1,
} from '../api/services/conversation-context/types';

describe('conversation StateCard projection', () => {
  it('keeps implementation runtime on the raw StateCard', () => {
    const result = projectConversationStateCardForRuntime({
      snapshot: snapshotRecord(),
      role: 'implementation',
    });

    expect(result.stateCardText).toContain('<STATE_CARD>');
    expect(result.projection).toMatchObject({
      role: 'implementation',
      source: 'raw_snapshot',
      omittedSections: [],
    });
  });

  it('omits StateCard for general answers', () => {
    const result = projectConversationStateCardForRuntime({
      snapshot: snapshotRecord(),
      role: 'general_answer',
    });

    expect(result.stateCardText).toBeNull();
    expect(result.projection).toMatchObject({
      role: 'general_answer',
      source: 'omitted',
    });
  });

  it('projects review context without raw coding details', () => {
    const result = projectConversationStateCardForRuntime({
      snapshot: snapshotRecord({
        stateCardText: '<STATE_CARD>\nCoding todo detail that should not leak raw\n</STATE_CARD>',
      }),
      role: 'review',
    });

    expect(result.stateCardText).toContain('role="review"');
    expect(result.stateCardText).toContain('Targets: src/app.ts');
    expect(result.stateCardText).not.toContain('Coding todo detail');
    expect(result.projection).toMatchObject({
      role: 'review',
      source: 'role_projection',
      omittedSections: expect.arrayContaining(['implementation_todos']),
    });
  });
});

function snapshotRecord(
  overrides: Partial<ConversationContextSnapshotRecord> = {}
): ConversationContextSnapshotRecord {
  return {
    id: 'snapshot-1',
    taskId: 'task-1',
    runId: 'run-previous',
    version: 1,
    jobType: 'minor_code_edit',
    latestUserMessageId: 'message-previous',
    previousRunId: 'run-previous',
    terminalState: 'completed',
    tokenEstimate: 64,
    snapshotJson: snapshotJson(),
    stateCardText: '<STATE_CARD>\nTask: task-1 | minor_code_edit | continuation\n</STATE_CARD>',
    createdAt: new Date('2026-06-17T00:00:00.000Z'),
    updatedAt: new Date('2026-06-17T00:00:01.000Z'),
    ...overrides,
  };
}

function snapshotJson(): ConversationContextSnapshotV1 {
  return {
    version: 1,
    task: {
      id: 'task-1',
      status: 'running',
      latestUserMessageId: 'message-previous',
      latestUserRequest: '実装してください',
      title: 'Task',
    },
    classification: {
      jobType: 'minor_code_edit',
      goal: 'Add feature',
      source: 'intake_metadata',
    },
    continuity: {
      isContinuation: true,
      previousRunId: 'run-previous',
      previousTerminalState: 'completed',
      previousAction: null,
    },
    files: {
      target: ['src/app.ts'],
    },
    runState: {
      lastError: null,
      lastFinalReport: 'Implemented feature and ran tests.',
      lastToolFailure: null,
      workerEvidence: null,
    },
    code: {
      snippets: [
        {
          path: 'src/app.ts',
          reason: 'target_file_small',
          content: 'const rawCodingDetail = true;',
          truncated: false,
        },
      ],
    },
    limits: {
      tokenEstimate: 64,
      truncatedFields: [],
    },
  };
}
