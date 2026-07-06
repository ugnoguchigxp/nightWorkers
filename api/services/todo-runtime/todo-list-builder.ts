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
	status: "pending" | "running";
	procedureId: string | null;
	dependsOn: Array<string | number>;
	startedAt: Date | null;
};

type StandardGate = Omit<BuiltTodoInput, "seq" | "status" | "startedAt">;

const DATA_MIGRATION_PROCEDURE_IDS = new Set([
	"data_migration.create_migration",
	"data_migration.apply_migration",
	"data_migration.add_integration_test",
	"data_migration.verify_migration",
]);

const FIRST_GATES: StandardGate[] = [
	{
		title: "initial_instructions を実行する",
		description:
			"作業開始時に contextStill の initial_instructions MCP tool を最初に一度実行し、この作業で守るべき基本手順を確認する。",
		taskType: "initial_instructions",
		procedureId: "contextstill.initial_instructions",
		dependsOn: [],
	},
	{
		title: "context_compile を実行する",
		description:
			"read_current_specification と initial_instructions の後に context_compile MCP tool を実行し、仕様書と実作業 Todo に基づく最小コンテキストを取得する。",
		taskType: "context_compile",
		procedureId: "contextstill.context_compile",
		dependsOn: [1],
	},
];

const DATA_MIGRATION_GATES: StandardGate[] = [
	{
		title: "DB migration を作成する",
		description:
			"DB schema 変更が必要な場合は、既存の migration flow に従って migration ファイルまたは同等の schema 適用手順を作成する。",
		taskType: "data_migration",
		procedureId: "data_migration.create_migration",
		dependsOn: [],
	},
	{
		title: "DB migration を対象 DB に適用する",
		description:
			"作成した migration を実作業対象の DB に適用する。適用できない場合は完了扱いにせず block または fail にする。",
		taskType: "data_migration",
		procedureId: "data_migration.apply_migration",
		dependsOn: [],
	},
	{
		title: "DB migration を使う実 DB 統合テストを追加する",
		description:
			"migration が必要な機能実装では、既存 migration を一時 DB または隔離された test DB に適用し、実 DB 経路の作成・更新・SELECT・並び順などを確認する focused integration test を追加する。テスト内で schema を手書き再現せず、既存 DB を汚さない。",
		taskType: "test_change",
		procedureId: "data_migration.add_integration_test",
		dependsOn: [],
	},
	{
		title: "DB migration 後の schema と動作を検証する",
		description:
			"migration 適用後に schema 存在確認、関連 API smoke、または focused test を実行し、DB schema 変更と実 DB 統合テストが実行時に反映されていることを確認する。",
		taskType: "focused_verification",
		procedureId: "data_migration.verify_migration",
		dependsOn: [],
	},
];

const FINAL_GATES: StandardGate[] = [
	{
		title: "LLM コードレビューを実施する",
		description:
			"実装差分を LLM のコードレビュー観点で確認し、バグ、回帰、責務境界違反、テスト不足があれば修正する。",
		taskType: "review",
		procedureId: "llm_code_review",
		dependsOn: [],
	},
	{
		title: "品質ゲート verify コマンドを通す",
		description:
			"package.json に verify script がある場合は、このリポジトリ標準の verify コマンドを最優先で実行する。失敗した場合は原因を修正し、verify が成功するまで再実行する。verify script が無い、または環境制約で実行不能な場合だけ、typecheck / lint / test / build などの代替検証を明記して実行する。",
		taskType: "verification",
		procedureId: "quality_gate_verify",
		dependsOn: [],
	},
	{
		title: "知識登録を行う",
		description:
			"再利用可能な知識を register_candidates で登録し、必要な context_decision を処理する。compile_eval は完了報告直前の closeout 評価でのみ処理する。",
		taskType: "knowledge_capture",
		procedureId: "contextstill.register_candidates",
		dependsOn: [],
	},
	{
		title: "完了報告を行う",
		description: "実装内容、検証結果、残存リスクをユーザーに簡潔に報告する。",
		taskType: "completion_report",
		procedureId: "final_completion_report",
		dependsOn: [],
	},
];

