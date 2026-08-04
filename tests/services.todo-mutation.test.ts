import { afterEach, describe, expect, it } from "vitest";
import {
	type CodingAgentSystemContextSnapshot,
	TodoMutationService,
} from "../api/modules/codingAgent/todo";
import {
	createRepository,
	createTask,
	createTaskRun,
	deleteRepository,
	getTaskRun,
	updateTaskRun,
} from "../api/modules/nightworkers/nightworkers.repository";
import type { TodoMutationCommand } from "../shared/modules/codingAgent";

const repositoryIds: string[] = [];

const systemContext: CodingAgentSystemContextSnapshot = {
	version: 1,
	planModeRequested: false,
	todoPolicy: "adaptive",
	roleInstructionsJa: "Coding Agentとして作業する。",
	taskGoal: "Todo mutation境界を検証する。",
	projectRulesJa: ["登録済みrepository rootを使用する。"],
	todoRequirementJa: "workspace作業前にcurrent Todoを開始する。",
	failureRecoveryJa: "失敗をTodoへ記録して再計画する。",
	completionRuleJa: "open Todoがない場合だけ完了する。",
	toolContractJa: "tool結果を読んで次の行動を選ぶ。",
	registeredRepositoryRoot: "/tmp/todo-mutation-fixture",
};

const TODO_SYSTEM_CONTEXT = "このTodoの目的と受け入れ条件を優先する。";

function humanDecisionBlocker(question: string) {
	return {
		question,
		requiredInput: "decision" as const,
		basis: { kind: "task_context" as const },
	};
}

afterEach(async () => {
	for (const id of repositoryIds.splice(0)) await deleteRepository(id);
});

async function createRunFixture() {
	const repository = await createRepository({
		name: `TEST: todo-mutation-${crypto.randomUUID()}`,
		localPath: "/tmp/todo-mutation-fixture",
		branch: "main",
		allowed: true,
	});
	repositoryIds.push(repository.id);
	const task = await createTask({
		repositoryId: repository.id,
		title: "TEST: Todo mutation",
		status: "running",
	});
	const run = await createTaskRun({
		taskId: task.id,
		repositoryId: repository.id,
		status: "running",
	});
	return { repository, task, run };
}

function service(actor: "agent" | "human" = "agent") {
	return new TodoMutationService(systemContext, actor);
}

async function createTwoTodoPlan(runId: string) {
	return service().execute(runId, {
		op: "replace_plan",
		expectedPlanRevision: 0,
		todos: [
			{
				title: "実装する",
				objective: "単一writerを実装する。",
				systemContext: "既存schemaはadditiveに拡張する。",
				nextAction: "関連repositoryを確認する。",
				acceptanceCriteria: ["CASで更新できる"],
			},
			{
				title: "検証する",
				systemContext: TODO_SYSTEM_CONTEXT,
				nextAction: "対象testを実行する。",
			},
		],
	});
}

