export type ImplementationTodoInput = {
  seq?: number;
  title: string;
  description?: string | null;
  taskType?: string;
  procedureId?: string | null;
  dependsOn?: Array<string | number> | null;
};

export type BuiltTodoInput = {
  seq: number;
  title: string;
  description: string | null;
  taskType: string;
  status: 'pending' | 'running';
  procedureId: string | null;
  dependsOn: Array<string | number>;
  startedAt: Date | null;
};

type StandardGate = Omit<BuiltTodoInput, 'seq' | 'status' | 'startedAt'>;

const FIRST_GATES: StandardGate[] = [
  {
    title: 'initial_instructions を実行する',
    description:
      '作業開始時に contextStill の initial_instructions MCP tool を最初に一度実行し、この作業で守るべき基本手順を確認する。',
    taskType: 'initial_instructions',
    procedureId: 'contextstill.initial_instructions',
    dependsOn: [],
  },
  {
    title: 'context_compile を実行する',
    description:
      'initial_instructions の後に context_compile MCP tool を実行し、今回の実装に必要な最小コンテキストを取得する。',
    taskType: 'context_compile',
    procedureId: 'contextstill.context_compile',
    dependsOn: [1],
  },
];

const FINAL_GATES: StandardGate[] = [
  {
    title: 'LLM コードレビューを実施する',
    description:
      '実装差分を LLM のコードレビュー観点で確認し、バグ、回帰、責務境界違反、テスト不足があれば修正する。',
    taskType: 'review',
    procedureId: 'llm_code_review',
    dependsOn: [],
  },
  {
    title: '品質ゲート verify を実施する',
    description:
      '型、テスト、ビルド、OpenAPI など、このリポジトリの標準 verify gate を実行し、失敗があれば修正する。',
    taskType: 'verification',
    procedureId: 'quality_gate_verify',
    dependsOn: [],
  },
  {
    title: '知識登録と closeout を実施する',
    description:
      '再利用可能な知識を register_candidates で登録し、必要な context_decision を処理してから closeout に進む。compile_eval は完了報告直前の closeout でのみ実行する。',
    taskType: 'knowledge_capture',
    procedureId: 'contextstill_closeout',
    dependsOn: [],
  },
];

export function buildStandardImplementationTodoList(input: {
  todos?: ImplementationTodoInput[];
  startFirst?: boolean;
  now?: Date;
}): BuiltTodoInput[] {
  const now = input.now ?? new Date();
  const implementationTodos = normalizeImplementationTodos(input.todos ?? [], FIRST_GATES.length);
  const gatesAndTodos = [...FIRST_GATES, ...implementationTodos, ...FINAL_GATES];
  const finalGateStartSeq = FIRST_GATES.length + implementationTodos.length + 1;

  return gatesAndTodos.map((todo, index) => {
    const seq = index + 1;
    const dependsOn =
      seq >= finalGateStartSeq && todo.dependsOn.length === 0 ? [seq - 1] : todo.dependsOn;
    const running = input.startFirst !== false && index === 0;
    return {
      ...todo,
      seq,
      dependsOn,
      status: running ? 'running' : 'pending',
      startedAt: running ? now : null,
    };
  });
}

function normalizeImplementationTodos(
  todos: ImplementationTodoInput[],
  seqOffset: number
): StandardGate[] {
  return todos.map((todo, index) => {
    if (!todo || typeof todo !== 'object') {
      throw new Error(`Todo #${index + 1} must be an object.`);
    }
    const title = typeof todo.title === 'string' ? todo.title.trim() : '';
    const taskType =
      typeof todo.taskType === 'string' && todo.taskType.trim().length > 0
        ? todo.taskType.trim()
        : 'implementation';
    if (!title) throw new Error(`Todo #${index + 1} requires title.`);
    return {
      title,
      description: typeof todo.description === 'string' ? todo.description : null,
      taskType,
      procedureId: typeof todo.procedureId === 'string' ? todo.procedureId : null,
      dependsOn: normalizeDependsOn(todo.dependsOn, seqOffset),
    };
  });
}

function normalizeDependsOn(dependsOn: ImplementationTodoInput['dependsOn'], seqOffset: number) {
  return Array.isArray(dependsOn)
    ? dependsOn
        .filter(
          (value): value is string | number =>
            typeof value === 'string' || typeof value === 'number'
        )
        .map((value) => (typeof value === 'number' ? value + seqOffset : value))
    : [];
}
