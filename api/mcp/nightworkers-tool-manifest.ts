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
    .describe('NightWorkers task id. Defaults to NIGHTWORKERS_TASK_ID when available.'),
});

export const nightWorkersListRecentSpecificationsInputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().describe('Maximum results. Default: 10.'),
});

export const nightWorkersTodoListInputSchema = z.object({
  runId: z
    .string()
    .trim()
    .optional()
    .describe('NightWorkers run id. Defaults to NIGHTWORKERS_RUN_ID when available.'),
  operation: z
    .enum(['list', 'replace', 'start', 'done', 'block', 'fail'])
    .describe(
      'Todo operation to perform. list is read-only diagnostics and does not advance progress; use replace/start/done/block/fail for progress.'
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
      'Run Todos decomposed by the LLM. Use taskType to distinguish inspection, implementation, and focused verification work. Fixed quality gates are added automatically.'
    ),
  startFirst: z
    .boolean()
    .optional()
    .describe('Whether the first fixed gate starts as running. Default: true.'),
});

export const nightWorkersImportProjectInputSchema = z.object({
  taskId: z
    .string()
    .trim()
    .optional()
    .describe('NightWorkers task id. Defaults to NIGHTWORKERS_TASK_ID when available.'),
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
      'Run dependency initialization after import when package.json is present. Default: true.'
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
      'Maintain the current run TodoList with one JSON operation. Use operation=replace, start, done, block, or fail for progress. operation=list is read-only diagnostics and does not advance progress. replace refreshes the plan without reopening terminal Todos; done automatically starts the next pending Todo.',
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

export function getNightWorkersCodexToolNames() {
  return Object.keys(nightWorkersCodexToolManifest).map((tool) => `nightworkers.${tool}`);
}

export function buildNightWorkersCodexToolApprovalConfig() {
  return Object.fromEntries(
    Object.entries(nightWorkersCodexToolManifest).map(([name, definition]) => [
      name,
      { approval_mode: definition.approvalMode },
    ])
  );
}

export function buildNightWorkersCodexToolConfigLines() {
  return Object.entries(nightWorkersCodexToolManifest).flatMap(([name, definition]) => [
    '',
    `[mcp_servers.nightworkers.tools.${name}]`,
    `approval_mode = "${definition.approvalMode}"`,
  ]);
}

export function toNightWorkersJsonSchema(schema: z.ZodTypeAny) {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _ignored, ...rest } = jsonSchema;
  return rest;
}
