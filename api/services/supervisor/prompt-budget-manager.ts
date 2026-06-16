import { estimateTokens } from '../conversation-context/token-budget';
import type { ResolvedStructuredLlmModelCapability } from '../structured-llm/model-capability';
import type { StructuredLlmPromptBudgetMetadata } from '../structured-llm/types';

export type PromptBudgetResult = {
  systemPrompt: string;
  userPrompt: string;
  metadata: StructuredLlmPromptBudgetMetadata;
};

type CompressionMode = 'balanced' | 'aggressive';

type CompressionStats = {
  compressedSections: Set<string>;
  droppedFields: Set<string>;
};

const ROUND2_SECTIONS = [
  'Latest User Request',
  'Goal',
  'Continuity Context',
  'Workspace Snapshot',
  'Current Execution State',
  'Progress Context',
  'Recent Tool Evidence',
  'Loaded Procedure Summaries',
  'Artifact and Source References',
  'Safety Context',
] as const;

export function buildPromptBudget(input: {
  systemPrompt: string;
  userPrompt: string;
  modelCapability: ResolvedStructuredLlmModelCapability;
}): PromptBudgetResult {
  const before = estimatePromptTokens(input.systemPrompt, input.userPrompt);
  const baseStats = createStats();
  let userPrompt = input.userPrompt;
  let compressionProfile = input.modelCapability.compressionProfile || 'none';

  if (before > input.modelCapability.safePromptBudgetTokens) {
    const firstMode: CompressionMode =
      input.modelCapability.compressionProfile === 'aggressive' ? 'aggressive' : 'balanced';
    const compressed = compressRound2UserPrompt(input.userPrompt, firstMode);
    userPrompt = compressed.userPrompt;
    mergeStats(baseStats, compressed.stats);
    compressionProfile = firstMode;

    if (
      estimatePromptTokens(input.systemPrompt, userPrompt) >
        input.modelCapability.safePromptBudgetTokens &&
      firstMode !== 'aggressive'
    ) {
      const stronger = compressRound2UserPrompt(input.userPrompt, 'aggressive');
      userPrompt = stronger.userPrompt;
      mergeStats(baseStats, stronger.stats);
      compressionProfile = 'aggressive';
    }
  }

  const after = estimatePromptTokens(input.systemPrompt, userPrompt);
  const metadata: StructuredLlmPromptBudgetMetadata = {
    modelContextWindowTokens: input.modelCapability.contextWindowTokens,
    safePromptBudgetTokens: input.modelCapability.safePromptBudgetTokens,
    reservedOutputTokens: input.modelCapability.reservedOutputTokens,
    estimatedPromptTokensBefore: before,
    estimatedPromptTokensAfter: after,
    systemPromptLengthBefore: input.systemPrompt.length,
    systemPromptLengthAfter: input.systemPrompt.length,
    userPromptLengthBefore: input.userPrompt.length,
    userPromptLengthAfter: userPrompt.length,
    compressedSections: [...baseStats.compressedSections].sort(),
    droppedFields: [...baseStats.droppedFields].sort(),
    compressionProfile,
    budgetExceeded: after > input.modelCapability.safePromptBudgetTokens,
  };

  return { systemPrompt: input.systemPrompt, userPrompt, metadata };
}

function estimatePromptTokens(systemPrompt: string, userPrompt: string) {
  return estimateTokens(systemPrompt) + estimateTokens(userPrompt);
}

