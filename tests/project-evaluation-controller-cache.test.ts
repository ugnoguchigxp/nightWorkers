import { describe, expect, it } from 'vitest';
import {
  projectEvaluationDraftStorageKey,
  projectEvaluationTaskPromptDrafts,
} from '../src/modules/nightworkers/components/NightWorkersShell';
import { projectEvaluationComposerDraftState } from '../src/modules/nightworkers/components/ThreadWorkspaceBody';
import type { Task, TaskMessage } from '../src/modules/nightworkers/types';
import { mergeCreatedProjectEvaluationTasks } from '../src/modules/project-evaluation/hooks/useProjectEvaluationController';

function task(id: string, title: string): Task {
  return {
    id,
    repositoryId: 'repository-id',
    title,
    status: 'ready',
    timeoutSeconds: 3600,
    priority: 0,
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
  };
}

function taskMessage(role: TaskMessage['role']): TaskMessage {
  return {
    id: `message-${role}`,
    taskId: 'task-created',
    role,
    content: '改善案の指示書を実行してください。',
    messageType: 'text',
    metadataJson: null,
    createdAt: '2026-06-29T00:00:00.000Z',
  };
}

describe('mergeCreatedProjectEvaluationTasks', () => {
  it('adds created project evaluation tasks to the front of the sessions cache', () => {
    const existing = [task('task-existing', '既存 Task')];
    const created = [task('task-created', '改善案 Task')];

    expect(mergeCreatedProjectEvaluationTasks(existing, created).map((item) => item.id)).toEqual([
      'task-created',
      'task-existing',
    ]);
  });

  it('replaces stale cached tasks returned by the create response', () => {
    const existing = [task('task-created', '古いタイトル'), task('task-existing', '既存 Task')];
    const created = [task('task-created', '新しいタイトル')];

    expect(mergeCreatedProjectEvaluationTasks(existing, created)).toEqual([
      task('task-created', '新しいタイトル'),
      task('task-existing', '既存 Task'),
    ]);
  });
});

describe('project evaluation task prompt drafts', () => {
  it('builds composer draft entries from created task objectives', () => {
    const created = [
      { ...task('task-created', '改善案 Task'), objective: '改善案の指示書を実行してください。' },
      { ...task('task-empty', '空 Task'), objective: '   ' },
    ];

    expect(projectEvaluationTaskPromptDrafts(created)).toEqual([
      { taskId: 'task-created', prompt: '改善案の指示書を実行してください。' },
    ]);
    expect(projectEvaluationDraftStorageKey('task-created')).toBe(
      'nightworkers:composer:task-created'
    );
  });

  it('does not restore a stored project evaluation draft after the prompt was sent', () => {
    const createdTask = {
      ...task('task-created', '改善案 Task'),
      createdBy: 'project-evaluation',
      objective: '改善案の指示書を実行してください。',
    };

    expect(projectEvaluationComposerDraftState(createdTask, [])).toEqual({
      discardStoredDraft: false,
      initialPrompt: '改善案の指示書を実行してください。',
    });
    expect(projectEvaluationComposerDraftState(createdTask, [taskMessage('user')])).toEqual({
      discardStoredDraft: true,
      initialPrompt: '',
    });
  });
});