describe("TodoMutationService", () => {
	it("creates and advances the minimal plan without IDs or revisions from the LLM", async () => {
		const { run } = await createRunFixture();

		const planned = await service().execute(run.id, {
			op: "plan",
			steps: [
				{
					title: "実装する",
					systemContext: "対象契約を維持して実装する。",
				},
				{
					title: "検証する",
					systemContext: "対象テストを実行して結果を確認する。",
				},
			],
		});

		expect(planned.ok).toBe(true);
		expect(planned.currentTodo).toMatchObject({
			title: "実装する",
			status: "running",
		});
		expect(planned.todos[1]).toMatchObject({
			title: "検証する",
			status: "pending",
		});

		const completed = await service().execute(run.id, {
			op: "complete_current",
			note: "実装済み。",
		});

		expect(completed.todos).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "実装する",
					status: "passed",
					statusReason: "実装済み。",
				}),
				expect.objectContaining({
					title: "検証する",
					status: "running",
				}),
			]),
		);
		expect(completed.currentTodo?.title).toBe("検証する");
	});

	it("replaces only remaining steps and preserves the current step", async () => {
		const { run } = await createRunFixture();
		const planned = await service().execute(run.id, {
			op: "plan",
			steps: [
				{ title: "調査する", systemContext: "関連箇所を特定する。" },
				{ title: "旧実装", systemContext: "旧方針で実装する。" },
			],
		});
		if (!planned.ok) throw new Error(planned.error.code);

		const replaced = await service().execute(run.id, {
			op: "replace_remaining",
			steps: [
				{ title: "新実装", systemContext: "判明した契約に沿って実装する。" },
				{ title: "回帰確認", systemContext: "関連回帰テストを実行する。" },
			],
		});

		expect(replaced.currentTodo).toMatchObject({
			id: planned.currentTodo?.id,
			title: "調査する",
			status: "running",
		});
		expect(
			replaced.todos.map(({ title, status }) => ({ title, status })),
		).toEqual([
			{ title: "調査する", status: "running" },
			{ title: "新実装", status: "pending" },
			{ title: "回帰確認", status: "pending" },
		]);
	});

	it("blocks the current step with a canonical structured human blocker", async () => {
		const { run } = await createRunFixture();
		await service().execute(run.id, {
			op: "plan",
			steps: [{ title: "配備する", systemContext: "対象環境へ配備する。" }],
		});

		const blocked = await service().execute(run.id, {
			op: "block_current",
			humanBlocker: humanDecisionBlocker("  配備先の選択が必要。  "),
		});

		expect(blocked.currentTodo).toBeNull();
		expect(blocked.todos[0]).toMatchObject({
			status: "needs_human",
			statusReason: "配備先の選択が必要。",
			humanBlockerJson: humanDecisionBlocker("配備先の選択が必要。"),
		});
	});

	it("rejects a malformed human blocker without mutating the Todo", async () => {
		const { run } = await createRunFixture();
		const planned = await service().execute(run.id, {
			op: "plan",
			steps: [{ title: "配備する", systemContext: "対象環境へ配備する。" }],
		});
		if (!planned.ok) throw new Error(planned.error.code);

		const result = await service().execute(run.id, {
			op: "block_current",
			humanBlocker: {
				question: "権限を確認してください。",
				requiredInput: "permission",
				basis: {
					kind: "tool_failure",
					toolName: "run_check",
					failureCode: "TEST_EVIDENCE_COMMAND_UNSUPPORTED",
					recoveryDisposition: "agent_action",
				},
			},
		} as unknown as TodoMutationCommand);

		expect(result).toMatchObject({
			ok: false,
			error: { code: "TODO_HUMAN_BLOCKER_NOT_ESTABLISHED" },
			todos: [expect.objectContaining({ status: "running" })],
		});
	});

	it("treats the same Todo key as run-local across different Runs", async () => {
		const [{ run: firstRun }, { run: secondRun }] = await Promise.all([
			createRunFixture(),
			createRunFixture(),
		]);
		const command = {
			op: "replace_plan" as const,
			expectedPlanRevision: 0,
			todos: [
				{
					id: "inspect",
					title: "調査する",
					systemContext: TODO_SYSTEM_CONTEXT,
					nextAction: "repositoryを確認する。",
				},
			],
		};

		const first = await service().execute(firstRun.id, command);
		const second = await service().execute(secondRun.id, command);

		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		if (!first.ok || !second.ok) return;
		expect(first.todos[0]?.id).not.toBe(second.todos[0]?.id);
		expect(first.todos[0]?.todoKey).toBe("inspect");
		expect(second.todos[0]?.todoKey).toBe("inspect");
	});

	it("keeps the canonical Todo ID stable when replanning with todoKey", async () => {
		const { run } = await createRunFixture();
		const first = await service().execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					todoKey: "inspect",
					title: "調査する",
					systemContext: TODO_SYSTEM_CONTEXT,
					nextAction: "sourceを確認する。",
				},
			],
		});
		if (!first.ok) throw new Error(first.error.code);

		const replanned = await service().execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: first.planRevision,
			todos: [
				{
					todoKey: "inspect",
					title: "調査を続ける",
					systemContext: TODO_SYSTEM_CONTEXT,
					nextAction: "追加のsourceを確認する。",
				},
			],
		});

		expect(replanned.ok).toBe(true);
		if (!replanned.ok) return;
		expect(replanned.todos[0]).toMatchObject({
			id: first.todos[0]?.id,
			todoKey: "inspect",
			revision: 1,
			title: "調査を続ける",
		});
	});

	it("resolves dependsOnKeys to canonical Todo IDs", async () => {
		const { run } = await createRunFixture();
		const plan = await service().execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					todoKey: "inspect",
					title: "調査する",
					systemContext: TODO_SYSTEM_CONTEXT,
					nextAction: "sourceを確認する。",
				},
				{
					todoKey: "implement",
					title: "実装する",
					systemContext: TODO_SYSTEM_CONTEXT,
					nextAction: "sourceを編集する。",
					dependsOnKeys: ["inspect"],
				},
			],
		});

		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.todos[1]?.dependsOn).toEqual([plan.todos[0]?.id]);
	});

	it("creates an additive versioned plan with the shared system context", async () => {
		const { run } = await createRunFixture();

		const result = await createTwoTodoPlan(run.id);

		expect(result.ok).toBe(true);
		expect(result.planRevision).toBe(1);
		expect(result.currentTodo).toBeNull();
		expect(result.todos).toHaveLength(2);
		expect(result.todos[0]).toMatchObject({
			seq: 1,
			title: "実装する",
			objective: "単一writerを実装する。",
			nextAction: "関連repositoryを確認する。",
			acceptanceCriteriaJson: ["CASで更新できる"],
			status: "pending",
			attemptCount: 0,
			systemContextVersion: 1,
			systemContextSnapshot: systemContext,
			createdBy: "agent",
			revision: 0,
		});
	});

	it("rejects a stale plan revision without replacing the current plan", async () => {
		const { run } = await createRunFixture();
		const first = await createTwoTodoPlan(run.id);

		const stale = await service().execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					title: "stale",
					systemContext: TODO_SYSTEM_CONTEXT,
					nextAction: "上書きする。",
				},
			],
		});

		expect(first.ok).toBe(true);
		expect(stale).toMatchObject({
			ok: false,
			planRevision: 1,
			error: { code: "TODO_PLAN_REVISION_CONFLICT" },
		});
		expect(stale.todos.map((todo) => todo.title)).toEqual([
			"実装する",
			"検証する",
		]);
	});

	it("allows only one running Todo and performs transition plus next start atomically", async () => {
		const { run } = await createRunFixture();
		const plan = await createTwoTodoPlan(run.id);
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		const [first, second] = plan.todos;

		const started = await service().execute(run.id, {
			op: "start",
			todoId: first.id,
			expectedTodoRevision: first.revision,
		});
		expect(started.currentTodo?.id).toBe(first.id);

		const duplicate = await service().execute(run.id, {
			op: "start",
			todoId: second.id,
			expectedTodoRevision: second.revision,
		});
		expect(duplicate).toMatchObject({
			ok: false,
			error: { code: "CURRENT_TODO_EXISTS" },
		});

		const current = started.todos.find((todo) => todo.id === first.id);
		expect(current).toBeDefined();
		const transitioned = await service().execute(run.id, {
			op: "transition",
			todoId: first.id,
			expectedTodoRevision: current?.revision ?? -1,
			status: "passed",
			reason: "受け入れ条件を満たした。",
			nextTodoId: second.id,
		});

		expect(transitioned.ok).toBe(true);
		expect(transitioned.todos).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: first.id, status: "passed" }),
				expect.objectContaining({ id: second.id, status: "running" }),
			]),
		);
		expect(transitioned.currentTodo?.id).toBe(second.id);
	});

	it("uses todo revision CAS and keeps record_failure non-terminal", async () => {
		const { run } = await createRunFixture();
		const plan = await createTwoTodoPlan(run.id);
		if (!plan.ok) return;
		const target = plan.todos[0];
		const started = await service().execute(run.id, {
			op: "start",
			todoId: target.id,
			expectedTodoRevision: target.revision,
		});
		if (!started.ok || !started.currentTodo) return;

		const expectedRevision = started.currentTodo.revision;
		const [first, second] = await Promise.all([
			service().execute(run.id, {
				op: "record_failure",
				todoId: target.id,
				expectedTodoRevision: expectedRevision,
				failureSummary: "testが失敗した。",
				nextAction: "失敗箇所を修正して再実行する。",
			}),
			service().execute(run.id, {
				op: "update_context",
				todoId: target.id,
				expectedTodoRevision: expectedRevision,
				systemContext: "別の更新。",
				nextAction: "別経路を試す。",
			}),
		]);

		expect([first, second].filter((result) => result.ok)).toHaveLength(1);
		expect([first, second].find((result) => !result.ok)?.error.code).toBe(
			"TODO_REVISION_CONFLICT",
		);
		const latest = (first.ok ? first : second).todos.find(
			(todo) => todo.id === target.id,
		);
		expect(latest?.status).toBe("running");
		if (first.ok) {
			expect(latest).toMatchObject({
				attemptCount: 1,
				lastFailure: "testが失敗した。",
			});
		}
	});

	it("pauses with needs_human and resumes the same Todo with user context", async () => {
		const { run } = await createRunFixture();
		const plan = await createTwoTodoPlan(run.id);
		if (!plan.ok) return;
		const target = plan.todos[0];
		const started = await service().execute(run.id, {
			op: "start",
			todoId: target.id,
			expectedTodoRevision: target.revision,
		});
		if (!started.ok || !started.currentTodo) return;
		const paused = await service().execute(run.id, {
			op: "transition",
			todoId: target.id,
			expectedTodoRevision: started.currentTodo.revision,
			status: "needs_human",
			humanBlocker: humanDecisionBlocker("対象environmentが不明。"),
		});
		if (!paused.ok) return;
		const pausedTodo = paused.todos.find((todo) => todo.id === target.id);
		expect(paused.currentTodo).toBeNull();
		const startWhilePaused = await service().execute(run.id, {
			op: "start",
			todoId: plan.todos[1].id,
			expectedTodoRevision: plan.todos[1].revision,
		});
		expect(startWhilePaused).toMatchObject({
			ok: false,
			error: { code: "CURRENT_TODO_EXISTS" },
		});
		await updateTaskRun(run.id, {
			status: "needs_human",
			endedAt: new Date(),
			finishedAt: new Date(),
			summary: "ユーザー回答待ち",
			finalReport: "対象environmentを確認してください。",
		});

		const resumed = await service("human").execute(run.id, {
			op: "resume",
			todoId: target.id,
			expectedTodoRevision: pausedTodo?.revision ?? -1,
			userContext: "staging environmentを使用してください。",
		});

		expect(resumed.currentTodo).toMatchObject({
			id: target.id,
			status: "running",
		});
		expect(resumed.currentTodo?.context).toContain(
			"ユーザー回答:\nstaging environmentを使用してください。",
		);
		expect(await getTaskRun(run.id)).toMatchObject({
			id: run.id,
			status: "running",
			endedAt: null,
			finishedAt: null,
			summary: null,
			finalReport: null,
		});
	});

	it("rejects dependencies that do not reference Todo IDs in the plan", async () => {
		const { run } = await createRunFixture();

		const result = await service().execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					title: "invalid dependency",
					systemContext: TODO_SYSTEM_CONTEXT,
					nextAction: "開始する。",
					dependsOn: ["missing-todo-id"],
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "TODO_DEPENDENCY_NOT_FOUND" },
		});
		expect(result.todos).toEqual([]);
	});

	it("rejects dependency cycles and starting before dependencies are terminal", async () => {
		const { run } = await createRunFixture();
		const firstId = crypto.randomUUID();
		const secondId = crypto.randomUUID();
		const cyclic = await service().execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					id: firstId,
					title: "first",
					systemContext: TODO_SYSTEM_CONTEXT,
					nextAction: "first action",
					dependsOn: [secondId],
				},
				{
					id: secondId,
					title: "second",
					systemContext: TODO_SYSTEM_CONTEXT,
					nextAction: "second action",
					dependsOn: [firstId],
				},
			],
		});
		expect(cyclic).toMatchObject({
			ok: false,
			error: { code: "TODO_DEPENDENCY_CYCLE" },
		});

		const plan = await service().execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					id: firstId,
					title: "first",
					systemContext: TODO_SYSTEM_CONTEXT,
					nextAction: "first action",
				},
				{
					id: secondId,
					title: "second",
					systemContext: TODO_SYSTEM_CONTEXT,
					nextAction: "second action",
					dependsOn: [firstId],
				},
			],
		});
		if (!plan.ok) throw new Error(plan.error.code);
		const blocked = await service().execute(run.id, {
			op: "start",
			todoId: secondId,
			expectedTodoRevision: plan.todos[1].revision,
		});
		expect(blocked).toMatchObject({
			ok: false,
			error: { code: "TODO_DEPENDENCY_OPEN" },
		});
	});

	it("rejects Todo mutations after the run becomes terminal", async () => {
		const { run } = await createRunFixture();
		const plan = await createTwoTodoPlan(run.id);
		if (!plan.ok) throw new Error(plan.error.code);
		await updateTaskRun(run.id, { status: "completed" });

		const result = await service().execute(run.id, {
			op: "start",
			todoId: plan.todos[0].id,
			expectedTodoRevision: plan.todos[0].revision,
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "RUN_NOT_MUTABLE" },
		});
		expect(result.todos[0].status).toBe("pending");
	});

	it("rejects multiline fields in the minimal plan contract", async () => {
		const { run } = await createRunFixture();

		const result = await service().execute(run.id, {
			op: "plan",
			steps: [
				{
					title: "実装\n## 完了条件",
					systemContext: TODO_SYSTEM_CONTEXT,
				},
			],
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "INVALID_TODO_COMMAND" },
			todos: [],
		});
	});

	it("rejects minimal current completion after the run becomes terminal", async () => {
		const { run } = await createRunFixture();
		const plan = await service().execute(run.id, {
			op: "plan",
			steps: [{ title: "実装", systemContext: TODO_SYSTEM_CONTEXT }],
		});
		if (!plan.ok) throw new Error(plan.error.code);
		await updateTaskRun(run.id, { status: "completed" });

		const result = await service().execute(run.id, {
			op: "complete_current",
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "RUN_NOT_MUTABLE" },
		});
		expect(result.todos[0]).toMatchObject({ status: "running" });
	});

	it("does not start replacement work while a Todo needs human input", async () => {
		const { run } = await createRunFixture();
		const plan = await service().execute(run.id, {
			op: "plan",
			steps: [
				{ title: "確認", systemContext: TODO_SYSTEM_CONTEXT },
				{ title: "旧実装", systemContext: TODO_SYSTEM_CONTEXT },
			],
		});
		if (!plan.ok) throw new Error(plan.error.code);
		const blocked = await service().execute(run.id, {
			op: "block_current",
			humanBlocker: humanDecisionBlocker("ユーザー判断が必要。"),
		});
		if (!blocked.ok) throw new Error(blocked.error.code);

		const replaced = await service().execute(run.id, {
			op: "replace_remaining",
			steps: [{ title: "新実装", systemContext: TODO_SYSTEM_CONTEXT }],
		});

		expect(replaced.ok).toBe(true);
		expect(replaced.currentTodo).toBeNull();
		expect(replaced.todos).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ title: "確認", status: "needs_human" }),
				expect.objectContaining({ title: "新実装", status: "pending" }),
			]),
		);
	});
});