function compressRound2UserPrompt(userPrompt: string, mode: CompressionMode) {
  const stats = createStats();
  const sections = parseRound2Sections(userPrompt);
  if (!sections.size) {
    return {
      userPrompt: truncateText(userPrompt, mode === 'aggressive' ? 6_000 : 12_000),
      stats,
    };
  }

  setTextSection(sections, stats, 'Latest User Request', mode === 'aggressive' ? 1_000 : 2_000);
  setTextSection(sections, stats, 'Goal', mode === 'aggressive' ? 800 : 1_600);
  setJsonSection(sections, stats, 'Workspace Snapshot', (value) =>
    compactWorkspaceSnapshot(value, mode, stats)
  );
  setJsonSection(sections, stats, 'Current Execution State', (value) =>
    compactExecutionState(value, mode, stats)
  );
  setJsonSection(sections, stats, 'Progress Context', (value) =>
    compactProgressContext(value, mode, stats)
  );
  setJsonSection(sections, stats, 'Recent Tool Evidence', (value) =>
    compactToolEvidence(value, mode, stats)
  );
  setJsonSection(sections, stats, 'Loaded Procedure Summaries', (value) =>
    compactProcedureSummaries(value, mode, stats)
  );
  setTextSection(
    sections,
    stats,
    'Artifact and Source References',
    mode === 'aggressive' ? 1_200 : 2_400
  );
  setTextSection(sections, stats, 'Safety Context', mode === 'aggressive' ? 1_000 : 2_000);

  return {
    userPrompt: renderRound2Sections(sections),
    stats,
  };
}

function compactWorkspaceSnapshot(value: unknown, mode: CompressionMode, stats: CompressionStats) {
  const record = asRecord(value);
  const maxItems = mode === 'aggressive' ? 8 : 16;
  if (Array.isArray(record.topLevelDirs) && record.topLevelDirs.length > maxItems) {
    stats.droppedFields.add('workspaceSnapshot.topLevelDirs.tail');
  }
  if (Array.isArray(record.topLevelFiles) && record.topLevelFiles.length > maxItems) {
    stats.droppedFields.add('workspaceSnapshot.topLevelFiles.tail');
  }
  return {
    isEmpty: record.isEmpty,
    topLevelDirs: Array.isArray(record.topLevelDirs)
      ? record.topLevelDirs.slice(0, maxItems)
      : record.topLevelDirs,
    topLevelFiles: Array.isArray(record.topLevelFiles)
      ? record.topLevelFiles.slice(0, maxItems)
      : record.topLevelFiles,
    truncated: Boolean(record.truncated),
  };
}

function compactExecutionState(value: unknown, mode: CompressionMode, stats: CompressionStats) {
  const record = asRecord(value);
  const maxTodos = mode === 'aggressive' ? 12 : 24;
  const todoPlan = Array.isArray(record.todoPlan) ? record.todoPlan : [];
  if (todoPlan.length > maxTodos) stats.droppedFields.add('todoPlan.tail');
  return {
    todoPlan: todoPlan.slice(0, maxTodos).map((todo) => compactTodo(todo, mode, stats)),
    currentTodo: record.currentTodo ? compactTodo(record.currentTodo, mode, stats) : null,
  };
}

function compactTodo(value: unknown, mode: CompressionMode, stats: CompressionStats) {
  const record = asRecord(value);
  const allowed = new Set(['id', 'seq', 'title', 'status', 'taskType', 'procedureId']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) stats.droppedFields.add(`todo.${key}`);
  }
  return {
    id: record.id,
    seq: record.seq,
    title:
      typeof record.title === 'string'
        ? truncateText(record.title, mode === 'aggressive' ? 80 : 120)
        : record.title,
    status: record.status,
    taskType: record.taskType,
    procedureId: record.procedureId,
  };
}

function compactProgressContext(value: unknown, mode: CompressionMode, stats: CompressionStats) {
  const record = asRecord(value);
  const maxItems = mode === 'aggressive' ? 3 : 5;
  const doNotRepeat = Array.isArray(record.doNotRepeat) ? record.doNotRepeat : [];
  const safeguards = Array.isArray(record.safeguards) ? record.safeguards : [];
  if (doNotRepeat.length > maxItems) stats.droppedFields.add('progressContext.doNotRepeat.tail');
  if (safeguards.length > maxItems) stats.droppedFields.add('progressContext.safeguards.tail');
  return {
    objective:
      typeof record.objective === 'string'
        ? truncateText(record.objective, mode === 'aggressive' ? 200 : 400)
        : record.objective,
    nextConcreteAction:
      typeof record.nextConcreteAction === 'string'
        ? truncateText(record.nextConcreteAction, mode === 'aggressive' ? 300 : 600)
        : record.nextConcreteAction,
    todoGuidance:
      typeof record.todoGuidance === 'string'
        ? truncateText(record.todoGuidance, mode === 'aggressive' ? 260 : 520)
        : record.todoGuidance,
    doNotRepeat: doNotRepeat
      .slice(0, maxItems)
      .map((item) =>
        typeof item === 'string' ? truncateText(item, mode === 'aggressive' ? 160 : 280) : item
      ),
    safeguards: safeguards
      .slice(0, maxItems)
      .map((item) =>
        typeof item === 'string' ? truncateText(item, mode === 'aggressive' ? 180 : 320) : item
      ),
  };
}

