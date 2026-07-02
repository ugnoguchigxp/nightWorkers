import { z } from 'zod';

export const nightWorkersTodoTaskTypes = [
  'implementation',
  'inspection',
  'investigation',
  'scaffold',
  'focused_verification',
  'verification',
  'review',
  'code_edit',
  'code_change',
  'test',
  'test_change',
  'documentation',
  'docs',
  'migration',
  'data_migration',
  'config',
  'dependency',
  'refactor',
  'import',
  'copy',
  'git',
  'release',
] as const;

export const nightWorkersReadCurrentSpecificationInputSchema = z.object({
  taskId: z
    .string()
    .trim()
    .optional()
    .describe('NightWorkers task id. Defaults to request-scoped task context when available.'),
});

export const nightWorkersListRecentSpecificationsInputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().describe('Maximum results. Default: 10.'),
});

export const nightWorkersTodoListInputSchema = z.object({
  runId: z
    .string()
    .trim()
    .optional()
    .describe('NightWorkers run id. Defaults to request-scoped run context when available.'),
  operation: z
    .enum(['list', 'replace', 'start', 'done', 'block', 'fail'])
    .describe(
      'Todo operation to perform. list is read-only diagnostics. todo_list operation=replace structurally replans the TodoList. todo_list operation=start/done/block/fail transitions existing Todo state.'
    ),
  seq: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Todo seq for start/done/block/fail. done may omit seq to complete the current running Todo.'
    ),
  todos: z
    .array(
      z.object({
        seq: z.number().int().positive(),
        title: z.string().trim().min(1),
        description: z.string().optional(),
        taskType: z.enum(nightWorkersTodoTaskTypes).optional(),
        procedureId: z.string().trim().min(1).nullable().optional(),
        dependsOn: z
          .array(z.union([z.number().int().positive(), z.string().trim().min(1)]))
          .nullable()
          .optional(),
      })
    )
    .optional()
    .describe(
      'Run Todos decomposed by the LLM. Use taskType to distinguish inspection, implementation, and focused verification work. Fixed quality gates are added automatically. For DB schema changes, mark migration work with taskType=data_migration or procedureId=data_migration.create_migration / data_migration.apply_migration / data_migration.add_integration_test / data_migration.verify_migration so required migration gates are preserved.'
    ),
  startFirst: z
    .boolean()
    .optional()
    .describe('Whether the first fixed gate starts as running. Default: true.'),
  todoListReplaceReason: z
    .enum([
      'initial_plan',
      'scope_changed',
      'estimate_changed',
      'newly_required_work',
      'blocked_replan',
    ])
    .optional()
    .describe(
      'Required with todo_list operation=replace when a Todo is already running. Do not use this with todo_list operation=start/done/block/fail.'
    ),
});

export const nightWorkersImportProjectInputSchema = z.object({
  taskId: z
    .string()
    .trim()
    .optional()
    .describe('NightWorkers task id. Defaults to request-scoped task context when available.'),
  runId: z
    .string()
    .trim()
    .optional()
    .describe(
      'NightWorkers run id. Used to resolve the task repository when taskId is not available.'
    ),
  source: z
    .enum(['starter', 'git'])
    .optional()
    .describe(
      'Choose starter for a registered scaffold or git for an arbitrary repository import.'
    ),
  stack: z
    .enum(['hono', 'python'])
    .optional()
    .describe('Starter stack. Optional when the default Hono stack is acceptable.'),
  repoUrl: z.string().trim().optional().describe('Git repository URL or local git path.'),
  variant: z
    .string()
    .trim()
    .optional()
    .describe('Starter variant, e.g. sqlite, postgres, rag, or auth.'),
  overlays: z
    .array(z.string().trim().min(1))
    .optional()
    .describe('Optional overlay refs such as ssr or ssg.'),
  targetPath: z
    .string()
    .trim()
    .optional()
    .describe('Project-root-relative target path. Defaults to the Project root.'),
  overwrite: z
    .boolean()
    .optional()
    .describe('Allow writing into a non-empty target only when replacement is intended.'),
  exclude: z.array(z.string().trim().min(1)).optional().describe('Extra paths to exclude.'),
  ref: z
    .string()
    .trim()
    .optional()
    .describe('Optional Git branch, tag, or commit when repoUrl is used.'),
  depth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Shallow clone depth when repoUrl is used and ref is omitted.'),
  stripGitDir: z
    .boolean()
    .optional()
    .describe('Remove nested .git metadata when repoUrl is used. Default: true.'),
  initialize: z
    .boolean()
    .optional()
    .describe(
      'Run package bootstrap after git init for starter templates. Arbitrary Git imports fall back to dependency initialization when bootstrap is absent. Default: true.'
    ),
});

