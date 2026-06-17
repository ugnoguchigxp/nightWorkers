import type { ProviderToolCall, ProviderToolMessage } from '../../structured-llm/tool-calls';
import type { AgentRunContext } from '../types';

export type NativeApiUserSource = 'user' | 'runtime' | 'todo' | 'state_card';

export type NativeApiToolResult = {
  ok: boolean;
  content: string;
  payload?: unknown;
  error?: {
    code?: string;
    message: string;
    details?: unknown;
  };
};

export type NativeApiHistoryItem =
  | { type: 'system'; content: string }
  | { type: 'user'; content: string; source: NativeApiUserSource }
  | { type: 'assistant'; content: string; toolCalls?: ProviderToolCall[] }
  | { type: 'tool_result'; toolCallId: string; toolName: string; result: NativeApiToolResult };

export function buildInitialNativeApiHistory(context: AgentRunContext): NativeApiHistoryItem[] {
  const userMessage = context.latestUserMessage || context.compiledPrompt;
  const items: NativeApiHistoryItem[] = [
    { type: 'system', content: buildNativeApiSystemPrompt(context) },
    { type: 'user', source: 'user', content: userMessage },
  ];
  const currentTodo = context.currentTodo;
  if (currentTodo) {
    items.push({
      type: 'user',
      source: 'todo',
      content: renderCurrentTodoContext(currentTodo),
    });
  }
  return items;
}

export function projectNativeApiHistoryToProviderMessages(
  history: readonly NativeApiHistoryItem[]
): ProviderToolMessage[] {
  const systemPrompt = history
    .filter((item): item is Extract<NativeApiHistoryItem, { type: 'system' }> => {
      return item.type === 'system' && item.content.trim().length > 0;
    })
    .map((item) => item.content.trim())
    .join('\n\n');
  const messages: ProviderToolMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }]
    : [];

  for (const item of history) {
    if (item.type === 'system') continue;
    if (item.type === 'user') {
      messages.push({ role: 'user', content: item.content });
      continue;
    }
    if (item.type === 'assistant') {
      messages.push({
        role: 'assistant',
        content: item.content,
        ...(item.toolCalls?.length ? { toolCalls: item.toolCalls } : {}),
      });
      continue;
    }
    messages.push({
      role: 'tool',
      toolCallId: item.toolCallId,
      content: item.result.content,
    });
  }

  return messages;
}

export function extractNativeApiSystemPrompt(history: readonly NativeApiHistoryItem[]) {
  return history
    .filter((item): item is Extract<NativeApiHistoryItem, { type: 'system' }> => {
      return item.type === 'system' && item.content.trim().length > 0;
    })
    .map((item) => item.content.trim())
    .join('\n\n');
}

export function extractLatestNativeApiUserPrompt(history: readonly NativeApiHistoryItem[]) {
  const userItems = history.filter(
    (item): item is Extract<NativeApiHistoryItem, { type: 'user' }> => item.type === 'user'
  );
  return userItems.at(-1)?.content ?? '';
}

function buildNativeApiSystemPrompt(context: AgentRunContext) {
  return [
    'あなたは NightWorkers の native/API lane coding agent runtime です。',
    'Codex 型の turn lifecycle / tool dispatch / cancellation discipline に従って実行します。',
    'Codex SDK lane へ fallback せず、SchemaFirst supervisor loop へ fallback しません。',
    'new_context tool は、会話履歴を要約せず次の provider turn から新しい context window を開始します。',
    'リポジトリの読み書きは登録済み Project の repo root を基準にし、worker tool handler 経由で行います。',
    `repoRoot: ${context.repoRoot}`,
  ].join('\n');
}

function renderCurrentTodoContext(currentTodo: NonNullable<AgentRunContext['currentTodo']>) {
  return [
    '[Current Native API Runner Todo]',
    `seq=${currentTodo.seq}`,
    `title=${currentTodo.title}`,
    `taskType=${currentTodo.taskType}`,
    `procedureId=${currentTodo.procedureId ?? 'none'}`,
    `status=${currentTodo.status}`,
  ].join('\n');
}
