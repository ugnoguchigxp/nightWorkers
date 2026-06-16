import { toDeepRecord } from '../../../shared/json-record';
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
  procedureSnapshot?: unknown;
  contextSnapshot?: unknown;
}): SupervisorTodoContext {
  const procedureSnapshot = toDeepRecord(todo.procedureSnapshot);
  const contextSnapshot = toDeepRecord(todo.contextSnapshot);
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

export function getRedundantTodoReplaceGap(input: {
  currentTodos: Array<{ seq: number; title: string; status: string }>;
  toolResults: CompactToolResult[];
}): string | null {
  const latestSuccessfulReplaceIndex = input.toolResults.findLastIndex(
    (result) =>
      result.ok &&
      result.toolName === 'todo_list' &&
      String(result.arguments.operation || '') === 'replace'
  );
  if (latestSuccessfulReplaceIndex < 0) return null;

  const currentTodo = input.currentTodos.find((todo) => todo.status === 'running');
  if (currentTodo) {
    return `TodoList already exists and Todo #${currentTodo.seq} is running: ${currentTodo.title}. Execute the current Todo with the appropriate worker tool before replacing the TodoList again.`;
  }

  const nextOpenTodo = input.currentTodos.find((todo) =>
    ['pending', 'running'].includes(todo.status)
  );
  if (nextOpenTodo) {
    return `TodoList already exists and Todo #${nextOpenTodo.seq} is ${nextOpenTodo.status}: ${nextOpenTodo.title}. Start or close that Todo instead of replacing the TodoList again.`;
  }

  return 'TodoList already exists and has no open items. Finalize the run instead of replacing the TodoList again.';
}

const TODO_TRANSITION_OPERATIONS = new Set(['replace', 'start', 'done', 'block', 'fail']);
const IMPLEMENTATION_EVIDENCE_TOOLS = new Set([
  'apply_patch',
  'replace_content',
  'import_project',
  'copy_directory',
  'run_command',
]);
const VERIFICATION_COMMAND_PATTERN = /\b(build|lint|typecheck|test|verify|pytest|ruff|pyright)\b/;

export function getTodoDoneEvidenceGap(input: {
  todo: {
    seq: number;
    title: string;
    taskType: string;
    procedureId?: string | null;
  };
  toolResults: CompactToolResult[];
}): string | null {
  const requirement = resolveTodoEvidenceRequirement(input.todo);
  if (!requirement) return null;

  const recentToolResults = input.toolResults.slice(findLatestTodoBoundaryIndex(input.toolResults));
  const hasEvidence = recentToolResults.some((result) => requirement.matches(result));
  if (hasEvidence) return null;

  return [
    `Todo #${input.todo.seq}「${input.todo.title}」は ${requirement.label} evidence なしでは done にできません。`,
    `先に ${requirement.nextAction} を実行してください。`,
  ].join(' ');
}

function resolveTodoEvidenceRequirement(todo: {
  taskType: string;
  procedureId?: string | null;
}):
  | {
      label: string;
      nextAction: string;
      matches: (result: CompactToolResult) => boolean;
    }
  | null {
  if (todo.procedureId === 'quality_gate_verify' || todo.taskType === 'verification') {
    return {
      label: 'verification',
      nextAction: 'run_verification または検証系 run_command',
      matches: (result) =>
        result.ok &&
        (result.toolName === 'run_verification' ||
          (result.toolName === 'run_command' &&
            VERIFICATION_COMMAND_PATTERN.test(String(result.arguments.command || '')))),
    };
  }

  if (todo.taskType === 'implementation' && !todo.procedureId) {
    return {
      label: 'implementation',
      nextAction: 'apply_patch / replace_content / import_project / copy_directory などの実装 tool',
      matches: (result) => result.ok && IMPLEMENTATION_EVIDENCE_TOOLS.has(result.toolName),
    };
  }

  return null;
}

function findLatestTodoBoundaryIndex(toolResults: CompactToolResult[]) {
  const latestBoundary = toolResults.findLastIndex((result) => {
    if (result.toolName !== 'todo_list') return false;
    return TODO_TRANSITION_OPERATIONS.has(String(result.arguments.operation || ''));
  });
  return latestBoundary < 0 ? 0 : latestBoundary + 1;
}

export type ProgressContext = {
  objective: string;
  nextConcreteAction: string;
  todoGuidance: string;
  doNotRepeat: string[];
  safeguards: string[];
};

export function buildProgressContext(input: {
  currentJobType: JobType;
  workspaceSnapshot: SupervisorWorkspaceSnapshot;
  currentTodos: Array<{
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
  }>;
  toolResults: CompactToolResult[];
}): ProgressContext {
  const currentTodo = input.currentTodos.find((todo) => todo.status === 'running') ?? null;
  const openTodos = input.currentTodos.filter((todo) =>
    ['pending', 'running'].includes(todo.status)
  );
  const hasSuccessfulImport = input.toolResults.some(
    (result) =>
      result.ok && (result.toolName === 'import_project' || result.toolName === 'copy_directory')
  );
  const hasSuccessfulReplace = input.toolResults.some(
    (result) =>
      result.ok &&
      result.toolName === 'todo_list' &&
      String(result.arguments.operation || '') === 'replace'
  );
  const repeatedReplaceFailures = input.toolResults.filter(
    (result) =>
      !result.ok &&
      result.toolName === 'todo_list' &&
      String(result.arguments.operation || '') === 'replace'
  );
  const hasSpecificationEvidence = input.toolResults.some(
    (result) => result.ok && result.toolName === 'read_current_specification'
  );
  const hasMissingComponentLookup = input.toolResults.some(
    (result) =>
      !result.ok &&
      result.toolName === 'list_dir' &&
      /web\/src\/components/.test(String(result.arguments.relativePath || result.summary))
  );
  const hasWebSrcSnapshot = input.toolResults.some(
    (result) =>
      result.ok &&
      result.toolName === 'list_dir' &&
      String(result.arguments.relativePath || '') === 'web/src'
  );

  return {
    objective: buildProgressObjective(input.currentJobType, currentTodo, openTodos),
    nextConcreteAction: buildNextConcreteAction({
      currentJobType: input.currentJobType,
      workspaceSnapshot: input.workspaceSnapshot,
      currentTodo,
      hasSuccessfulImport,
      hasSuccessfulReplace,
      hasMissingComponentLookup,
      hasWebSrcSnapshot,
    }),
    todoGuidance:
      'Todo は進行状況の記録であり、作業そのものではない。既存 TodoList がある場合は再 replace ではなく、現在の作業に必要な worker tool を実行する。',
    doNotRepeat: [
      repeatedReplaceFailures.length > 0
        ? `todo_list operation=replace は直近で ${repeatedReplaceFailures.length} 回失敗している。同じ replace を繰り返さない。`
        : null,
      hasSuccessfulReplace
        ? 'TodoList は既に作成済み。作業を進める目的で再 replace しない。'
        : null,
      hasSpecificationEvidence
        ? '仕様書は既に読み込み済み。read_current_specification を繰り返さず、現在 Todo の実作業へ進む。'
        : null,
      hasMissingComponentLookup
        ? 'web/src/components が存在しないことは確認済み。さらに探索せず、必要なディレクトリ/ファイルを apply_patch で作成する。'
        : null,
    ].filter((value): value is string => Boolean(value)),
    safeguards: [
      '空の workspace で新規 Web/API app を作る場合は、実装前に import_project を優先する。',
      'import_project が失敗・cancel・未承認の場合、代替の静的実装や shell clone に逃げず、tool failure として止める。',
      'レビューは実差分と検証 evidence を見て行う。レビュー/verify/知識登録/完了報告の固定ゲートを Todo replace で消さない。',
    ],
  };
}

function buildProgressObjective(
  currentJobType: JobType,
  currentTodo: { seq: number; title: string; taskType: string; procedureId?: string | null } | null,
  openTodos: Array<{ seq: number; title: string; status: string }>
) {
  if (currentTodo) {
    return `jobType=${currentJobType}; 現在の実作業は Todo #${currentTodo.seq}「${currentTodo.title}」。`;
  }
  if (openTodos.length > 0) {
    const next = [...openTodos].sort((a, b) => a.seq - b.seq)[0];
    return `jobType=${currentJobType}; running Todo はないが、次の open Todo は #${next.seq}「${next.title}」。`;
  }
  return `jobType=${currentJobType}; open Todo はない。完了条件と evidence を確認して finalize する。`;
}

function buildNextConcreteAction(input: {
  currentJobType: JobType;
  workspaceSnapshot: SupervisorWorkspaceSnapshot;
  currentTodo: {
    title: string;
    taskType: string;
    procedureId?: string | null;
  } | null;
  hasSuccessfulImport: boolean;
  hasSuccessfulReplace: boolean;
  hasMissingComponentLookup: boolean;
  hasWebSrcSnapshot: boolean;
}) {
  const current = input.currentTodo;
  if (
    input.currentJobType === 'major_code_edit' &&
    input.workspaceSnapshot.isEmpty &&
    !input.hasSuccessfulImport
  ) {
    return '空の project root なので、Todo を作り直すのではなく import_project source=starter stack=hono variant=sqlite を実行して土台を作る。';
  }
  if (!current) {
    return input.hasSuccessfulReplace
      ? 'TodoList は存在する。running Todo がない場合は、最初の open Todo を start するか、open Todo がなければ finalize する。'
      : '必要なら一度だけ TodoList を作り、その後は worker tool で具体作業へ進む。';
  }
  if (
    input.currentJobType === 'major_code_edit' &&
    input.hasSuccessfulImport &&
    current.taskType === 'implementation'
  ) {
    if (input.hasMissingComponentLookup || input.hasWebSrcSnapshot) {
      return 'import_project 済み。存在しない components ディレクトリを探し続けず、web/src/routes と web/src/views/domains の既存構成に合わせて apply_patch で必要な Todo List UI ファイルを作成・更新する。';
    }
    return 'import_project 済み。postImport payload と workspace snapshot を使い、必要最小限の read_file 後に apply_patch で現在 Todo の実装へ進む。';
  }
  if (current.procedureId === 'quality_gate_verify' || current.taskType === 'verification') {
    return '現在は検証段階。manifest や既存 script に基づいて run_verification を一度実行し、結果で次を判断する。';
  }
  if (current.procedureId === 'llm_code_review' || current.taskType === 'review') {
    return '現在はレビュー段階。git_diff と関連ファイルを読み、バグ・回帰・責務境界・テスト不足を確認して必要なら修正する。';
  }
  if (
    current.procedureId === 'contextstill.register_candidates' ||
    current.taskType === 'knowledge_capture'
  ) {
    return '現在は知識登録段階。再利用可能な一般知識がある場合だけ register_candidates を使う。';
  }
  return '現在の Todo に対応する read_file / import_project / apply_patch / run_command などの worker tool を実行して実作業を進める。';
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

export function formatToolObservation(toolName: string, toolResult: unknown): string {
  const result = toDeepRecord(toolResult);
  const status = result.ok ? 'ok' : 'failed';
  const header = `tool=${toolName} status=${status}`;
  if (!result.ok) {
    const error = toDeepRecord(result.error);
    return `${header}\nerror=${error.code || 'UNKNOWN'}: ${error.message || 'Unknown tool error'}`;
  }
  if (toolName === 'read_file') {
    const payload = toDeepRecord(result.payload);
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
    return `${header}\n${toDeepRecord(result.payload).shortStatus || 'Clean worktree'}`;
  if (toolName === 'git_diff')
    return `${header}\n${toDeepRecord(result.payload).diffStat || 'No changes'}`;
  return `${header}\npayload=${JSON.stringify(result.payload || {}).slice(0, 3000)}`;
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
