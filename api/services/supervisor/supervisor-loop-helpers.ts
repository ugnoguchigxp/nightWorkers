import type { SupervisorArtifactContextRef } from './artifact-contract';
import {
  checklistItemCanProveWorkerEvidence,
  type ExecutionReviewChecklistItem,
} from './execution-review';
import type { JobType } from './prompt';
import { jobTypes } from './prompt';
import type { SupervisorLoopInput, SupervisorTodoContext } from './supervisor-loop-types';

type CompactToolResult = {
  step: number;
  toolName: string;
  ok: boolean;
  arguments: Record<string, unknown>;
  summary: string;
  payload?: unknown;
  error?: unknown;
};

export function toSupervisorTodoContext(todo: {
  id: string;
  seq: number;
  title: string;
  description?: string | null;
  taskType: string;
  status: string;
  procedureId?: string | null;
  procedureSnapshot?: any;
  contextSnapshot?: any;
}): SupervisorTodoContext {
  const procedureSnapshot = todo.procedureSnapshot as any;
  const contextSnapshot = todo.contextSnapshot as any;
  return {
    id: todo.id,
    seq: todo.seq,
    title: todo.title,
    description: todo.description,
    taskType: todo.taskType,
    status: todo.status,
    procedureId: todo.procedureId,
    procedureDigest:
      typeof procedureSnapshot?.digest === 'string' ? procedureSnapshot.digest : undefined,
    contextDigest: typeof contextSnapshot?.digest === 'string' ? contextSnapshot.digest : undefined,
  };
}

export function normalizeTodoListInput(args: Record<string, unknown>) {
  if (!Array.isArray(args.todos) || args.todos.length === 0) {
    throw new Error('replace_todo_list requires a non-empty todos array.');
  }
  return args.todos.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Todo #${index + 1} must be an object.`);
    }
    const todo = raw as Record<string, unknown>;
    const seq = typeof todo.seq === 'number' ? todo.seq : index + 1;
    const title = typeof todo.title === 'string' ? todo.title.trim() : '';
    const taskType = typeof todo.taskType === 'string' ? todo.taskType.trim() : '';
    if (!title) throw new Error(`Todo #${seq} requires title.`);
    if (!taskType) throw new Error(`Todo #${seq} requires taskType.`);
    const dependsOn = Array.isArray(todo.dependsOn)
      ? todo.dependsOn.filter(
          (value): value is string | number =>
            typeof value === 'string' || typeof value === 'number'
        )
      : [];
    return {
      seq,
      title,
      description: typeof todo.description === 'string' ? todo.description : null,
      taskType,
      procedureId: typeof todo.procedureId === 'string' ? todo.procedureId : null,
      dependsOn,
    };
  });
}

export function findTodoByToolArguments<TTodo extends { id: string; seq: number }>(
  todos: TTodo[],
  args: Record<string, unknown>
): TTodo | null {
  const todoId = typeof args.todoId === 'string' ? args.todoId : null;
  if (todoId) return todos.find((todo) => todo.id === todoId) ?? null;
  const seq = typeof args.seq === 'number' ? args.seq : null;
  if (seq !== null) return todos.find((todo) => todo.seq === seq) ?? null;
  return null;
}

export function normalizeCompletionStatus(value: unknown) {
  if (value === 'passed' || value === 'failed' || value === 'skipped' || value === 'needs_human') {
    return value;
  }
  return null;
}

export function getTemplateImportVerificationGap(toolResults: CompactToolResult[]): string | null {
  const copiedTemplate = toolResults.some(
    (result) => result.ok && result.toolName === 'copy_directory'
  );
  if (!copiedTemplate) return null;

  const readPackageJson = toolResults.some((result) => {
    if (!result.ok || result.toolName !== 'read_file') return false;
    const filePath = String(result.arguments.filePath || '');
    return filePath === 'package.json' || filePath.endsWith('/package.json');
  });
  if (!readPackageJson) {
    return 'Cannot finalize after copy_directory before reading package.json to identify available verification scripts.';
  }

  const ranVerification = toolResults.some(
    (result) =>
      result.ok &&
      (result.toolName === 'run_verification' ||
        (result.toolName === 'run_command' &&
          /\b(build|lint|typecheck|test|verify)\b/.test(String(result.arguments.command || ''))))
  );
  if (!ranVerification) {
    return 'Cannot finalize after copy_directory before running package.json-based verification such as build, lint, typecheck, test, or verify.';
  }

  return null;
}

export function formatToolObservation(toolName: string, toolResult: any): string {
  const status = toolResult.ok ? 'ok' : 'failed';
  const header = `tool=${toolName} status=${status}`;
  if (!toolResult.ok) {
    return `${header}\nerror=${toolResult.error?.code || 'UNKNOWN'}: ${
      toolResult.error?.message || 'Unknown tool error'
    }`;
  }
  if (toolName === 'read_file') {
    const payload = toolResult.payload || {};
    const content = typeof payload.content === 'string' ? payload.content : '';
    return [
      header,
      `lines=${payload.startLine ?? '?'}-${payload.endLine ?? '?'} total=${payload.totalLines ?? '?'}`,
      content.slice(0, 12_000),
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (toolName === 'git_status')
    return `${header}\n${toolResult.payload?.shortStatus || 'Clean worktree'}`;
  if (toolName === 'git_diff') return `${header}\n${toolResult.payload?.diffStat || 'No changes'}`;
  return `${header}\npayload=${JSON.stringify(toolResult.payload || {}).slice(0, 3000)}`;
}

export function normalizeJobType(value: unknown): JobType | null {
  return typeof value === 'string' && jobTypes.includes(value as JobType)
    ? (value as JobType)
    : null;
}

export function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function buildUserInput(input: SupervisorLoopInput): string {
  const latest = input.latestUserMessage?.trim();
  if (latest) return latest;
  return (input.prompt || '').trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function buildExecutionReviewContextSnapshot(input: {
  existingContextSnapshot: unknown;
  checklist: ExecutionReviewChecklistItem[];
  artifactContextRefs?: SupervisorArtifactContextRef[];
}) {
  const base = isRecord(input.existingContextSnapshot) ? { ...input.existingContextSnapshot } : {};
  return {
    ...base,
    executionReview: {
      checklist: input.checklist,
      artifactContextRefs: input.artifactContextRefs || [],
      workerEvidenceItemCount: input.checklist.filter(checklistItemCanProveWorkerEvidence).length,
    },
  };
}
