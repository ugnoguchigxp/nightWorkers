import type { SupervisorArtifactContextRef } from './artifact-contract';
import {
  checklistItemCanProveWorkerEvidence,
  type ExecutionReviewChecklistItem,
} from './execution-review';
import type { JobType } from './prompt';
import { jobTypes } from './prompt';
import type {
  SupervisorLoopInput,
  SupervisorTodoContext,
  SupervisorWorkspaceSnapshot,
} from './supervisor-loop-types';

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
    throw new Error('todo_list operation=replace requires a non-empty todos array.');
  }
  return args.todos.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Todo #${index + 1} must be an object.`);
    }
    const todo = raw as Record<string, unknown>;
    const seq = typeof todo.seq === 'number' ? todo.seq : index + 1;
    const title = typeof todo.title === 'string' ? todo.title.trim() : '';
    if (!title) throw new Error(`Todo #${seq} requires title.`);
    return {
      seq,
      title,
      description: typeof todo.description === 'string' ? todo.description : null,
    };
  });
}

const BOOTSTRAP_TOOL_NAMES = ['import_project', 'copy_directory', 'apply_patch'] as const;

export function getBootstrapTodoGap(input: {
  workspaceSnapshot: SupervisorWorkspaceSnapshot;
  currentJobType: JobType;
  todos: Array<{ title: string; description?: string | null; procedureId?: string | null }>;
}): string | null {
  if (input.currentJobType !== 'major_code_edit' || !input.workspaceSnapshot.isEmpty) return null;
  const hasExplicitBootstrapTodo = input.todos.some((todo) => {
    const haystack = [todo.title, todo.description, todo.procedureId]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('\n');
    return BOOTSTRAP_TOOL_NAMES.some((toolName) => haystack.includes(toolName));
  });
  if (hasExplicitBootstrapTodo) return null;
  return 'Empty project roots require a dedicated bootstrap Todo that explicitly names the first workspace-creation tool, such as import_project, copy_directory, or apply_patch.';
}

export function findTodoByToolArguments<TTodo extends { id: string; seq: number }>(
  todos: TTodo[],
  args: Record<string, unknown>
): TTodo | null {
  const seq = typeof args.seq === 'number' ? args.seq : null;
  if (seq !== null) return todos.find((todo) => todo.seq === seq) ?? null;
  return null;
}

export function resolveCurrentTodo<TTodo extends { status: string }>(todos: TTodo[]) {
  const running = todos.filter((todo) => todo.status === 'running');
  if (running.length === 0) return { ok: false as const, errorCode: 'CURRENT_TODO_MISSING' };
  if (running.length > 1) return { ok: false as const, errorCode: 'CURRENT_TODO_NOT_UNIQUE' };
  return { ok: true as const, todo: running[0] };
}

export function getTemplateImportVerificationGap(toolResults: CompactToolResult[]): string | null {
  const importedTemplate = toolResults.some(
    (result) =>
      result.ok && (result.toolName === 'copy_directory' || result.toolName === 'import_project')
  );
  if (!importedTemplate) return null;

  const readProjectManifest = toolResults.some((result) => {
    if (!result.ok || result.toolName !== 'read_file') return false;
    const filePath = String(result.arguments.filePath || '');
    return (
      filePath === 'package.json' ||
      filePath.endsWith('/package.json') ||
      filePath === 'pyproject.toml' ||
      filePath.endsWith('/pyproject.toml')
    );
  });
  if (!readProjectManifest) {
    return 'Cannot finalize after template import before reading package.json or pyproject.toml to identify available verification scripts.';
  }

  const ranVerification = toolResults.some(
    (result) =>
      result.ok &&
      (result.toolName === 'run_verification' ||
        (result.toolName === 'run_command' &&
          /\b(build|lint|typecheck|test|verify|pytest|ruff|pyright)\b/.test(
            String(result.arguments.command || '')
          )))
  );
  if (!ranVerification) {
    return 'Cannot finalize after template import before running manifest-based verification such as build, lint, typecheck, test, verify, pytest, ruff, or pyright.';
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