function compactToolEvidence(value: unknown, mode: CompressionMode, stats: CompressionStats) {
  const items = Array.isArray(value) ? value : [];
  const maxItems = mode === 'aggressive' ? 4 : 8;
  if (items.length > maxItems) stats.droppedFields.add('toolEvidence.olderItems');
  return items.slice(-maxItems).map((item) => compactToolEvidenceItem(item, mode, stats));
}

function compactToolEvidenceItem(value: unknown, mode: CompressionMode, stats: CompressionStats) {
  const record = asRecord(value);
  const toolName = typeof record.toolName === 'string' ? record.toolName : '';
  const compacted: Record<string, unknown> = {
    step: record.step,
    toolName,
    ok: record.ok,
    arguments: compactToolArguments(record.arguments),
    summary:
      typeof record.summary === 'string'
        ? truncateText(record.summary, mode === 'aggressive' ? 260 : 520)
        : record.summary,
  };
  const payload = compactToolPayload(toolName, record.payload, mode, stats);
  if (payload !== undefined) compacted.payload = payload;
  const error = compactToolError(record.error, mode);
  if (error) compacted.error = error;
  if (record.payload !== undefined && payload === undefined) {
    stats.droppedFields.add(`toolEvidence.${toolName || 'unknown'}.payload`);
  }
  return compacted;
}

function compactToolArguments(value: unknown) {
  const record = asRecord(value);
  if (typeof record.operation === 'string') {
    return {
      operation: record.operation,
      seq: record.seq,
      todoCount: Array.isArray(record.todos) ? record.todos.length : undefined,
    };
  }
  if (typeof record.filePath === 'string') return { filePath: record.filePath };
  if (typeof record.command === 'string') return { command: truncateText(record.command, 200) };
  if (typeof record.taskId === 'string') return { taskId: record.taskId };
  if (typeof record.query === 'string') return { query: truncateText(record.query, 200) };
  if (!Object.keys(record).length) return undefined;
  return Object.fromEntries(
    Object.entries(record).map(([key, rawValue]) => [
      key,
      typeof rawValue === 'string' ? truncateText(rawValue, 200) : rawValue,
    ])
  );
}

function compactToolPayload(
  toolName: string,
  value: unknown,
  mode: CompressionMode,
  stats: CompressionStats
) {
  if (value === undefined || value === null) return undefined;
  const record = asRecord(value);
  if (toolName === 'read_current_specification') {
    return {
      taskId: record.taskId,
      found: record.found,
      title: record.title,
      digest: record.digest,
      contentPreview:
        typeof record.contentPreview === 'string'
          ? truncateText(record.contentPreview, mode === 'aggressive' ? 300 : 600)
          : record.contentPreview,
    };
  }
  if (toolName === 'context-still.context_compile') {
    stats.droppedFields.add('toolEvidence.context_compile.result');
    return undefined;
  }
  return undefined;
}

function compactToolError(value: unknown, mode: CompressionMode) {
  if (!value) return undefined;
  const record = asRecord(value);
  return {
    name: record.name,
    message:
      typeof record.message === 'string'
        ? truncateText(record.message, mode === 'aggressive' ? 180 : 300)
        : record.message,
  };
}

