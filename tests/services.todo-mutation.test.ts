import { afterEach, describe, expect, it } from "vitest";
import {
	createRepository,
	createTask,
	createTaskRun,
	deleteRepository,
	getTaskRun,
	updateTaskRun,
} from "../api/modules/nightworkers/nightworkers.repository";
import {
	type CodingAgentSystemContextSnapshot,
	TodoMutationService,
} from "../api/services/todo-mutation";

const repositoryIds: string[] = [];

const systemContext: CodingAgentSystemContextSnapshot = {
	version: 1,
	roleInstructionsJa: "Coding Agentとして作業する。",
	taskGoal: "Todo mutation境界を検証する。",
	projectRulesJa: ["登録済みrepository rootを使用する。"],
	todoRequirementJa: "workspace作業前にcurrent Todoを開始する。",
	failureRecoveryJa: "失敗をTodoへ記録して再計画する。",
	completionRuleJa: "open Todoがない場合だけ完了する。",
	toolContractJa: "tool結果を読んで次の行動を選ぶ。",
	registeredRepositoryRoot: "/tmp/todo-mutation-fixture",
};

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
				context: "既存schemaはadditiveに拡張する。",
				nextAction: "関連repositoryを確認する。",
				acceptanceCriteria: ["CASで更新できる"],
			},
			{
				title: "検証する",
				nextAction: "対象testを実行する。",
			},
		],
	});
}

describe("TodoMutationService", () => {
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
			todos: [{ title: "stale", nextAction: "上書きする。" }],
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
				context: "別の更新。",
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
			reason: "対象environmentが不明。",
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
					nextAction: "first action",
					dependsOn: [secondId],
				},
				{
					id: secondId,
					title: "second",
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
				{ id: firstId, title: "first", nextAction: "first action" },
				{
					id: secondId,
					title: "second",
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
});
