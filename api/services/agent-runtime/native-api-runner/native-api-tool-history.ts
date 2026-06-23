import type { ProviderToolCall, ProviderToolMessage } from '../../structured-llm/tool-calls';
import type { AgentRunContext } from '../types';
import { readNativeApiExecutionMode } from './native-api-mode';
import { readNativeApiRoleWorkingContextText } from './native-api-role-context-events';

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
  const roleWorkingContext = readNativeApiRoleWorkingContextText(context);
  if (roleWorkingContext) {
    items.push({
      type: 'user',
      source: 'runtime',
      content: roleWorkingContext,
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
  const executionMode = readNativeApiExecutionMode(context);
  const planModeSettings = formatPlanModeSettingsSnapshot(
    context.runtimeOptions?.planModeSettingsSnapshot
  );
  return [
    'あなたは NightWorkers の native/API lane coding agent runtime です。',
    `executionMode: ${executionMode}`,
    ...(planModeSettings ? [`planModeSettings: ${planModeSettings}`] : []),
    'Codex 型の turn lifecycle / tool dispatch / cancellation discipline に従って実行します。',
    'Codex SDK lane へ fallback せず、SchemaFirst supervisor loop へ fallback しません。',
    'new_context tool は、会話履歴を要約せず次の provider turn から新しい context window を開始します。',
    'リポジトリの読み書きは登録済み Project の repo root を基準にし、worker tool handler 経由で行います。',
    '',
    'Tool choice guidance:',
    '- context_initial_instructions または context_compile を使う前に、必ず read_current_specification を成功させてください。',
    '- 仕様書、実装計画、artifact が source of truth です。これを読まずに contextStill へ進むと助言品質が落ちます。',
    '- 実作業前に context_initial_instructions が未実行なら、read_current_specification の後に呼び出すことを強く推奨します。',
    '- repo 固有の文脈、過去判断、実装境界、検証方針が必要な場合は read_current_specification の内容を踏まえて context_compile を使ってください。',
    '- todo_list operation=replace は TodoList の構造を再定義する再計画操作です。見積もり変更、スコープ変更、作業分解の粒度変更、実装中に新しい必須作業が判明した場合だけ使います。',
    '- running Todo がある状態で todo_list operation=replace を使う場合は todoListReplaceReason を必ず指定してください。現在の Todo が完了したことを表すために todo_list operation=replace を使ってはいけません。',
    '- todo_list operation=start/done/block/fail は既存 Todo の状態遷移です。Todo が終わったら todo_list operation=done を使ってください。todo_list operation=done は次の pending Todo を自動で running にします。',
    '- blocker、未完了 Todo、failed tests/review、ユーザー確認へ進む判断がある場合は context_decision を強く推奨します。',
    '- closeout では、context_compile を使った場合 compile_eval を検討し、再利用可能な知識があれば register_candidates を検討してください。',
    '- 推奨 tool を使わない場合は、finalReport でその理由を短く説明してください。',
    '',
    ...modeGuidance(executionMode),
    `repoRoot: ${context.repoRoot}`,
  ].join('\n');
}

function formatPlanModeSettingsSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const disabledCapabilities = (snapshot as { disabledCapabilities?: unknown })
    .disabledCapabilities;
  if (!Array.isArray(disabledCapabilities)) return null;
  return disabledCapabilities.length > 0
    ? `disabled=${disabledCapabilities.join(', ')}`
    : 'all enabled';
}

function modeGuidance(executionMode: ReturnType<typeof readNativeApiExecutionMode>) {
  if (executionMode === 'planning') {
    return [
      'Planning guidance:',
      '- 原則として実装・ファイル変更・project import は避け、調査結果に基づく実装計画を返してください。',
      '- ただし、ユーザーが実装開始を明示した場合、または計画中に実装へ進む合意が明確になった場合は、Todo を更新して implementation work に入って構いません。',
      '- mutation tool を使う場合は、その理由と根拠を finalReport に含めてください。',
      '- Planning is not closeout. 実装と検証が終わっていない場合、compile_eval は通常不要です。',
      '',
    ];
  }
  if (executionMode === 'review') {
    return [
      'Review guidance:',
      '- 変更差分、受け入れ条件、検証結果を確認し、バグ・回帰・責務境界違反・テスト不足を優先してください。',
      '- 必要に応じて git_diff、read_file、run_verification、context_compile を使って根拠を確認してください。',
      '- 修正が必要で明確な場合は、Todo を更新して実装修正 tool を使って構いません。',
      '',
    ];
  }
  if (executionMode === 'runtime_debug') {
    return [
      'Runtime debug guidance:',
      '- logs、DB 状態、runtime settings、直近 tool failure を優先して確認してください。',
      '- 原因が実装バグとして明確な場合は、Todo を更新して修正 tool を使って構いません。',
      '',
    ];
  }
  if (executionMode === 'general_answer') {
    return [
      'General answer guidance:',
      '- 原則として最小限の回答でよいですが、リポジトリ事実が必要な場合は read/search tools を使って確認してください。',
      '- コード変更が必要だと判断した場合は、その理由を明示して Todo を更新してから進めてください。',
      '',
    ];
  }
  return [
    'Implementation guidance:',
    '- 実装 Todo が running になった後は、plan-only answer や次ステップ列挙だけで停止しないでください。',
    '- 実装、必要な検証、必要な修正、closeout まで進めてください。明確な blocker がある場合は todo_list operation=block/fail を使って説明してください。',
    '- import_project を使った場合は、postImport payload と recommended verification command を優先してください。',
    '- コード変更後、package.json に verify script が存在する場合は、完了報告前の代表検証として verify command を最優先で実行してください。typecheck / lint / test / build の個別実行は、修正途中の focused check、または verify script が存在しない・実行不能な場合の fallback としてください。',
    '',
  ];
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