function compactProcedureSummaries(value: unknown, mode: CompressionMode, stats: CompressionStats) {
  const items = Array.isArray(value) ? value : [];
  const maxItems = mode === 'aggressive' ? 3 : 6;
  if (items.length > maxItems) stats.droppedFields.add('procedureSummaries.tail');
  return items.slice(0, maxItems).map((item) => compactProcedureSummary(item, mode, stats));
}

function compactProcedureSummary(value: unknown, mode: CompressionMode, stats: CompressionStats) {
  const record = asRecord(value);
  const maxProcedureItems = mode === 'aggressive' ? 3 : 6;
  const maxRuleItems = mode === 'aggressive' ? 2 : 4;
  if (Array.isArray(record.procedure) && record.procedure.length > maxProcedureItems) {
    stats.droppedFields.add('procedureSummary.procedure.tail');
  }
  if (Array.isArray(record.requiredRules) && record.requiredRules.length > maxRuleItems) {
    stats.droppedFields.add('procedureSummary.requiredRules.tail');
  }
  return {
    jobType: record.jobType,
    path: record.path,
    digest: record.digest,
    useWhen:
      typeof record.useWhen === 'string'
        ? truncateText(record.useWhen, mode === 'aggressive' ? 80 : 140)
        : record.useWhen,
    procedure: Array.isArray(record.procedure)
      ? record.procedure
          .slice(0, maxProcedureItems)
          .map((item) => truncateText(String(item), mode === 'aggressive' ? 80 : 140))
      : record.procedure,
    requiredRules: Array.isArray(record.requiredRules)
      ? record.requiredRules
          .slice(0, maxRuleItems)
          .map((item) => truncateText(String(item), mode === 'aggressive' ? 80 : 140))
      : record.requiredRules,
    truncated: true,
    loadedAtStep: record.loadedAtStep,
  };
}

function setTextSection(
  sections: Map<string, string>,
  stats: CompressionStats,
  section: string,
  maxChars: number
) {
  const value = sections.get(section);
  if (value === undefined) return;
  const next = truncateText(value, maxChars);
  if (next !== value) {
    sections.set(section, next);
    stats.compressedSections.add(section);
  }
}

function setJsonSection(
  sections: Map<string, string>,
  stats: CompressionStats,
  section: string,
  transform: (value: unknown) => unknown
) {
  const value = sections.get(section);
  if (value === undefined) return;
  try {
    const next = JSON.stringify(transform(JSON.parse(value)), null, 2);
    if (next !== value) {
      sections.set(section, next);
      stats.compressedSections.add(section);
    }
  } catch {
    const next = truncateText(value, 1_000);
    if (next !== value) {
      sections.set(section, next);
      stats.compressedSections.add(section);
    }
  }
}

function parseRound2Sections(value: string) {
  const sections = new Map<string, string>();
  for (let index = 0; index < ROUND2_SECTIONS.length; index += 1) {
    const section = ROUND2_SECTIONS[index];
    const marker = `[${section}]`;
    const start = value.indexOf(marker);
    if (start < 0) continue;
    const bodyStart = start + marker.length;
    const nextStarts = ROUND2_SECTIONS.slice(index + 1)
      .map((nextSection) => value.indexOf(`[${nextSection}]`, bodyStart))
      .filter((nextIndex) => nextIndex >= 0);
    const bodyEnd = nextStarts.length ? Math.min(...nextStarts) : value.length;
    sections.set(section, value.slice(bodyStart, bodyEnd).trim());
  }
  return sections;
}

function renderRound2Sections(sections: Map<string, string>) {
  return ROUND2_SECTIONS.filter((section) => sections.has(section))
    .flatMap((section) => [`[${section}]`, sections.get(section) || '', ''])
    .join('\n')
    .trimEnd();
}

function truncateText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+\n/g, '\n').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function createStats(): CompressionStats {
  return { compressedSections: new Set(), droppedFields: new Set() };
}

function mergeStats(target: CompressionStats, source: CompressionStats) {
  for (const section of source.compressedSections) target.compressedSections.add(section);
  for (const field of source.droppedFields) target.droppedFields.add(field);
}
