import { toDeepRecord } from '../../../shared/json-record';
import { nightWorkersTodoTaskTypes } from '../../mcp/nightworkers-tool-manifest';
import type { SupervisorArtifactContextRef } from './artifact-contract';
import {
  checklistItemCanProveWorkerEvidence,
  type ExecutionReviewChecklistItem,
} from './execution-review';
import type { JobType } from './prompt';
import { jobTypes } from './prompt';
import type {
  CompactToolResult,
  NativeToolEvidence,
  NativeToolFailureKind,
  RecoveryDirective,
  SupervisorLoopInput,
  SupervisorTodoContext,
  SupervisorWorkspaceSnapshot,
} from './supervisor-loop-types';

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
    const taskType = normalizeTodoTaskType(todo.taskType, seq);
    const procedureId = normalizeOptionalString(todo.procedureId);
    return {
      seq,
      title,
      description: typeof todo.description === 'string' ? todo.description : null,
      ...(taskType ? { taskType } : {}),
      ...(procedureId !== undefined ? { procedureId } : {}),
      ...(Array.isArray(todo.dependsOn)
        ? { dependsOn: normalizeTodoDependsOn(todo.dependsOn) }
        : {}),
    };
  });
}

function normalizeTodoTaskType(value: unknown, seq: number) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`Todo #${seq} taskType must be a string.`);
  const taskType = value.trim();
  if (!TODO_TASK_TYPES.has(taskType)) {
    throw new Error(`Todo #${seq} has unsupported taskType: ${taskType}.`);
  }
  return taskType;
}

function normalizeOptionalString(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeTodoDependsOn(dependsOn: unknown[]) {
  const normalized: Array<string | number> = [];
  for (const value of dependsOn) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      normalized.push(value);
      continue;
    }
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) normalized.push(trimmed);
  }
  return normalized;
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
const INTERNAL_TODO_TASK_TYPES = [
  'initial_instructions',
  'context_compile',
  'knowledge_capture',
  'completion_report',
] as const;
const TODO_TASK_TYPES = new Set<string>([
  ...nightWorkersTodoTaskTypes,
  ...INTERNAL_TODO_TASK_TYPES,
]);
const READ_ONLY_EVIDENCE_TOOLS = new Set([
  'read_current_specification',
  'list_dir',
  'read_file',
  'search_files',
  'git_status',
  'git_diff',
  'run_command',
]);
const IMPLEMENTATION_EVIDENCE_TOOLS = new Set([
  'apply_patch',
  'replace_content',
  'import_project',
  'copy_directory',
  'run_command',
]);
const READ_ONLY_TASK_TYPES = new Set(['inspection', 'investigation']);
const MUTATION_TASK_TYPES = new Set([
  'implementation',
  'code_edit',
  'code_change',
  'scaffold',
  'import',
  'copy',
  'migration',
  'data_migration',
  'documentation',
  'docs',
  'config',
  'dependency',
  'refactor',
  'test',
  'test_change',
  'git',
  'release',
]);
const VERIFICATION_TASK_TYPES = new Set(['verification', 'focused_verification']);
const VERIFICATION_COMMAND_PATTERN = /\b(build|lint|typecheck|test|verify|pytest|ruff|pyright)\b/;

export function getTodoDoneEvidenceGap(input: {
  todo: {
    id?: string;
    seq: number;
    title: string;
    taskType: string;
    procedureId?: string | null;
  };
  toolResults: CompactToolResult[];
}): string | null {
  const requirement = resolveTodoEvidenceRequirement(input.todo);
  if (!requirement) return null;

  const evidenceCandidates = selectEvidenceCandidatesForTodo(input.toolResults, input.todo);
  const hasEvidence = evidenceCandidates.some((result) => requirement.matches(result));
  if (hasEvidence) return null;

  return [
    `Todo #${input.todo.seq}「${input.todo.title}」は ${requirement.label} evidence なしでは done にできません。`,
    `先に ${requirement.nextAction} を実行してください。`,
  ].join(' ');
}

export function getRedundantTodoListGap(input: {
  currentTodo: { seq: number; title: string; taskType: string; status: string } | null;
  toolResults: CompactToolResult[];
}): string | null {
  if (input.currentTodo?.taskType === 'implementation') {
    return [
      `Todo #${input.currentTodo.seq}「${input.currentTodo.title}」は running のままです。`,
      'todo_list operation=list は native Supervisor の進捗操作ではなく、TodoList も作業状態も変更しません。',
      '現在 Todo の実装を進めるには、追加確認ではなく apply_patch / replace_content などの変更系 worker tool を実行してください。',
    ].join(' ');
  }

  return [
    'todo_list operation=list は native Supervisor の進捗操作ではなく、TodoList も作業状態も変更しません。',
    'Todo 状態の再確認ではなく、現在の Todo を進める worker tool、または done/block/fail/finalize_answer を選んでください。',
  ].join(' ');
}

