import { describe, expect, it } from "vitest";
import {
	buildStandardImplementationTodoList,
	deriveTodoVerificationPolicyFromPromptText,
	NIGHTWORKERS_TODO_TASK_TYPES,
} from "../api/services/todo-runtime";

describe("standard implementation TodoList builder", () => {
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

		expect(todos.map((todo) => todo.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(todos.map((todo) => todo.taskType)).toEqual([
			"initial_instructions",
			"context_compile",
			"code_edit",
			"test",
			"review",
			"verification",
			"completion_report",
		]);
		expect(todos[0]).toMatchObject({
			status: "running",
			procedureId: "contextstill.initial_instructions",
		});
		expect(todos[1]).toMatchObject({
			status: "pending",
			procedureId: "contextstill.context_compile",
			dependsOn: [1],
		});
		expect(todos[3]).toMatchObject({ title: "Add tests", dependsOn: [3] });
		expect(todos.at(-3)).toMatchObject({ taskType: "review", dependsOn: [4] });
		expect(todos.at(-2)).toMatchObject({
			taskType: "verification",
			dependsOn: [5],
		});
		expect(todos.at(-1)).toMatchObject({
			title: "完了報告を行う",
			taskType: "completion_report",
			dependsOn: [6],
		});
	});

	it("can create only the fixed gates when the LLM has no middle implementation Todos", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [],
			startFirst: false,
		});

		expect(todos.map((todo) => todo.taskType)).toEqual([
			"initial_instructions",
			"context_compile",
			"review",
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
			"1:initial_instructions:initial_instructions を実行する",
			"2:context_compile:context_compile を実行する",
			"3:implementation:Implement feature",
			"4:review:LLM コードレビューを実施する",
			"5:verification:品質ゲート verify コマンドを通す",
			"6:completion_report:完了報告を行う",
		]);
		expect(
			todos.filter(
				(todo) => todo.procedureId === "contextstill.register_candidates",
			),
		).toHaveLength(0);
		expect(todos.at(-1)).toMatchObject({
			taskType: "completion_report",
			dependsOn: [5],
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

		expect(todos[2]).toMatchObject({
			seq: 3,
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
			"1:initial_instructions:initial_instructions を実行する",
			"2:context_compile:context_compile を実行する",
			"3:implementation:Implement feature",
			"4:test:Add focused tests",
			"5:review:LLM コードレビューを実施する",
			"6:verification:品質ゲート verify コマンドを通す",
			"7:completion_report:完了報告を行う",
		]);
		expect(todos[3]).toMatchObject({
			title: "Add focused tests",
			dependsOn: [3],
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
			"1:initial_instructions:initial_instructions を実行する",
			"2:context_compile:context_compile を実行する",
			"3:implementation:Implement feature",
			"4:test:Add focused tests",
			"5:review:LLM コードレビューを実施する",
			"6:verification:品質ゲート verify コマンドを通す",
			"7:completion_report:完了報告を行う",
		]);
		expect(todos[3]).toMatchObject({
			title: "Add focused tests",
			dependsOn: [3],
		});
		expect(
			todos.filter((todo) => todo.title === "検証コマンドを実行する"),
		).toHaveLength(0);
		expect(
			todos.filter((todo) => todo.procedureId === "quality_gate_verify"),
		).toHaveLength(1);
	});

	it("adds required migration creation, application, integration test, and verification gates for data migration runs", () => {
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
			"1:initial_instructions:contextstill.initial_instructions",
			"2:context_compile:contextstill.context_compile",
			"3:implementation:null",
			"4:data_migration:data_migration.create_migration",
			"5:data_migration:data_migration.apply_migration",
			"6:test_change:data_migration.add_integration_test",
			"7:focused_verification:data_migration.verify_migration",
			"8:review:llm_code_review",
			"9:verification:quality_gate_verify",
			"10:completion_report:final_completion_report",
		]);
		expect(todos[3]).toMatchObject({
			title: "DB migration を作成する",
			dependsOn: [3],
		});
		expect(todos[4]).toMatchObject({
			title: "DB migration を対象 DB に適用する",
			dependsOn: [4],
		});
		expect(todos[5]).toMatchObject({
			title: "DB migration を使う実 DB 統合テストを追加する",
			dependsOn: [5],
		});
		expect(todos[5]?.description).toContain("既存 migration を一時 DB");
		expect(todos[5]?.description).toContain("schema を手書き再現せず");
		expect(todos[5]?.description).toContain("Bun 実行環境の bun test");
		expect(todos[5]?.description).toContain("bun:* を解決できない構成");
		expect(todos[6]).toMatchObject({
			title: "DB migration 後の schema と動作を検証する",
			dependsOn: [6],
		});
		expect(todos[6]?.description).toContain("どの段階と command が失敗したか");
		expect(todos[7]).toMatchObject({ taskType: "review", dependsOn: [7] });
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
				!todo.procedureId?.startsWith("data_migration.") &&
				todo.procedureId !== "llm_code_review" &&
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

	it("preserves required migration gates when a replacement TodoList marks migration work", () => {
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
		).toEqual([
			"data_migration.create_migration",
			"data_migration.apply_migration",
			"data_migration.add_integration_test",
			"data_migration.verify_migration",
		]);
		expect(
			todos.filter((todo) => todo.title.includes("threads table migration")),
		).toHaveLength(0);
	});

	it("merges LLM-generated review Todos into the fixed LLM review gate", () => {
		const todos = buildStandardImplementationTodoList({
			todos: [
				{ seq: 1, title: "Implement feature" },
				{ seq: 2, title: "LLM コードレビューを実施する" },
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
			"1:initial_instructions:initial_instructions を実行する",
			"2:context_compile:context_compile を実行する",
			"3:implementation:Implement feature",
			"4:test:Add focused tests",
			"5:review:LLM コードレビューを実施する",
			"6:verification:品質ゲート verify コマンドを通す",
			"7:completion_report:完了報告を行う",
		]);
		expect(todos[3]).toMatchObject({
			title: "Add focused tests",
			dependsOn: [3],
		});
		expect(
			todos.filter((todo) => todo.title === "LLM コードレビューを実施する"),
		).toHaveLength(1);
		expect(
			todos.filter((todo) => todo.procedureId === "llm_code_review"),
		).toHaveLength(1);
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
			"1:initial_instructions:initial_instructions を実行する",
			"2:context_compile:context_compile を実行する",
			"3:implementation:Implement feature",
			"4:review:LLM コードレビューを実施する",
			"5:verification:品質ゲート verify コマンドを通す",
			"6:completion_report:完了報告を行う",
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
				"initial_instructions",
				"context_compile",
				"review",
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

		expect(todos[2]).toMatchObject({
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
			"1:initial_instructions:initial_instructions を実行する",
			"2:context_compile:context_compile を実行する",
			"3:implementation:Implement feature",
			"4:review:LLM コードレビューを実施する",
			"5:verification:品質ゲート verify コマンドを通す",
			"6:completion_report:完了報告を行う",
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
			"1:initial_instructions:initial_instructions を実行する",
			"2:context_compile:context_compile を実行する",
			"3:implementation:todo の保存層と API 契約を実装する",
			"4:review:LLM コードレビューを実施する",
			"5:verification:品質ゲート verify コマンドを通す",
			"6:completion_report:完了報告を行う",
		]);
		expect(
			todos.filter(
				(todo) => todo.procedureId === "contextstill.initial_instructions",
			),
		).toHaveLength(1);
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