export const nightWorkersCodexToolManifest = {
  read_current_specification: {
    title: 'Read Current Specification',
    description:
      'Read the latest NightWorkers draft specification markdown for a task. This is read-only and does not edit project files.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    approvalMode: 'approve',
    inputSchema: nightWorkersReadCurrentSpecificationInputSchema,
  },
  list_recent_specifications: {
    title: 'List Recent Specifications',
    description:
      'List recent NightWorkers draft specifications with task ids so Codex can choose the right task before reading the full specification.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    approvalMode: 'approve',
    inputSchema: nightWorkersListRecentSpecificationsInputSchema,
  },
  todo_list: {
    title: 'Todo List',
    description:
      'Maintain the current run TodoList with one JSON operation. todo_list operation=replace structurally replans the TodoList and requires todoListReplaceReason when a Todo is already running. todo_list operation=start/done/block/fail transitions existing Todo state. todo_list operation=done automatically starts the next pending Todo.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    approvalMode: 'approve',
    inputSchema: nightWorkersTodoListInputSchema,
  },
  import_project: {
    title: 'Import Project',
    description:
      'Single import entrypoint for NightWorkers projects. Use source=starter with stack/variant for new scaffolds, or source=git with repoUrl for arbitrary Git repositories.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    approvalMode: 'approve',
    inputSchema: nightWorkersImportProjectInputSchema,
  },
} as const;

export type NightWorkersCodexToolName = keyof typeof nightWorkersCodexToolManifest;
export type NightWorkersCodexToolExecutionMode =
  | 'planning'
  | 'implementation'
  | 'review'
  | 'runtime_debug'
  | 'general_answer';

const PLAN_MODE_READ_ONLY_CODEX_TOOLS = new Set<NightWorkersCodexToolName>([
  'read_current_specification',
  'list_recent_specifications',
]);

export function getNightWorkersCodexToolNames(input: { executionMode?: string } = {}) {
  return Object.keys(nightWorkersCodexToolManifest)
    .filter((tool): tool is NightWorkersCodexToolName =>
      isNightWorkersCodexToolAllowedForMode(tool as NightWorkersCodexToolName, input.executionMode)
    )
    .map((tool) => `nightworkers.${tool}`);
}

export function buildNightWorkersCodexToolApprovalConfig(input: { executionMode?: string } = {}) {
  return Object.fromEntries(
    Object.entries(nightWorkersCodexToolManifest)
      .filter(([name]) =>
        isNightWorkersCodexToolAllowedForMode(
          name as NightWorkersCodexToolName,
          input.executionMode
        )
      )
      .map(([name, definition]) => [name, { approval_mode: definition.approvalMode }])
  );
}

export function buildNightWorkersCodexToolConfigLines(input: { executionMode?: string } = {}) {
  return Object.entries(nightWorkersCodexToolManifest)
    .filter(([name]) =>
      isNightWorkersCodexToolAllowedForMode(name as NightWorkersCodexToolName, input.executionMode)
    )
    .flatMap(([name, definition]) => [
      '',
      `[mcp_servers.nightworkers.tools.${name}]`,
      `approval_mode = "${definition.approvalMode}"`,
    ]);
}

export function isNightWorkersCodexToolAllowedForMode(
  tool: NightWorkersCodexToolName,
  executionMode?: string
) {
  if (executionMode !== 'planning') return true;
  return PLAN_MODE_READ_ONLY_CODEX_TOOLS.has(tool);
}

export function toNightWorkersJsonSchema(schema: z.ZodTypeAny) {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _ignored, ...rest } = jsonSchema;
  return rest;
}