function resolveTodoEvidenceRequirement(todo: { taskType: string; procedureId?: string | null }): {
  label: string;
  nextAction: string;
  matches: (result: CompactToolResult) => boolean;
} | null {
  if (todo.procedureId === 'quality_gate_verify' || VERIFICATION_TASK_TYPES.has(todo.taskType)) {
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

  if (READ_ONLY_TASK_TYPES.has(todo.taskType)) {
    return {
      label: 'inspection',
      nextAction:
        'read_current_specification / list_dir / read_file / search_files などの確認 tool',
      matches: (result) => result.ok && READ_ONLY_EVIDENCE_TOOLS.has(result.toolName),
    };
  }

  if (MUTATION_TASK_TYPES.has(todo.taskType)) {
    return {
      label: 'implementation',
      nextAction: 'apply_patch / replace_content / import_project / copy_directory などの実装 tool',
      matches: (result) => result.ok && IMPLEMENTATION_EVIDENCE_TOOLS.has(result.toolName),
    };
  }

  return null;
}

export function attributeToolResultToTodo(
  result: CompactToolResult,
  currentTodos: Array<{
    id: string;
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
  }>
): CompactToolResult {
  if (result.toolName === 'todo_list') return result;
  const runningTodo = currentTodos.find((todo) => todo.status === 'running') ?? null;
  if (!runningTodo) return result;

  const observed = {
    observedTodoSeq: runningTodo.seq,
    observedTodoId: runningTodo.id,
  };
  const nextMutationTodo = currentTodos.find(
    (todo) =>
      todo.seq > runningTodo.seq &&
      ['pending', 'running'].includes(todo.status) &&
      MUTATION_TASK_TYPES.has(todo.taskType)
  );

  if (
    result.ok &&
    IMPLEMENTATION_EVIDENCE_TOOLS.has(result.toolName) &&
    READ_ONLY_TASK_TYPES.has(runningTodo.taskType) &&
    nextMutationTodo
  ) {
    return {
      ...result,
      ...observed,
      attributedTodoSeq: nextMutationTodo.seq,
      attributedTodoId: nextMutationTodo.id,
      attributionReason:
        'implementation evidence produced while a read-only Todo was current; attributed to the next mutation Todo.',
    };
  }

  return {
    ...result,
    ...observed,
    attributedTodoSeq: runningTodo.seq,
    attributedTodoId: runningTodo.id,
    attributionReason: 'tool result attributed to the running Todo at execution time.',
  };
}

function selectEvidenceCandidatesForTodo(
  toolResults: CompactToolResult[],
  todo: { id?: string; seq: number }
) {
  const recentToolResults = toolResults.slice(findLatestTodoBoundaryIndex(toolResults));
  const attributedToolResults = toolResults.filter((result) =>
    result.attributedTodoId && todo.id
      ? result.attributedTodoId === todo.id
      : result.attributedTodoSeq === todo.seq
  );
  return uniqueToolResults([...recentToolResults, ...attributedToolResults]);
}

function uniqueToolResults(results: CompactToolResult[]) {
  const seen = new Set<string>();
  const unique: CompactToolResult[] = [];
  for (const result of results) {
    const key = `${result.step}:${result.toolName}:${JSON.stringify(result.arguments)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
  }
  return unique;
}

function findLatestTodoBoundaryIndex(toolResults: CompactToolResult[]) {
  const latestBoundary = toolResults.findLastIndex((result) => {
    if (!result.ok || result.toolName !== 'todo_list') return false;
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
  recoveryDirective: RecoveryDirective | null;
  criticalEvidence: NativeToolEvidence[];
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
  const recentToolResults = input.toolResults.slice(findLatestTodoBoundaryIndex(input.toolResults));
  const latestMutationFailure = findLatestMutationFailure(recentToolResults);
  const currentTodoEvidenceRequirement = currentTodo
    ? resolveTodoEvidenceRequirement(currentTodo)
    : null;
  const currentTodoEvidenceCandidates = currentTodo
    ? selectEvidenceCandidatesForTodo(input.toolResults, currentTodo)
    : [];
  const currentTodoHasRequiredEvidence = Boolean(
    currentTodoEvidenceRequirement &&
      currentTodoEvidenceCandidates.some((result) => currentTodoEvidenceRequirement.matches(result))
  );
  const hasSuccessfulImport = input.toolResults.some(
    (result) =>
      result.ok && (result.toolName === 'import_project' || result.toolName === 'copy_directory')
  );
  const hasImplementationEvidenceSinceLatestTodoTransition = recentToolResults.some(
    (result) => result.ok && IMPLEMENTATION_EVIDENCE_TOOLS.has(result.toolName)
  );
  const recentReadOnlyEvidenceCount = recentToolResults.filter(
    (result) => result.ok && READ_ONLY_EVIDENCE_TOOLS.has(result.toolName)
  ).length;
  const currentTodoNeedsMutation = Boolean(
    currentTodo && MUTATION_TASK_TYPES.has(currentTodo.taskType)
  );
  const mutationTodoHasEnoughReadContext =
    currentTodoNeedsMutation &&
    recentReadOnlyEvidenceCount >= 3 &&
    !hasImplementationEvidenceSinceLatestTodoTransition;
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
  const missingPathResults = input.toolResults.filter(
    (result) =>
      !result.ok &&
      ['list_dir', 'read_file'].includes(result.toolName) &&
      typeof (result.arguments.relativePath || result.arguments.filePath) === 'string'
  );
  const missingPathSummaries = summarizeMissingPathResults(missingPathResults);
  const repeatedReadSummaries = summarizeRepeatedReadResults(recentToolResults);
  const criticalEvidence = selectCriticalEvidence(input.toolResults);
  const latestRecoveryEvidence = findLatestActiveRecoveryEvidence({
    recentToolResults,
    allToolResults: input.toolResults,
    currentTodo,
    currentTodoHasRequiredEvidence,
  });
  const recoveryDirective = latestRecoveryEvidence?.recoveryDirective ?? null;
  const recentTodoListCount = input.toolResults
    .slice(-4)
    .filter(
      (result) =>
        result.ok &&
        result.toolName === 'todo_list' &&
        String(result.arguments.operation || '') === 'list'
    ).length;
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
      mutationTodoHasEnoughReadContext,
      latestMutationFailure,
      repeatedMissingPath: missingPathSummaries[0] ?? null,
      repeatedRead: repeatedReadSummaries[0] ?? null,
      recoveryDirective,
      currentTodoHasRequiredEvidence,
      currentTodoEvidenceLabel: currentTodoEvidenceRequirement?.label ?? null,
    }),
    todoGuidance:
      'Todo は進行状況の記録であり、作業そのものではない。既存 TodoList がある場合は再 replace しない。implementation Todo では確認 tool を続けず、現在の作業に必要な変更系 worker tool を実行する。',
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
      recentTodoListCount >= 2
        ? `todo_list operation=list が直近で ${recentTodoListCount} 回続いている。Todo 状態確認を繰り返さず、現在 Todo を進める worker tool を実行する。`
        : null,
      mutationTodoHasEnoughReadContext
        ? `現在の ${currentTodo?.taskType} Todo では read-only evidence が ${recentReadOnlyEvidenceCount} 件あり、implementation evidence はまだ無い。read_current_specification / read_file / list_dir / search_files を続けず、次は apply_patch / replace_content で実装する。`
        : null,
      latestMutationFailure
        ? `${latestMutationFailure.toolName} は直近で失敗している。${formatMutationFailureTarget(latestMutationFailure)}を read_file で再確認し、同じ patch/needle を繰り返さず apply_patch / replace_content を作り直す。`
        : null,
      ...criticalEvidence
        .map((item) => item.doNotRepeat?.reason)
        .filter((value): value is string => Boolean(value)),
      ...missingPathSummaries.map(
        (item) =>
          `${item.toolName} の ${item.path} は存在しないことを確認済み${item.count > 1 ? ` (${item.count} 回)` : ''}。同じパスを繰り返さず、成功済みの一覧結果にある実在パスを使う。`
      ),
      ...repeatedReadSummaries.map(
        (item) =>
          `read_file の ${item.path} は直近 Todo で ${item.count} 回読んでいる。必要な内容が揃っているなら再読せず、現在 Todo の変更 tool に進む。`
      ),
      hasMissingComponentLookup
        ? 'web/src/components が存在しないことは確認済み。さらに探索せず、必要なディレクトリ/ファイルを apply_patch で作成する。'
        : null,
    ].filter((value): value is string => Boolean(value)),
    safeguards: [
      '空の workspace で新規 Web/API app を作る場合は、実装前に import_project を優先する。',
      'import_project が失敗・cancel・未承認の場合、代替の静的実装や shell clone に逃げず、tool failure として止める。',
      'レビューは実差分と検証 evidence を見て行う。レビュー/verify/知識登録/完了報告の固定ゲートを Todo replace で消さない。',
    ],
    recoveryDirective,
    criticalEvidence,
  };
}

function findLatestActiveRecoveryEvidence(input: {
  recentToolResults: CompactToolResult[];
  allToolResults: CompactToolResult[];
  currentTodo: {
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
  } | null;
  currentTodoHasRequiredEvidence: boolean;
}): NativeToolEvidence | null {
  for (const result of [...input.recentToolResults].reverse()) {
    const evidence = result.evidence;
    if (!evidence?.recoveryDirective) continue;
    if (isRecoveryDirectiveResolved(result, input)) continue;
    return evidence;
  }

  for (const result of [...input.allToolResults].reverse()) {
    const evidence = result.evidence;
    if (!evidence?.recoveryDirective) continue;
    if (isRecoveryDirectiveResolved(result, input)) continue;
    return evidence;
  }

  return null;
}

function isRecoveryDirectiveResolved(
  result: CompactToolResult,
  context: {
    recentToolResults: CompactToolResult[];
    currentTodo: {
      seq: number;
      title: string;
      taskType: string;
      status: string;
      procedureId?: string | null;
    } | null;
    currentTodoHasRequiredEvidence: boolean;
  }
) {
  const directive = result.evidence?.recoveryDirective;
  if (!directive) return false;

  if (
    result.toolName === 'todo_list' &&
    String(result.arguments.operation || '') === 'done' &&
    context.currentTodo &&
    context.currentTodoHasRequiredEvidence
  ) {
    return true;
  }

  if (directive.kind === 'read_target_once') {
    const laterResults = context.recentToolResults.filter((item) => item.step > result.step);
    return laterResults.some(
      (item) =>
        item.ok &&
        item.toolName === 'read_file' &&
        (!directive.targetPath || String(item.arguments.filePath || '') === directive.targetPath)
    );
  }

  if (directive.kind === 'edit_with_corrected_patch') {
    return context.recentToolResults.some(
      (item) =>
        item.step > result.step && item.ok && IMPLEMENTATION_EVIDENCE_TOOLS.has(item.toolName)
    );
  }

  return false;
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
    seq: number;
    title: string;
    taskType: string;
    procedureId?: string | null;
  } | null;
  hasSuccessfulImport: boolean;
  hasSuccessfulReplace: boolean;
  hasMissingComponentLookup: boolean;
  hasWebSrcSnapshot: boolean;
  mutationTodoHasEnoughReadContext: boolean;
  latestMutationFailure: MutationFailure | null;
  repeatedMissingPath: RepeatedPathSummary | null;
  repeatedRead: RepeatedPathSummary | null;
  recoveryDirective: RecoveryDirective | null;
  currentTodoHasRequiredEvidence: boolean;
  currentTodoEvidenceLabel: string | null;
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
  if (input.recoveryDirective) {
    return formatRecoveryDirective(input.recoveryDirective);
  }
  if (input.latestMutationFailure) {
    return `直近の ${input.latestMutationFailure.toolName} が失敗している。${formatMutationFailureTarget(input.latestMutationFailure)}を read_file で再確認し、現在の内容に合う apply_patch / replace_content を作り直す。`;
  }
  if (input.currentTodoHasRequiredEvidence) {
    return `Todo #${current.seq}「${current.title}」の ${input.currentTodoEvidenceLabel ?? 'required'} evidence は揃っている。read_current_specification / read_file / list_dir を繰り返さず、todo_list operation=done で現在 Todo を閉じて次の Todo に進む。`;
  }
  if (input.repeatedMissingPath) {
    return `${input.repeatedMissingPath.toolName} の ${input.repeatedMissingPath.path} は存在しないことを確認済み。既に成功した list_dir / workspace snapshot の実在パスを使い、必要なら存在する親ディレクトリに apply_patch で新規ファイルを作成する。`;
  }
  if (input.repeatedRead) {
    return `${input.repeatedRead.path} は直近 Todo で複数回確認済み。再読ではなく、現在 Todo に必要な apply_patch / replace_content へ進む。`;
  }
  if (input.mutationTodoHasEnoughReadContext) {
    return '現在 Todo に必要な読み取り context は揃っている。read_current_specification / read_file / list_dir / search_files に戻らず、次は apply_patch / replace_content で実装変更を行う。';
  }
  if (
    input.currentJobType === 'major_code_edit' &&
    input.hasSuccessfulImport &&
    current.taskType === 'implementation'
  ) {
    if (input.hasMissingComponentLookup || input.hasWebSrcSnapshot) {
      return 'import_project 済み。存在しない components ディレクトリを探し続けず、web/src/routes と web/src/views/domains の既存構成に合わせて apply_patch で必要な Todo List UI ファイルを作成・更新する。';
    }
    return 'import_project 済み。postImport payload と workspace snapshot を使い、必要最小限の確認だけで止め、apply_patch / replace_content で現在 Todo の実装へ進む。';
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
  return '現在の Todo に対応する worker tool を実行して実作業を進める。implementation/code_edit では apply_patch / replace_content、検証では run_verification、調査では read_file / search_files を選ぶ。';
}

function formatRecoveryDirective(directive: RecoveryDirective) {
  if (directive.kind === 'read_target_once') {
    return directive.targetPath
      ? `${directive.targetPath} を read_file で一度だけ読み直し、${directive.reason}`
      : `対象ファイルを read_file で一度だけ読み直し、${directive.reason}`;
  }
  if (directive.kind === 'edit_with_corrected_patch') {
    return directive.targetPath
      ? `${directive.targetPath} の現在内容に合わせ、同じ patch/needle を繰り返さず corrected apply_patch / replace_content を実行する。理由: ${directive.reason}`
      : `現在内容に合わせ、同じ patch/needle を繰り返さず corrected apply_patch / replace_content を実行する。理由: ${directive.reason}`;
  }
  if (directive.kind === 'choose_existing_path') {
    return directive.targetPath
      ? `${directive.targetPath} は避け、成功済み list_dir / workspace snapshot の実在パスを選ぶ。理由: ${directive.reason}`
      : `成功済み list_dir / workspace snapshot の実在パスを選ぶ。理由: ${directive.reason}`;
  }
  if (directive.kind === 'advance_current_todo') {
    return `Todo 状態確認を進捗扱いせず、現在 Todo に対応する worker tool を実行する。理由: ${directive.reason}`;
  }
  return `ユーザー確認が必要。理由: ${directive.reason}`;
}

type MutationFailure = {
  toolName: 'apply_patch' | 'replace_content';
  targetPath: string | null;
};

type RepeatedPathSummary = {
  toolName: string;
  path: string;
  count: number;
  latestStep: number;
};

function summarizeMissingPathResults(toolResults: CompactToolResult[]): RepeatedPathSummary[] {
  return summarizePathResults(
    toolResults,
    (result) =>
      !result.ok &&
      (result.toolName === 'read_file' || result.toolName === 'list_dir') &&
      typeof (result.arguments.filePath || result.arguments.relativePath) === 'string'
  );
}

function summarizeRepeatedReadResults(toolResults: CompactToolResult[]): RepeatedPathSummary[] {
  return summarizePathResults(
    toolResults,
    (result) =>
      result.ok && result.toolName === 'read_file' && typeof result.arguments.filePath === 'string',
    2
  );
}

function summarizePathResults(
  toolResults: CompactToolResult[],
  predicate: (result: CompactToolResult) => boolean,
  minCount = 1
): RepeatedPathSummary[] {
  const byKey = new Map<string, RepeatedPathSummary>();
  for (const result of toolResults) {
    if (!predicate(result)) continue;
    const pathValue = String(result.arguments.filePath || result.arguments.relativePath);
    const key = `${result.toolName}:${pathValue}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.latestStep = Math.max(existing.latestStep, result.step);
    } else {
      byKey.set(key, {
        toolName: result.toolName,
        path: pathValue,
        count: 1,
        latestStep: result.step,
      });
    }
  }
  return [...byKey.values()]
    .filter((item) => item.count >= minCount)
    .sort((a, b) => b.count - a.count || b.latestStep - a.latestStep)
    .slice(0, 3);
}

export function selectToolResultsForPrompt(toolResults: CompactToolResult[]): CompactToolResult[] {
  const selected: CompactToolResult[] = [];
  const add = (result: CompactToolResult | undefined) => {
    if (!result) return;
    if (!selected.includes(result)) selected.push(result);
  };

  for (const result of toolResults.slice(-8)) add(result);

  const latestSuccessfulDirectoryEvidence = [...toolResults]
    .reverse()
    .find((result) => result.ok && result.toolName === 'list_dir');
  add(latestSuccessfulDirectoryEvidence);

  for (const missing of summarizeMissingPathResults(toolResults).slice(0, 3)) {
    add(
      [...toolResults]
        .reverse()
        .find(
          (result) =>
            result.toolName === missing.toolName &&
            String(result.arguments.filePath || result.arguments.relativePath) === missing.path
        )
    );
  }

  const latestMutationFailureIndex = toolResults.findLastIndex(
    (item) => !item.ok && (item.toolName === 'apply_patch' || item.toolName === 'replace_content')
  );
  if (latestMutationFailureIndex >= 0) add(toolResults[latestMutationFailureIndex]);

  return selected.sort((a, b) => a.step - b.step).slice(-12);
}

function findLatestMutationFailure(toolResults: CompactToolResult[]): MutationFailure | null {
  const failureIndex = toolResults.findLastIndex(
    (item) => !item.ok && (item.toolName === 'apply_patch' || item.toolName === 'replace_content')
  );
  if (failureIndex < 0) return null;

  const result = toolResults[failureIndex];
  if (!result) return null;
  const targetPath = extractMutationTargetPath(result);
  const laterResults = toolResults.slice(failureIndex + 1);
  const hasRecoveredRead = laterResults.some(
    (item) =>
      item.ok &&
      item.toolName === 'read_file' &&
      (!targetPath || String(item.arguments.filePath || '') === targetPath)
  );
  if (hasRecoveredRead) return null;
  const hasLaterImplementationEvidence = laterResults.some(
    (item) => item.ok && IMPLEMENTATION_EVIDENCE_TOOLS.has(item.toolName)
  );
  if (hasLaterImplementationEvidence) return null;

  if (result.toolName !== 'apply_patch' && result.toolName !== 'replace_content') {
    return null;
  }
  return {
    toolName: result.toolName,
    targetPath,
  };
}

function extractMutationTargetPath(result: CompactToolResult): string | null {
  if (result.toolName === 'replace_content') {
    return typeof result.arguments.filePath === 'string' ? result.arguments.filePath : null;
  }

  if (result.toolName !== 'apply_patch' || typeof result.arguments.patchContent !== 'string') {
    return null;
  }

  const patchContent = result.arguments.patchContent;
  for (const line of patchContent.split('\n')) {
    const plusMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    if (plusMatch?.[1] && plusMatch[1] !== '/dev/null') return plusMatch[1];
    const minusMatch = /^--- a\/(.+)$/.exec(line);
    if (minusMatch?.[1] && minusMatch[1] !== '/dev/null') return minusMatch[1];
    const diffMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (diffMatch?.[2]) return diffMatch[2];
  }

  return null;
}

function formatMutationFailureTarget(failure: MutationFailure): string {
  return failure.targetPath ? `${failure.targetPath} ` : '対象ファイル ';
}

export function attachNativeToolEvidence(result: CompactToolResult): CompactToolResult {
  const evidence = buildNativeToolEvidence(result);
  return evidence ? { ...result, evidence } : result;
}

export function buildNativeToolEvidence(result: CompactToolResult): NativeToolEvidence | null {
  if (result.toolName === 'todo_list' && String(result.arguments.operation || '') === 'list') {
    return buildEvidence(result, {
      failureKind: 'todo_tracking_noop',
      reason:
        'todo_list operation=list は Todo 状態の読み取りだけで、現在 Todo の作業 evidence にはならない。',
      recoveryDirective: {
        kind: 'advance_current_todo',
        reason: 'Todo list の再確認ではなく、現在 Todo に対応する worker tool を実行する。',
        maxRepeats: 0,
      },
      doNotRepeatReason:
        'todo_list operation=list を繰り返さない。現在 Todo を進める worker tool を実行する。',
      criticalKind: 'todo_tracking_noop',
    });
  }

  if (result.toolName === 'read_file') {
    return buildReadFileEvidence(result);
  }
  if (result.toolName === 'list_dir') {
    return buildListDirEvidence(result);
  }
  if (result.toolName === 'apply_patch') {
    return buildApplyPatchEvidence(result);
  }
  if (result.toolName === 'replace_content') {
    return buildReplaceContentEvidence(result);
  }
  if (result.toolName === 'run_command' || result.toolName === 'run_verification') {
    return buildCommandEvidence(result);
  }
  if (result.toolName === 'search_files') {
    return buildSearchFilesEvidence(result);
  }
  if (
    !result.ok &&
    result.toolName === 'todo_list' &&
    String(result.arguments.operation || '') === 'done'
  ) {
    return buildEvidence(result, {
      failureKind: 'todo_tracking_noop',
      reason: extractToolErrorMessage(result) || result.summary,
      recoveryDirective: {
        kind: 'advance_current_todo',
        reason:
          'todo_list done は必要 evidence 不足で失敗した。ユーザーに戻さず、現在 Todo に必要な worker tool を実行して evidence を揃える。',
        maxRepeats: 0,
      },
      doNotRepeatReason:
        '必要 evidence が揃うまで todo_list operation=done を繰り返さない。現在 Todo に必要な worker tool を実行する。',
      criticalKind: 'todo_tracking_noop',
    });
  }
  if (!result.ok) {
    return buildEvidence(result, {
      failureKind: classifyGenericFailureKind(result),
      reason: extractToolErrorMessage(result) || result.summary,
      recoveryDirective: {
        kind: 'ask_user',
        reason: extractToolErrorMessage(result) || 'tool failure の復旧方針を特定できない。',
      },
      criticalKind: 'tool_failure',
    });
  }
  return null;
}

function buildReadFileEvidence(result: CompactToolResult): NativeToolEvidence | null {
  const targetPath = stringValue(result.arguments.filePath);
  const directiveTargetPath = targetPath || undefined;
  const payload = toDeepRecord(result.payload);
  if (!result.ok) {
    const failureKind = classifyReadFileFailureKind(result);
    return buildEvidence(result, {
      targetPath,
      failureKind,
      reason: extractToolErrorMessage(result) || `read_file failed: ${targetPath || 'unknown'}`,
      recoveryDirective:
        failureKind === 'access_denied'
          ? {
              kind: 'ask_user',
              targetPath: directiveTargetPath,
              reason: '対象ファイルの読み取りが safety policy で拒否された。',
            }
          : {
              kind: 'choose_existing_path',
              targetPath: directiveTargetPath,
              reason:
                '存在しない filePath を繰り返さず、成功済み list_dir / workspace snapshot の実在パスを使う。',
            },
      doNotRepeatReason: targetPath
        ? `read_file の ${targetPath} は失敗済み。同じ filePath を繰り返さない。`
        : '失敗済み read_file を同じ引数で繰り返さない。',
      criticalKind: failureKind === 'access_denied' ? 'tool_failure' : 'missing_path',
    });
  }

  const linesReturned = numberValue(payload?.linesReturned);
  const totalLines = numberValue(payload?.totalLines);
  const startLine = numberValue(result.arguments.startLine);
  const endLine = numberValue(result.arguments.endLine);
  const invalidRange =
    (startLine !== null && totalLines !== null && startLine > totalLines) ||
    (startLine !== null && endLine !== null && endLine < startLine);
  if (invalidRange || linesReturned === 0) {
    const failureKind: NativeToolFailureKind = invalidRange ? 'invalid_line_range' : 'empty_read';
    return buildEvidence(result, {
      targetPath,
      failureKind,
      reason: invalidRange
        ? '指定 line range が対象ファイルの現在行数と合っていない。'
        : 'read_file は 0 行しか返しておらず、編集判断に使える本文 evidence ではない。',
      recoveryDirective: {
        kind: 'read_target_once',
        targetPath: directiveTargetPath,
        reason:
          'range を外すか現在行数に合う近傍 range で一度だけ読み直し、十分な context がある場合は編集へ進む。',
        maxRepeats: 1,
      },
      doNotRepeatReason: targetPath
        ? `read_file の ${targetPath} で 0 行/無効 range の結果を繰り返さない。`
        : '0 行/無効 range の read_file を繰り返さない。',
      criticalKind: 'empty_read',
    });
  }
  return null;
}

function buildListDirEvidence(result: CompactToolResult): NativeToolEvidence | null {
  if (result.ok) return null;
  const targetPath = stringValue(result.arguments.relativePath) || '.';
  const failureKind = classifyListDirFailureKind(result);
  return buildEvidence(result, {
    targetPath,
    failureKind,
    reason: extractToolErrorMessage(result) || `list_dir failed: ${targetPath}`,
    recoveryDirective:
      failureKind === 'access_denied'
        ? {
            kind: 'ask_user',
            targetPath,
            reason: '対象 directory の読み取りが safety policy で拒否された。',
          }
        : {
            kind: 'choose_existing_path',
            targetPath,
            reason:
              '存在しない path / directory ではない path を繰り返さず、実在する親 directory を確認して進む。',
          },
    doNotRepeatReason: `list_dir の ${targetPath} は失敗済み。同じ path を繰り返さない。`,
    criticalKind: failureKind === 'access_denied' ? 'tool_failure' : 'missing_path',
  });
}

function buildApplyPatchEvidence(result: CompactToolResult): NativeToolEvidence | null {
  if (result.ok) return null;
  const targetPath = extractMutationTargetPath(result) || extractChangedFileTarget(result);
  const directiveTargetPath = targetPath || undefined;
  const code = errorCode(result);
  const message = extractToolErrorMessage(result) || '';
  const malformedPatch = /corrupt patch|patch fragment without header|unrecognized input/i.test(
    message
  );
  const failureKind: NativeToolFailureKind =
    code === 'ACCESS_DENIED'
      ? 'access_denied'
      : code === 'PATCH_TARGET_NOT_FOUND'
        ? 'path_not_found'
        : code === 'PATCH_DOES_NOT_APPLY' || code === 'PATCH_TARGET_EXISTS' || malformedPatch
          ? 'patch_mismatch'
          : 'unknown_tool_failure';
  return buildEvidence(result, {
    targetPath,
    failureKind,
    reason: message || 'apply_patch failed.',
    recoveryDirective:
      failureKind === 'access_denied'
        ? {
            kind: 'ask_user',
            targetPath: directiveTargetPath,
            reason: 'patch target が safety policy で拒否された。',
          }
        : {
            kind: 'read_target_once',
            targetPath: directiveTargetPath,
            reason: malformedPatch
              ? 'patchContent が壊れている。新規ファイルは *** Begin Patch / *** Add File: path / +content / *** End Patch 形式、既存ファイル更新は正しい diff header と hunk を持つ patch に作り直す。'
              : failureKind === 'path_not_found'
                ? 'patch target の親 directory または現在の実在パスを確認し、必要なら新規 file patch に切り替える。'
                : '対象ファイルの現在内容を確認し、同じ patch を繰り返さず corrected patch を作る。',
            maxRepeats: 1,
          },
    doNotRepeatReason: targetPath
      ? `apply_patch の ${targetPath} への同じ patch を繰り返さない。read_file 後に corrected patch を作る。`
      : '失敗した apply_patch と同じ patch を繰り返さない。対象を読み直して corrected patch を作る。',
    criticalKind: 'mutation_failure',
  });
}

function buildReplaceContentEvidence(result: CompactToolResult): NativeToolEvidence | null {
  if (result.ok) return null;
  const targetPath = stringValue(result.arguments.filePath);
  const directiveTargetPath = targetPath || undefined;
  const code = errorCode(result);
  const failureKind: NativeToolFailureKind =
    code === 'ACCESS_DENIED'
      ? 'access_denied'
      : code === 'FILE_NOT_FOUND'
        ? 'file_not_found'
        : code === 'NO_MATCH' || code === 'EMPTY_NEEDLE' || code === 'MULTIPLE_MATCHES'
          ? 'needle_not_found'
          : 'unknown_tool_failure';
  return buildEvidence(result, {
    targetPath,
    failureKind,
    reason: extractToolErrorMessage(result) || 'replace_content failed.',
    recoveryDirective:
      failureKind === 'access_denied'
        ? {
            kind: 'ask_user',
            targetPath: directiveTargetPath,
            reason: 'replace target が safety policy で拒否された。',
          }
        : {
            kind: 'read_target_once',
            targetPath: directiveTargetPath,
            reason:
              failureKind === 'file_not_found'
                ? '実在 filePath を確認し、必要なら新規 file patch に切り替える。'
                : '対象ファイルの現在内容を確認し、同じ needle を繰り返さず corrected replacement を作る。',
            maxRepeats: 1,
          },
    doNotRepeatReason: targetPath
      ? `replace_content の ${targetPath} で同じ needle を繰り返さない。read_file 後に corrected replacement を作る。`
      : '失敗した replace_content と同じ needle を繰り返さない。',
    criticalKind: 'mutation_failure',
  });
}

function buildCommandEvidence(result: CompactToolResult): NativeToolEvidence | null {
  if (result.ok) return null;
  if (result.toolName === 'run_verification' && errorCode(result) === 'DESTRUCTIVE_COMMAND') {
    return buildEvidence(result, {
      failureKind: 'command_failed',
      reason:
        extractToolErrorMessage(result) ||
        'run_verification was used for a command blocked by policy.',
      recoveryDirective: {
        kind: 'edit_with_corrected_patch',
        reason:
          'run_verification は検証専用。ファイル作成・mkdir・shell redirection・chained shell で再試行せず、必要な変更は apply_patch または replace_content で行う。',
      },
      doNotRepeatReason:
        'run_verification でファイル作成、mkdir、cat/heredoc、redirection、chained shell を繰り返さない。',
      criticalKind: 'command_failure',
    });
  }
  return buildEvidence(result, {
    failureKind: errorCode(result) === 'ACCESS_DENIED' ? 'access_denied' : 'command_failed',
    reason: extractToolErrorMessage(result) || result.summary,
    recoveryDirective: {
      kind: errorCode(result) === 'ACCESS_DENIED' ? 'ask_user' : 'advance_current_todo',
      reason:
        errorCode(result) === 'ACCESS_DENIED'
          ? 'command 実行が policy で拒否された。'
          : 'command failure の stderr/stdout を使って次の修正または Todo status を判断する。',
    },
    criticalKind: 'command_failure',
  });
}

function buildSearchFilesEvidence(result: CompactToolResult): NativeToolEvidence | null {
  if (!result.ok) {
    return buildEvidence(result, {
      failureKind: classifyGenericFailureKind(result),
      reason: extractToolErrorMessage(result) || result.summary,
      recoveryDirective: {
        kind: 'choose_existing_path',
        reason: 'search_files の失敗を繰り返さず、既存の list_dir/read_file evidence で進める。',
      },
      criticalKind: 'tool_failure',
    });
  }
  const payload = toDeepRecord(result.payload);
  const count = numberValue(payload?.count);
  if (count === 0) {
    return buildEvidence(result, {
      failureKind: 'path_not_found',
      reason: 'search_files は一致結果 0 件だった。',
      recoveryDirective: {
        kind: 'choose_existing_path',
        reason: '同じ query を繰り返さず、実在パスか別の具体 query を使う。',
      },
      doNotRepeatReason: 'search_files の 0 件 query を同じ内容で繰り返さない。',
      criticalKind: 'missing_path',
    });
  }
  return null;
}

function buildEvidence(
  result: CompactToolResult,
  input: {
    targetPath?: string | null;
    failureKind: NativeToolFailureKind;
    reason: string;
    recoveryDirective?: RecoveryDirective;
    doNotRepeatReason?: string;
    criticalKind: NonNullable<NativeToolEvidence['criticalEvidence']>['kind'];
  }
): NativeToolEvidence {
  const targetPath = input.targetPath || undefined;
  const summary = targetPath
    ? `${input.failureKind}: ${result.toolName} ${targetPath}: ${input.reason}`
    : `${input.failureKind}: ${result.toolName}: ${input.reason}`;
  return {
    step: result.step,
    toolName: result.toolName,
    ok: result.ok,
    targetPath,
    failureKind: input.failureKind,
    reason: input.reason,
    ...(input.recoveryDirective ? { recoveryDirective: input.recoveryDirective } : {}),
    ...(input.doNotRepeatReason
      ? {
          doNotRepeat: {
            toolName: result.toolName,
            targetPath,
            reason: input.doNotRepeatReason,
            maxRepeats: input.recoveryDirective?.maxRepeats,
          },
        }
      : {}),
    criticalEvidence: {
      kind: input.criticalKind,
      summary,
    },
  };
}

function selectCriticalEvidence(toolResults: CompactToolResult[]) {
  const selected: NativeToolEvidence[] = [];
  for (const result of [...toolResults].reverse()) {
    if (!result.evidence?.criticalEvidence) continue;
    const key = `${result.evidence.toolName}:${result.evidence.failureKind || ''}:${
      result.evidence.targetPath || ''
    }`;
    if (
      selected.some(
        (item) => `${item.toolName}:${item.failureKind || ''}:${item.targetPath || ''}` === key
      )
    ) {
      continue;
    }
    selected.push(result.evidence);
    if (selected.length >= 3) break;
  }
  return selected.reverse();
}

function classifyReadFileFailureKind(result: CompactToolResult): NativeToolFailureKind {
  const code = errorCode(result);
  if (code === 'ACCESS_DENIED') return 'access_denied';
  if (code === 'FILE_NOT_FOUND') return 'file_not_found';
  return 'unknown_tool_failure';
}

function classifyListDirFailureKind(result: CompactToolResult): NativeToolFailureKind {
  const code = errorCode(result);
  if (code === 'ACCESS_DENIED') return 'access_denied';
  if (code === 'NOT_A_DIRECTORY') return 'not_a_directory';
  if (code === 'DIRECTORY_NOT_FOUND') return 'path_not_found';
  return 'unknown_tool_failure';
}

function classifyGenericFailureKind(result: CompactToolResult): NativeToolFailureKind {
  const code = errorCode(result);
  if (code === 'ACCESS_DENIED') return 'access_denied';
  if (/NOT_FOUND|NO_SUCH|DIRECTORY_NOT_FOUND|FILE_NOT_FOUND/.test(code || '')) {
    return 'path_not_found';
  }
  return 'unknown_tool_failure';
}

function errorCode(result: CompactToolResult) {
  const error = toDeepRecord(result.error);
  return typeof error?.code === 'string' ? error.code : null;
}

function extractToolErrorMessage(result: CompactToolResult) {
  if (typeof result.error === 'string') return result.error;
  const error = toDeepRecord(result.error);
  return typeof error?.message === 'string' ? error.message : null;
}

function extractChangedFileTarget(result: CompactToolResult) {
  const payload = toDeepRecord(result.payload);
  const changedFiles = Array.isArray(payload?.changedFiles) ? payload.changedFiles : [];
  const first = changedFiles.find((value) => typeof value === 'string');
  return typeof first === 'string' ? first : null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
    const payload: Record<string, unknown> = isRecord(result.payload)
      ? (result.payload as Record<string, unknown>)
      : {};
    const content = typeof payload.content === 'string' ? payload.content : '';
    if (payload.cached === true) {
      return [
        `${header} cached=true contentReturned=false`,
        `totalLines=${payload.totalLines ?? '?'} contentHash=${payload.contentHash ?? '?'}`,
        content.slice(0, 12_000),
      ]
        .filter(Boolean)
        .join('\n');
    }
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
