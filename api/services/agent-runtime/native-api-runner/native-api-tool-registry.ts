import type { ProviderToolDefinition } from '../../structured-llm/tool-calls';
import type { WorkerToolName } from '../../tool-policy/types';

export type NativeApiRuntimeToolName =
  | WorkerToolName
  | 'todo_list'
  | 'context_compile'
  | 'new_context'
  | 'finalize_answer';

export type NativeApiToolKind =
  | 'worker'
  | 'todo_control'
  | 'context_still'
  | 'context_window'
  | 'terminal';

export type NativeApiToolRegistration = {
  name: NativeApiRuntimeToolName;
  kind: NativeApiToolKind;
  workerToolName?: WorkerToolName;
  definition: ProviderToolDefinition;
};

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
  additionalProperties = false
) => ({
  type: 'object',
  properties,
  required,
  additionalProperties,
});

const workerToolDefinitions: NativeApiToolRegistration[] = [
  {
    name: 'read_current_specification',
    kind: 'worker',
    workerToolName: 'read_current_specification',
    definition: {
      name: 'read_current_specification',
      description: 'Read the latest NightWorkers task specification before context compilation.',
      inputSchema: objectSchema({}),
    },
  },
  {
    name: 'list_dir',
    kind: 'worker',
    workerToolName: 'list_dir',
    definition: {
      name: 'list_dir',
      description: 'List files and directories under the repository root.',
      inputSchema: objectSchema({
        relativePath: { type: 'string' },
        recursive: { type: 'boolean' },
        maxEntries: { type: 'number' },
      }),
    },
  },
  {
    name: 'read_file',
    kind: 'worker',
    workerToolName: 'read_file',
    definition: {
      name: 'read_file',
      description: 'Read a file from the repository root.',
      inputSchema: objectSchema(
        {
          filePath: { type: 'string' },
          startLine: { type: 'number' },
          endLine: { type: 'number' },
          fresh: { type: 'boolean' },
        },
        ['filePath']
      ),
    },
  },
  {
    name: 'search_files',
    kind: 'worker',
    workerToolName: 'search_files',
    definition: {
      name: 'search_files',
      description: 'Search repository files for a text query.',
      inputSchema: objectSchema(
        {
          query: { type: 'string' },
          glob: { type: 'string' },
        },
        ['query']
      ),
    },
  },
  {
    name: 'apply_patch',
    kind: 'worker',
    workerToolName: 'apply_patch',
    definition: {
      name: 'apply_patch',
      description: 'Apply a unified patch to repository files.',
      inputSchema: objectSchema({ patchContent: { type: 'string' } }, ['patchContent']),
    },
  },
  {
    name: 'replace_content',
    kind: 'worker',
    workerToolName: 'replace_content',
    definition: {
      name: 'replace_content',
      description: 'Replace file content using a literal or regex needle.',
      inputSchema: objectSchema(
        {
          filePath: { type: 'string' },
          needle: { type: 'string' },
          replacement: { type: 'string' },
          mode: { type: 'string', enum: ['literal', 'regex'] },
          allowMultipleOccurrences: { type: 'boolean' },
        },
        ['filePath', 'needle', 'replacement']
      ),
    },
  },
  {
    name: 'import_project',
    kind: 'worker',
    workerToolName: 'import_project',
    definition: {
      name: 'import_project',
      description:
        'Import a starter scaffold or Git repository into the project. Use this as the only project import entrypoint.',
      inputSchema: objectSchema({
        source: { type: 'string', enum: ['starter', 'git'] },
        stack: { type: 'string', enum: ['hono', 'python'] },
        variant: { type: 'string' },
        overlays: { type: 'array', items: { type: 'string' } },
        repoUrl: { type: 'string' },
        ref: { type: 'string' },
        depth: { type: 'number' },
        targetPath: { type: 'string' },
        overwrite: { type: 'boolean' },
        stripGitDir: { type: 'boolean' },
        exclude: { type: 'array', items: { type: 'string' } },
        initialize: { type: 'boolean' },
      }),
    },
  },
  {
    name: 'run_verification',
    kind: 'worker',
    workerToolName: 'run_verification',
    definition: {
      name: 'run_verification',
      description: 'Run a verification command such as typecheck or tests.',
      inputSchema: objectSchema(
        {
          command: { type: 'string' },
          reason: { type: 'string' },
          cwd: { type: 'string' },
          timeoutSeconds: { type: 'number' },
        },
        ['command', 'reason']
      ),
    },
  },
  {
    name: 'git_diff',
    kind: 'worker',
    workerToolName: 'git_diff',
    definition: {
      name: 'git_diff',
      description: 'Inspect the current repository diff.',
      inputSchema: objectSchema({}),
    },
  },
];

const nativeApiToolRegistrations: NativeApiToolRegistration[] = [
  ...workerToolDefinitions,
  {
    name: 'context_compile',
    kind: 'context_still',
    definition: {
      name: 'context_compile',
      description:
        'Compile task context after reading the current specification. Requires a concrete goal.',
      inputSchema: objectSchema(
        {
          goal: { type: 'string', minLength: 1 },
          domains: { type: 'array', items: { type: 'string' } },
          technologies: { type: 'array', items: { type: 'string' } },
          changeTypes: { type: 'array', items: { type: 'string' } },
        },
        ['goal']
      ),
    },
  },
  {
    name: 'new_context',
    kind: 'context_window',
    definition: {
      name: 'new_context',
      description: 'Start a new context window without summarizing conversation history.',
      inputSchema: objectSchema({}),
    },
  },
  {
    name: 'todo_list',
    kind: 'todo_control',
    definition: {
      name: 'todo_list',
      description: 'Mutate Todo progress. Listing Todos is internal and not model-visible.',
      inputSchema: objectSchema(
        {
          operation: { type: 'string', enum: ['replace', 'start', 'done', 'block', 'fail'] },
          seq: { type: 'number' },
          todos: { type: 'array' },
          startFirst: { type: 'boolean' },
        },
        ['operation']
      ),
    },
  },
  {
    name: 'finalize_answer',
    kind: 'terminal',
    definition: {
      name: 'finalize_answer',
      description:
        'Finalize the native API runner after all Todos and required gates are complete.',
      inputSchema: objectSchema(
        {
          finalReport: { type: 'string' },
          summary: { type: 'string' },
        },
        ['finalReport']
      ),
    },
  },
];

export function getNativeApiToolDefinitions(): ProviderToolDefinition[] {
  return nativeApiToolRegistrations.map((registration) => registration.definition);
}

export function getNativeApiToolRegistration(name: string): NativeApiToolRegistration | undefined {
  return nativeApiToolRegistrations.find((registration) => registration.name === name);
}
