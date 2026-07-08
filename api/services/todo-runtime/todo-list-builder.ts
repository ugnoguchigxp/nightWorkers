import { normalizeTodoTaskTypeForStorage } from "./task-types";

export type ImplementationTodoInput = {
	seq?: number;
	title: string;
	description?: string | null;
	taskType?: string;
	procedureId?: string | null;
	dependsOn?: Array<string | number> | null;
};

export type TodoVerificationPolicy = {
	suppressE2eTodos: boolean;
	source: "questionnaire_unit_primary" | "default";
	reason?: string | null;
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
		title: "DB migration を実行する",
		description:
			"DB schema 変更が必要な場合は、この Todo の中で migration ファイル作成、実作業対象 DB への migration command 実行、既存 migration を使う read-only focused test / smoke 実装、その test / API / schema 確認の実行まで行う。対象 DB が不明、実 DB へ未適用、または API が no such table 等で失敗する場合は done にせず block / fail にする。隔離 DB や一時 DB の smoke は補助証跡であり、実作業対象 DB への適用確認の代替にしない。",
		taskType: "data_migration",
		procedureId: "data_migration.apply_migration",
		dependsOn: [],
	},
];

const FINAL_GATES: StandardGate[] = [
	{
		title: "品質ゲート verify コマンドを通す",
		description:
			"package.json に verify script がある場合は、このリポジトリ標準の verify コマンドを最優先で実行する。失敗した場合は原因を修正し、verify が成功するまで再実行する。verify script が無い、または環境制約で実行不能な場合だけ、typecheck / lint / test / build などの代替検証を明記して実行する。",
		taskType: "verification",
		procedureId: "quality_gate_verify",
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
	requireDataMigrationGates?: boolean;
	verificationPolicy?: TodoVerificationPolicy | null;
	now?: Date;
}): BuiltTodoInput[] {
	const now = input.now ?? new Date();
	const sourceTodos = applyTodoVerificationPolicy(
		input.todos ?? [],
		input.verificationPolicy ?? null,
	);
	const implementationTodos = normalizeImplementationTodos(
		sourceTodos,
		FIRST_GATES.length,
	);
	const dataMigrationGates =
		input.requireDataMigrationGates || hasDataMigrationTodo(sourceTodos)
			? DATA_MIGRATION_GATES
			: [];
	const gatesAndTodos = [
		...FIRST_GATES,
		...implementationTodos,
		...dataMigrationGates,
		...FINAL_GATES,
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

export function deriveTodoVerificationPolicyFromPromptText(
	text: string,
): TodoVerificationPolicy {
	const compactText = text.replace(/\s+/g, " ");
	const unitPrimarySelected =
		compactText.includes("unit を主軸にする") ||
		compactText.includes("unit 主軸") ||
		compactText.includes("unit主軸");
	const e2ePrimarySelected =
		compactText.includes("E2E を主軸にする") ||
		compactText.includes("E2E 主軸") ||
		compactText.includes("E2E主軸");
	if (unitPrimarySelected && !e2ePrimarySelected) {
		return {
			suppressE2eTodos: true,
			source: "questionnaire_unit_primary",
			reason:
				"Questionnaire selected unit as the primary verification strategy.",
		};
	}
	return {
		suppressE2eTodos: false,
		source: "default",
		reason: null,
	};
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
		const taskType = normalizeTodoTaskTypeForStorage(todo.taskType);
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

function applyTodoVerificationPolicy(
	todos: ImplementationTodoInput[],
	policy: TodoVerificationPolicy | null,
) {
	if (!policy?.suppressE2eTodos) return todos;
	return todos
		.map((todo) => normalizeUnitPrimaryTodo(todo))
		.filter((todo): todo is ImplementationTodoInput => todo !== null);
}

function normalizeUnitPrimaryTodo(
	todo: ImplementationTodoInput,
): ImplementationTodoInput | null {
	if (typeof todo.title !== "string") return todo;
	const title = todo.title.trim();
	const description = todo.description?.trim() || null;
	const originalText = [title, description, todo.taskType, todo.procedureId]
		.filter((value): value is string => typeof value === "string")
		.join(" ");
	if (!containsE2e(originalText)) return todo;
	const strippedTitle = stripE2eScope(title).trim();
	const strippedDescription =
		description === null
			? null
			: stripE2eScope(description).replace(/\s+/g, " ").trim();
	const searchableWithoutE2e = [
		strippedTitle,
		strippedDescription,
		typeof todo.procedureId === "string"
			? stripE2eScope(todo.procedureId)
			: null,
	]
		.filter((value): value is string => Boolean(value))
		.join(" ");
	if (!hasConcreteNonE2eScope(searchableWithoutE2e)) return null;
	return {
		...todo,
		title: strippedTitle || title,
		description: strippedDescription || description,
		taskType:
			typeof todo.taskType === "string" &&
			todo.taskType.trim().toLowerCase() === "e2e"
				? "test_change"
				: todo.taskType,
		procedureId:
			typeof todo.procedureId === "string" && containsE2e(todo.procedureId)
				? null
				: todo.procedureId,
	};
}

function containsE2e(value: string) {
	return /\bE2E\b/i.test(value);
}

function stripE2eScope(value: string) {
	return value
		.replace(/\bE2E\b\s*(?:と|and|\/|\+|、|,)\s*/gi, "")
		.replace(/\s*(?:と|and|\/|\+|、|,)\s*\bE2E\b/gi, "")
		.replace(/\bE2E\b/gi, "");
}

function hasConcreteNonE2eScope(value: string) {
	return /unit|単体|focused|integration|統合|API|DB|migration|schema|lint|typecheck|build|UI|コンポーネント|component/i.test(
		value,
	);
}

function isReservedFinalGateTodo(todo: ImplementationTodoInput) {
	return (
		isReservedFirstGateTodo(todo) ||
		isReservedDataMigrationGateTodo(todo) ||
		isDeprecatedReviewTodo(todo) ||
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

function isDeprecatedReviewTodo(todo: ImplementationTodoInput) {
	const title =
		typeof todo.title === "string" ? todo.title.trim().toLowerCase() : "";
	const normalizedTitle = title.replace(/\s+/g, "");
	const taskType =
		typeof todo.taskType === "string" ? todo.taskType.trim().toLowerCase() : "";
	const procedureId =
		typeof todo.procedureId === "string"
			? todo.procedureId.trim().toLowerCase()
			: "";

	return (
		title === "llm code review" ||
		normalizedTitle === "llmコードレビューを実施する" ||
		taskType === "review" ||
		taskType === "code_review" ||
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
		taskType === "quality_gate" ||
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
