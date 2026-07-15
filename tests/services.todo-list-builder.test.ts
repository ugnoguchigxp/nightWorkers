import { describe, expect, it } from "vitest";
import {
	buildStandardImplementationTodoList,
	deriveTodoVerificationPolicyFromPromptText,
	NIGHTWORKERS_TODO_TASK_TYPES,
} from "../api/services/todo-runtime";
import { requiresDataMigrationFromRun } from "../api/services/worker-tools/todo-list-context";

describe("standard implementation TodoList builder", () => {
	it("preserves a projected migration gate hint from the persisted Run context", () => {
		expect(
			requiresDataMigrationFromRun({
				contextSnapshot: { requireDataMigrationGates: true },
			}),
		).toBe(true);
		expect(
			requiresDataMigrationFromRun({
				contextSnapshot: { requireDataMigrationGates: false },
			}),
		).toBe(false);
		expect(
			requiresDataMigrationFromRun({
				contextSnapshot: {
					missionPilot: { requireDataMigrationGates: true },
				},
			}),
		).toBe(true);
	});

	it("adds fixed first and final gates around LLM-decomposed implementation Todos", () => {
		const todos = buildStandardImplementationTodoList({
			now: new Date("2026-06-11T00:00:00.000Z"),
			todos: [
				{
					title: "Update MCP server",
					description: "Expose the TodoList tool.",
					taskType: "code_edit",
					procedureId: "code",
				},
				{
					title: "Add tests",
					taskType: "test",
					dependsOn: [1],
				},
			],
		});

		expect(todos.map((todo) => todo.seq)).toEqual([1, 2, 3, 4, 5]);
		expect(todos.map((todo) => todo.taskType)).toEqual([
			"coding_preparation",
			"code_edit",
			"test",
			"verification",
			"completion_report",
		]);
		expect(todos[0]).toMatchObject({
			status: "running",
			procedureId: "coding_preparation",
		});
		expect(todos[2]).toMatchObject({ title: "Add tests", dependsOn: [2] });
		expect(todos.at(-2)).toMatchObject({
			taskType: "verification",
			dependsOn: [3],
		});
		expect(todos.at(-1)).toMatchObject({
			title: "完了報告を行う",
			taskType: "completion_report",
			dependsOn: [4],
		});
	});

	it("can create only the fixed gates when the LLM has no middle implementation Todos", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [],
			startFirst: false,
		});

		expect(todos.map((todo) => todo.taskType)).toEqual([
			"coding_preparation",
			"verification",
			"completion_report",
		]);
		expect(todos.every((todo) => todo.status === "pending")).toBe(true);
	});

	it("does not add the register_candidates knowledge capture gate", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [{ seq: 1, title: "Implement feature" }],
		});

		expect(
			todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`),
		).toEqual([
			"1:coding_preparation:コーディング準備を行う",
			"2:implementation:Implement feature",
			"3:verification:品質ゲート verify コマンドを通す",
			"4:completion_report:完了報告を行う",
		]);
		expect(
			todos.filter(
				(todo) => todo.procedureId === "contextstill.register_candidates",
			),
		).toHaveLength(0);
		expect(todos.at(-1)).toMatchObject({
			taskType: "completion_report",
			dependsOn: [3],
		});
	});

	it("rejects malformed LLM Todo items before writing to the database", () => {
		expect(() =>
			buildStandardImplementationTodoList({
				todos: [{ title: "   ", taskType: "code_edit" }],
			}),
		).toThrow("Todo #1 requires title.");
	});

	it("fills the public Todo contract with internal defaults", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [{ seq: 1, title: "Implement feature" }],
		});

		expect(todos[1]).toMatchObject({
			seq: 2,
			title: "Implement feature",
			taskType: "implementation",
		});
	});

	it("merges LLM-generated closeout Todos into the fixed final closeout gate", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [
				{ seq: 1, title: "Implement feature" },
				{
					seq: 2,
					title: "closeout",
					description: "Summarize the completed work.",
				},
				{
					seq: 3,
					title: "Add focused tests",
					taskType: "test",
					dependsOn: [1],
				},
			],
		});

		expect(
			todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`),
		).toEqual([
			"1:coding_preparation:コーディング準備を行う",
			"2:implementation:Implement feature",
			"3:test:Add focused tests",
			"4:verification:品質ゲート verify コマンドを通す",
			"5:completion_report:完了報告を行う",
		]);
		expect(todos[2]).toMatchObject({
			title: "Add focused tests",
			dependsOn: [2],
		});
		expect(
			todos.filter((todo) => todo.title.toLowerCase() === "closeout"),
		).toHaveLength(0);
		expect(
			todos.filter(
				(todo) => todo.procedureId === "contextstill.register_candidates",
			),
		).toHaveLength(0);
		expect(
			todos.filter((todo) => todo.procedureId === "final_completion_report"),
		).toHaveLength(1);
	});

	it("merges LLM-generated broad verification Todos into the fixed quality gate", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [
				{ seq: 1, title: "Implement feature" },
				{ seq: 2, title: "検証コマンドを実行する", taskType: "verification" },
				{
					seq: 3,
					title: "Add focused tests",
					taskType: "test",
					dependsOn: [1],
				},
			],
		});

		expect(
			todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`),
		).toEqual([
			"1:coding_preparation:コーディング準備を行う",
			"2:implementation:Implement feature",
			"3:test:Add focused tests",
			"4:verification:品質ゲート verify コマンドを通す",
			"5:completion_report:完了報告を行う",
		]);
		expect(todos[2]).toMatchObject({
			title: "Add focused tests",
			dependsOn: [2],
		});
		expect(
			todos.filter((todo) => todo.title === "検証コマンドを実行する"),
		).toHaveLength(0);
		expect(
			todos.filter((todo) => todo.procedureId === "quality_gate_verify"),
		).toHaveLength(1);
	});

	it("adds one required migration execution gate for data migration runs", () => {
		const todos = buildStandardImplementationTodoList({
			requireDataMigrationGates: true,
			todos: [
				{
					seq: 1,
					title: "BBS persistenceを実装する",
					taskType: "implementation",
				},
			],
		});

		expect(
			todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.procedureId}`),
		).toEqual([
			"1:coding_preparation:coding_preparation",
			"2:implementation:null",
			"3:data_migration:data_migration.apply_migration",
			"4:verification:quality_gate_verify",
			"5:completion_report:final_completion_report",
		]);
		expect(todos[2]).toMatchObject({
			title: "DB migration を実行する",
			dependsOn: [2],
		});
		expect(todos[2]?.description).toContain("migration ファイル作成");
		expect(todos[2]?.description).toContain("実作業対象 DB");
		expect(todos[2]?.description).toContain("read-only focused test");
		expect(todos[2]?.description).toContain("API が no such table");
		expect(todos[2]?.description).toContain("隔離 DB や一時 DB");
		expect(
			todos.filter((todo) => todo.procedureId === "quality_gate_verify"),
		).toHaveLength(1);
	});

	it("keeps questionnaire unit-primary TodoLists from expanding focused tests into E2E", () => {
		const verificationPolicy = deriveTodoVerificationPolicyFromPromptText(
			[
				"## Questionnaire Decisions",
				"- 検証方針: unit を主軸にする",
				"## Feature Plan",
				"- unit と E2E のどちらかではなく unit 主軸で進める。",
			].join("\n"),
		);
		const todos = buildStandardImplementationTodoList({
			verificationPolicy,
			todos: [
				{
					title: "主要導線の unit と E2E を追加する",
					description: "unit と E2E のテストを実装する。",
					taskType: "test_change",
				},
				{
					title: "E2E を実行する",
					description: "verify:e2e を実行する。",
					taskType: "test",
					procedureId: "verify:e2e",
				},
			],
		});

		const implementationTodos = todos.filter(
			(todo) =>
				!todo.procedureId?.startsWith("contextstill.") &&
				todo.procedureId !== "coding_preparation" &&
				!todo.procedureId?.startsWith("data_migration.") &&
				todo.procedureId !== "quality_gate_verify" &&
				todo.procedureId !== "final_completion_report",
		);
		expect(verificationPolicy).toMatchObject({
			suppressE2eTodos: true,
			source: "questionnaire_unit_primary",
		});
		expect(implementationTodos).toHaveLength(1);
		expect(implementationTodos[0]?.title).toBe("主要導線の unit を追加する");
		expect(implementationTodos[0]?.description).toBe(
			"unit のテストを実装する。",
		);
		expect(todos.map((todo) => todo.title).join("\n")).not.toContain("E2E");
	});

	it("preserves the required migration gate when a replacement TodoList marks migration work", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [
				{
					seq: 1,
					title: "スレッド保存処理を実装する",
					taskType: "implementation",
				},
				{
					seq: 2,
					title: "threads table migration を作成する",
					taskType: "data_migration",
					procedureId: "data_migration.create_migration",
					dependsOn: [1],
				},
			],
		});

		expect(
			todos
				.filter((todo) => todo.procedureId?.startsWith("data_migration."))
				.map((todo) => todo.procedureId),
		).toEqual(["data_migration.apply_migration"]);
		expect(
			todos.filter((todo) => todo.title.includes("threads table migration")),
		).toHaveLength(0);
	});

	it("does not duplicate the migration gate for a task-type-only migration marker", () => {
		const todos = buildStandardImplementationTodoList({
			requireDataMigrationGates: true,
			todos: [
				{
					seq: 1,
					title: "スレッド保存処理を実装する",
					taskType: "implementation",
				},
				{
					seq: 2,
					title: "migration を適用する",
					taskType: "data_migration",
				},
			],
		});

		expect(
			todos.filter(
				(todo) => todo.procedureId === "data_migration.apply_migration",
			),
		).toHaveLength(1);
		expect(
			todos.filter((todo) => todo.taskType === "data_migration"),
		).toHaveLength(1);
	});

	it("drops deprecated LLM-generated code review Todos", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [
				{ seq: 1, title: "Implement feature" },
				{ seq: 2, title: "Check implementation", taskType: "code_review" },
				{
					seq: 3,
					title: "LLM コードレビューを実施する",
					taskType: "review",
					procedureId: "llm_code_review",
				},
				{
					seq: 4,
					title: "Add focused tests",
					taskType: "test",
					dependsOn: [1],
				},
			],
		});

		expect(
			todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`),
		).toEqual([
			"1:coding_preparation:コーディング準備を行う",
			"2:implementation:Implement feature",
			"3:test:Add focused tests",
			"4:verification:品質ゲート verify コマンドを通す",
			"5:completion_report:完了報告を行う",
		]);
		expect(todos[2]).toMatchObject({
			title: "Add focused tests",
			dependsOn: [2],
		});
		expect(
			todos.filter((todo) => todo.title === "Check implementation"),
		).toHaveLength(0);
		expect(
			todos.filter((todo) => todo.taskType.includes("review")),
		).toHaveLength(0);
		expect(
			todos.filter((todo) => todo.procedureId === "llm_code_review"),
		).toHaveLength(0);
	});

	it("merges LLM-echoed first gates back into the fixed first gates", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [
				{
					seq: 1,
					title: "initial_instructions を実行する",
					taskType: "initial_instructions",
					procedureId: "contextstill.initial_instructions",
				},
				{
					seq: 2,
					title: "context_compile を実行する",
					taskType: "context_compile",
					procedureId: "contextstill.context_compile",
				},
				{ seq: 3, title: "Implement feature", taskType: "implementation" },
			],
		});

		expect(
			todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`),
		).toEqual([
			"1:coding_preparation:コーディング準備を行う",
			"2:implementation:Implement feature",
			"3:verification:品質ゲート verify コマンドを通す",
			"4:completion_report:完了報告を行う",
		]);
	});

	it("keeps builder-generated taskTypes in the shared Todo taskType contract", () => {
		const todos = buildStandardImplementationTodoList({
			requireDataMigrationGates: true,
			todos: [
				{ seq: 1, title: "Inspect files", taskType: "inspection" },
				{
					seq: 2,
					title: "Implement DB-backed feature",
					taskType: "implementation",
				},
			],
		});
		const allowedTaskTypes = new Set<string>(NIGHTWORKERS_TODO_TASK_TYPES);

		expect(todos.map((todo) => todo.taskType)).toEqual(
			expect.arrayContaining([
				"coding_preparation",
				"verification",
				"completion_report",
			]),
		);
		expect(
			todos.filter((todo) => !allowedTaskTypes.has(todo.taskType)),
		).toEqual([]);
	});

	it("normalizes unknown LLM taskTypes before storing Todos", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [
				{
					seq: 1,
					title: "DB-backed Todo API を実装する",
					taskType: "backend_api",
				},
			],
		});

		expect(todos[1]).toMatchObject({
			title: "DB-backed Todo API を実装する",
			taskType: "implementation",
		});
	});

	it("merges echoed quality_gate aliases into the fixed verification gate", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [
				{
					seq: 1,
					title: "Implement feature",
					taskType: "implementation",
				},
				{
					seq: 2,
					title: "Run quality gate",
					taskType: "quality_gate",
				},
			],
		});

		expect(
			todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`),
		).toEqual([
			"1:coding_preparation:コーディング準備を行う",
			"2:implementation:Implement feature",
			"3:verification:品質ゲート verify コマンドを通す",
			"4:completion_report:完了報告を行う",
		]);
		expect(
			todos.filter((todo) => todo.taskType === "verification"),
		).toHaveLength(1);
	});

	it("merges SystemContext-echoed managed gates from replace input instead of duplicating them", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [
				{
					seq: 1,
					title: "initial_instructions を実行する",
					taskType: "initial_instructions",
					procedureId: "contextstill.initial_instructions",
				},
				{
					seq: 2,
					title: "context_compile を実行する",
					taskType: "context_compile",
					procedureId: "contextstill.context_compile",
				},
				{
					seq: 3,
					title: "todo の保存層と API 契約を実装する",
					taskType: "implementation",
				},
				{
					seq: 4,
					title: "知識登録を行う",
					taskType: "knowledge_capture",
					procedureId: "contextstill.register_candidates",
					dependsOn: [3],
				},
				{
					seq: 5,
					title: "完了報告を行う",
					taskType: "completion_report",
					procedureId: "final_completion_report",
					dependsOn: [4],
				},
			],
		});

		expect(
			todos.map((todo) => `${todo.seq}:${todo.taskType}:${todo.title}`),
		).toEqual([
			"1:coding_preparation:コーディング準備を行う",
			"2:implementation:todo の保存層と API 契約を実装する",
			"3:verification:品質ゲート verify コマンドを通す",
			"4:completion_report:完了報告を行う",
		]);
		expect(
			todos.filter(
				(todo) => todo.procedureId === "contextstill.initial_instructions",
			),
		).toHaveLength(0);
		expect(
			todos.filter(
				(todo) => todo.procedureId === "contextstill.register_candidates",
			),
		).toHaveLength(0);
		expect(
			todos.filter((todo) => todo.procedureId === "final_completion_report"),
		).toHaveLength(1);
	});
});