export function buildStandardImplementationTodoList(input: {
	todos?: ImplementationTodoInput[];
	startFirst?: boolean;
	includeKnowledgeCapture?: boolean;
	requireDataMigrationGates?: boolean;
	now?: Date;
}): BuiltTodoInput[] {
	const now = input.now ?? new Date();
	const implementationTodos = normalizeImplementationTodos(
		input.todos ?? [],
		FIRST_GATES.length,
	);
	const dataMigrationGates =
		input.requireDataMigrationGates || hasDataMigrationTodo(input.todos ?? [])
			? DATA_MIGRATION_GATES
			: [];
	const finalGates =
		input.includeKnowledgeCapture === false
			? FINAL_GATES.filter(
					(todo) => todo.procedureId !== "contextstill.register_candidates",
				)
			: FINAL_GATES;
	const gatesAndTodos = [
		...FIRST_GATES,
		...implementationTodos,
		...dataMigrationGates,
		...finalGates,
	];
	const dataMigrationGateStartSeq =
		FIRST_GATES.length + implementationTodos.length + 1;
	const dataMigrationGateEndSeq =
		dataMigrationGateStartSeq + dataMigrationGates.length - 1;
	const finalGateStartSeq =
		FIRST_GATES.length +
		implementationTodos.length +
		dataMigrationGates.length +
		1;

	return gatesAndTodos.map((todo, index) => {
		const seq = index + 1;
		const dependsOn =
			todo.dependsOn.length === 0 &&
			(seq >= finalGateStartSeq ||
				(dataMigrationGates.length > 0 &&
					seq >= dataMigrationGateStartSeq &&
					seq <= dataMigrationGateEndSeq))
				? [seq - 1]
				: todo.dependsOn;
		const running = input.startFirst !== false && index === 0;
		return {
			...todo,
			seq,
			dependsOn,
			status: running ? "running" : "pending",
			startedAt: running ? now : null,
		};
	});
}

function normalizeImplementationTodos(
	todos: ImplementationTodoInput[],
	seqOffset: number,
): StandardGate[] {
	const eligibleTodos = todos
		.map((todo, index) => {
			if (!todo || typeof todo !== "object") {
				throw new Error(`Todo #${index + 1} must be an object.`);
			}
			return { todo, originalSeq: resolveOriginalSeq(todo, index) };
		})
		.filter(({ todo }) => !isReservedFinalGateTodo(todo));
	const seqMap = new Map(
		eligibleTodos.map(({ originalSeq }, index) => [
			originalSeq,
			seqOffset + index + 1,
		]),
	);

	return eligibleTodos.map(({ todo }, index) => {
		const title = typeof todo.title === "string" ? todo.title.trim() : "";
		const taskType =
			typeof todo.taskType === "string" && todo.taskType.trim().length > 0
				? todo.taskType.trim()
				: "implementation";
		if (!title) throw new Error(`Todo #${index + 1} requires title.`);
		return {
			title,
			description:
				typeof todo.description === "string" ? todo.description : null,
			taskType,
			procedureId:
				typeof todo.procedureId === "string" ? todo.procedureId : null,
			dependsOn: normalizeDependsOn(todo.dependsOn, seqMap),
		};
	});
}

function isReservedFinalGateTodo(todo: ImplementationTodoInput) {
	return (
		isReservedFirstGateTodo(todo) ||
		isReservedDataMigrationGateTodo(todo) ||
		isReservedReviewTodo(todo) ||
		isReservedCloseoutTodo(todo) ||
		isReservedBroadVerificationTodo(todo)
	);
}

function hasDataMigrationTodo(todos: ImplementationTodoInput[]) {
	return todos.some((todo) => {
		const taskType =
			typeof todo.taskType === "string" ? todo.taskType.trim() : "";
		const procedureId =
			typeof todo.procedureId === "string" ? todo.procedureId.trim() : "";
		return (
			taskType === "data_migration" ||
			taskType === "migration" ||
			procedureId === "data_migration" ||
			procedureId.startsWith("data_migration.")
		);
	});
}

