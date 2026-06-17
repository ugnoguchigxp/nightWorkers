import {
  getExecutableWorkerToolName,
  type SupervisorToolName,
  type ToolDefinition,
  toolRegistry,
} from '../../supervisor/prompt-tool-registry';
import type { WorkerToolName } from '../../tool-policy/types';

export const nativeToolRuntimeToolNames = [
  'list_dir',
  'read_current_specification',
  'context_compile',
  'read_file',
  'search_files',
  'apply_patch',
  'replace_content',
  'run_verification',
  'todo_list',
  'finalize_answer',
] as const satisfies readonly (SupervisorToolName | 'context_compile')[];

export type NativeToolRuntimeToolName = (typeof nativeToolRuntimeToolNames)[number];

export type NativeToolRuntimeToolKind = 'worker' | 'context_still' | 'todo_control' | 'terminal';

export type NativeToolRuntimeToolClassification =
  | { kind: 'worker'; workerToolName: WorkerToolName }
  | { kind: 'context_still'; mcpToolName: 'context_compile' }
  | { kind: 'todo_control' }
  | { kind: 'terminal' };

export type ProviderNativeToolDefinition = {
  name: NativeToolRuntimeToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  kind: NativeToolRuntimeToolKind;
  workerToolName?: WorkerToolName;
};

const nativeToolRuntimeToolNameSet = new Set<string>(nativeToolRuntimeToolNames);

export function isNativeToolRuntimeToolName(name: string): name is NativeToolRuntimeToolName {
  return nativeToolRuntimeToolNameSet.has(name);
}

export function classifyNativeToolRuntimeTool(
  name: NativeToolRuntimeToolName
): NativeToolRuntimeToolClassification {
  if (name === 'finalize_answer') return { kind: 'terminal' };
  if (name === 'todo_list') return { kind: 'todo_control' };
  if (name === 'context_compile') return { kind: 'context_still', mcpToolName: name };
  const workerToolName = getExecutableWorkerToolName(name);
  if (!workerToolName) {
    throw new Error(`Native tool runtime tool is not executable by worker dispatcher: ${name}`);
  }
  return { kind: 'worker', workerToolName };
}

export function getProviderNativeToolDefinition(
  name: NativeToolRuntimeToolName
): ProviderNativeToolDefinition {
  if (name === 'context_compile') {
    return {
      name,
      description:
        'contextStill の context_compile MCP tool を実行する。必ず read_current_specification で仕様書を読み、作業対象と実装方針を理解した後に、仕様タイトル/要約/対象ファイル候補を含む具体的な goal を渡す。空オブジェクトや空 goal では呼ばない。',
      inputSchema: objectSchema(
        {
          goal: { type: 'string', minLength: 1 },
          changeTypes: { type: 'array', items: { type: 'string', minLength: 1 } },
          technologies: { type: 'array', items: { type: 'string', minLength: 1 } },
          domains: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
        ['goal']
      ),
      kind: 'context_still',
    };
  }
  const tool = toolRegistry[name];
  return toProviderNativeToolDefinition(tool);
}

export function getProviderNativeToolDefinitions(
  names: readonly NativeToolRuntimeToolName[] = nativeToolRuntimeToolNames
): ProviderNativeToolDefinition[] {
  return names.map(getProviderNativeToolDefinition);
}

function toProviderNativeToolDefinition(tool: ToolDefinition): ProviderNativeToolDefinition {
  if (!isNativeToolRuntimeToolName(tool.name)) {
    throw new Error(`Tool is not allowed in native tool runtime: ${tool.name}`);
  }
  const classification = classifyNativeToolRuntimeTool(tool.name);
  return {
    name: tool.name,
    description: buildNativeToolRuntimeDescription(tool),
    inputSchema: cloneJsonSchema(tool.inputSchema),
    kind: classification.kind,
    ...(classification.kind === 'worker' ? { workerToolName: classification.workerToolName } : {}),
  };
}

function buildNativeToolRuntimeDescription(tool: ToolDefinition): string {
  const base = tool.description;
  if (tool.name === 'list_dir') {
    return `${base} ファイル構成確認は run_verification ではなくこの tool を使う。node_modules など巨大ディレクトリを探索しない。`;
  }
  if (tool.name === 'apply_patch') {
    return [
      base,
      '新規ファイル作成は必ず次の専用形式を使う: *** Begin Patch / *** Add File: path / +content / *** End Patch。',
      'hunk だけ、header なし diff、cat/heredoc、mkdir、shell redirection は使わない。',
      '親ディレクトリがない場合も Add File patch で作成対象 path を指定する。',
    ].join(' ');
  }
  if (tool.name === 'run_verification') {
    return [
      base,
      '検証専用。ファイル作成、mkdir、cat > file、heredoc、&&、||、; などの shell write/chained syntax を使わない。',
      'ファイル確認は list_dir/read_file、編集は apply_patch/replace_content を使う。',
    ].join(' ');
  }
  if (tool.name === 'todo_list') {
    return `${base} operation は replace/start/done/block/fail のみ。list は使えない。contextStill gate Todo は runtime が自動処理するため手動で passed にしない。`;
  }
  return base;
}

function cloneJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: 'object',
    required,
    properties,
    additionalProperties: false,
  };
}