function isReservedDataMigrationGateTodo(todo: ImplementationTodoInput) {
	const procedureId =
		typeof todo.procedureId === "string" ? todo.procedureId.trim() : "";

	return DATA_MIGRATION_PROCEDURE_IDS.has(procedureId);
}

function isReservedFirstGateTodo(todo: ImplementationTodoInput) {
	const title =
		typeof todo.title === "string" ? todo.title.trim().toLowerCase() : "";
	const normalizedTitle = title.replace(/\s+/g, "");
	const taskType =
		typeof todo.taskType === "string" ? todo.taskType.trim() : "";
	const procedureId =
		typeof todo.procedureId === "string" ? todo.procedureId.trim() : "";

	return (
		normalizedTitle === "initial_instructionsを実行する" ||
		normalizedTitle === "context_compileを実行する" ||
		taskType === "initial_instructions" ||
		taskType === "context_compile" ||
		procedureId === "contextstill.initial_instructions" ||
		procedureId === "contextstill.context_compile"
	);
}

function isReservedReviewTodo(todo: ImplementationTodoInput) {
	const title =
		typeof todo.title === "string" ? todo.title.trim().toLowerCase() : "";
	const normalizedTitle = title.replace(/\s+/g, "");
	const taskType =
		typeof todo.taskType === "string" ? todo.taskType.trim() : "";
	const procedureId =
		typeof todo.procedureId === "string" ? todo.procedureId.trim() : "";

	return (
		title === "llm code review" ||
		normalizedTitle === "llmコードレビューを実施する" ||
		taskType === "review" ||
		procedureId === "llm_code_review"
	);
}

function isReservedCloseoutTodo(todo: ImplementationTodoInput) {
	const title =
		typeof todo.title === "string" ? todo.title.trim().toLowerCase() : "";
	const taskType =
		typeof todo.taskType === "string" ? todo.taskType.trim() : "";
	const procedureId =
		typeof todo.procedureId === "string" ? todo.procedureId.trim() : "";

	return (
		title === "closeout" ||
		title === "close out" ||
		title === "クローズアウト" ||
		title === "知識登録を行う" ||
		title === "完了報告を行う" ||
		taskType === "closeout" ||
		taskType === "knowledge_capture" ||
		taskType === "completion_report" ||
		procedureId === "contextstill.register_candidates" ||
		procedureId === "final_completion_report" ||
		procedureId === "contextstill_closeout"
	);
}

function isReservedBroadVerificationTodo(todo: ImplementationTodoInput) {
	const title =
		typeof todo.title === "string" ? todo.title.trim().toLowerCase() : "";
	const taskType =
		typeof todo.taskType === "string" ? todo.taskType.trim() : "";
	const procedureId =
		typeof todo.procedureId === "string" ? todo.procedureId.trim() : "";

	return (
		title === "verify" ||
		title === "verification" ||
		title === "検証コマンドを実行する" ||
		title === "品質ゲート verify を実施する" ||
		title === "品質ゲート verify コマンドを通す" ||
		taskType === "verification" ||
		procedureId === "quality_gate_verify"
	);
}

function resolveOriginalSeq(todo: ImplementationTodoInput, index: number) {
	return typeof todo.seq === "number" &&
		Number.isInteger(todo.seq) &&
		todo.seq > 0
		? todo.seq
		: index + 1;
}

function normalizeDependsOn(
	dependsOn: ImplementationTodoInput["dependsOn"],
	seqMap: Map<number, number>,
) {
	if (!Array.isArray(dependsOn)) return [];

	const normalized: Array<string | number> = [];
	for (const value of dependsOn) {
		if (typeof value === "string") {
			normalized.push(value);
			continue;
		}
		if (typeof value !== "number") continue;

		const mapped = seqMap.get(value);
		if (mapped) normalized.push(mapped);
	}
	return normalized;
}
