import { afterEach, describe, expect, it } from "vitest";
import {
	createRepository,
	createTask,
	createTaskRun,
	deleteRepository,
	updateTaskRun,
} from "../../api/modules/nightworkers/nightworkers.repository";
import { ActionExecutionJournal } from "../../api/services/run-control/action-execution-journal";
import { RunFinalizeController } from "../../api/services/run-control/finalize-controller";
import {
	type CodingAgentSystemContextSnapshot,
	TodoMutationService,
} from "../../api/services/todo-mutation";

const repositoryIds: string[] = [];
const systemContext: CodingAgentSystemContextSnapshot = {
	version: 1,
	roleInstructionsJa: "Coding Agentとして作業する。",
	taskGoal: "完了条件を検証する。",
	projectRulesJa: [],
	todoRequirementJa: "Todoを明示更新する。",
	failureRecoveryJa: "失敗を記録する。",
	completionRuleJa: "open Todoを残さない。",
	toolContractJa: "typed resultを読む。",
	registeredRepositoryRoot: "/tmp/completion-preconditions",
};

afterEach(async () => {
	for (const id of repositoryIds.splice(0)) await deleteRepository(id);
});

async function fixture() {
	const repository = await createRepository({
		name: `completion-${crypto.randomUUID()}`,
		localPath: "/tmp/completion-preconditions",
		branch: "main",
		allowed: true,
	});
	repositoryIds.push(repository.id);
	const task = await createTask({
		repositoryId: repository.id,
		title: "Completion fixture",
		status: "running",
	});
	const run = await createTaskRun({
		taskId: task.id,
		repositoryId: repository.id,
		status: "running",
	});
	return { run, service: new TodoMutationService(systemContext, "agent") };
}

describe("Run completion preconditions", () => {
	it("deduplicates an explicit side effect without choosing a next action", async () => {
		const { run } = await fixture();
		const journal = new ActionExecutionJournal();
		let executions = 0;
		const execute = async () => {
			executions += 1;
			return {
				ok: true,
				toolName: "apply_patch",
				startedAt: "2026-07-15T00:00:00.000Z",
				finishedAt: "2026-07-15T00:00:01.000Z",
				payload: { changed: true },
			};
		};
		const input = {
			runId: run.id,
			toolName: "apply_patch",
			arguments: { patch: "same" },
			workspaceIdentity: "/tmp/completion-preconditions",
			dedupeRevision: 0,
			execute,
		};
		const first = await journal.execute(input);
		const second = await journal.execute(input);

		expect(first.reused).toBe(false);
		expect(second.reused).toBe(true);
		expect(second.result).toEqual(first.result);
		expect(executions).toBe(1);
	});

	it("does not collapse actions whose secret values differ", async () => {
		const { run } = await fixture();
		const journal = new ActionExecutionJournal();
		let executions = 0;
		const execute = async () => ({
			ok: true,
			toolName: "external_write",
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			payload: { execution: ++executions },
		});

		await journal.execute({
			runId: run.id,
			toolName: "external_write",
			arguments: { token: "first-secret" },
			dedupeRevision: 0,
			execute,
		});
		await journal.execute({
			runId: run.id,
			toolName: "external_write",
			arguments: { token: "second-secret" },
			dedupeRevision: 0,
			execute,
		});

		expect(executions).toBe(2);
	});

	it("persists thrown side effects as typed failures instead of leaving pending records", async () => {
		const { run } = await fixture();
		const journal = new ActionExecutionJournal();
		let executions = 0;
		const input = {
			runId: run.id,
			toolName: "external_write",
			arguments: { value: "same" },
			dedupeRevision: 0,
			execute: async () => {
				executions += 1;
				throw new Error("remote write failed");
			},
		};

		const first = await journal.execute(input);
		const second = await journal.execute(input);

		expect(first.result).toMatchObject({
			ok: false,
			error: { code: "WORKER_ACTION_FAILED", message: "remote write failed" },
		});
		expect(second.reused).toBe(true);
		expect(second.result).toEqual(first.result);
		expect(executions).toBe(1);
	});

	it("requires a plan and explicit Todo completion", async () => {
		const { run, service } = await fixture();
		const controller = new RunFinalizeController();
		expect(await controller.evaluateCandidate({ runId: run.id })).toMatchObject(
			{
				allowFinalize: false,
				code: "RUN_HAS_OPEN_TODOS",
			},
		);
		const plan = await service.execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [{ title: "実装", nextAction: "対象を変更する" }],
		});
		if (!plan.ok) throw new Error(plan.error.code);
		const todo = plan.todos[0];
		const started = await service.execute(run.id, {
			op: "start",
			todoId: todo.id,
			expectedTodoRevision: todo.revision,
		});
		if (!started.ok) throw new Error(started.error.code);
		expect(await controller.evaluateCandidate({ runId: run.id })).toMatchObject(
			{
				allowFinalize: false,
				code: "RUN_HAS_OPEN_TODOS",
			},
		);
		const current = started.currentTodo;
		if (!current) throw new Error("current Todo missing");
		await service.execute(run.id, {
			op: "transition",
			todoId: current.id,
			expectedTodoRevision: current.revision,
			status: "passed",
			reason: "実装と必要な確認を完了した。",
		});
		expect(await controller.evaluateCandidate({ runId: run.id })).toMatchObject(
			{
				allowFinalize: true,
				code: "FINALIZE_ALLOWED",
			},
		);
	});

	it("reports revision conflicts and needs_human without evidence gates", async () => {
		const { run, service } = await fixture();
		const controller = new RunFinalizeController();
		const plan = await service.execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [{ title: "確認", nextAction: "不足情報を確認する" }],
		});
		if (!plan.ok) throw new Error(plan.error.code);
		const started = await service.execute(run.id, {
			op: "start",
			todoId: plan.todos[0].id,
			expectedTodoRevision: plan.todos[0].revision,
		});
		if (!started.ok || !started.currentTodo) throw new Error("start failed");
		await service.execute(run.id, {
			op: "transition",
			todoId: started.currentTodo.id,
			expectedTodoRevision: started.currentTodo.revision,
			status: "needs_human",
			reason: "利用者の判断が必要。",
		});
		expect(
			await controller.evaluateCandidate({
				runId: run.id,
				expectedPlanRevision: 0,
			}),
		).toMatchObject({ allowFinalize: false, code: "TODO_REVISION_CONFLICT" });
		expect(await controller.evaluateCandidate({ runId: run.id })).toMatchObject(
			{
				allowFinalize: false,
				code: "RUN_NEEDS_HUMAN",
			},
		);
	});

	it("allows completion after Todo closure without a Coding Agent Questionnaire gate", async () => {
		const { run, service } = await fixture();
		const controller = new RunFinalizeController();
		const plan = await service.execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [{ title: "計画", nextAction: "Questionnaireを開始する" }],
		});
		if (!plan.ok) throw new Error(plan.error.code);
		const started = await service.execute(run.id, {
			op: "start",
			todoId: plan.todos[0].id,
			expectedTodoRevision: plan.todos[0].revision,
		});
		if (!started.ok || !started.currentTodo) throw new Error("start failed");
		await service.execute(run.id, {
			op: "transition",
			todoId: started.currentTodo.id,
			expectedTodoRevision: started.currentTodo.revision,
			status: "passed",
			reason: "誤ってQuestionnaire前に完了しようとした。",
		});
		await updateTaskRun(run.id, {
			contextSnapshot: {
				planModeClosed: true,
			},
		});
		expect(await controller.evaluateCandidate({ runId: run.id })).toMatchObject(
			{
				allowFinalize: true,
				code: "FINALIZE_ALLOWED",
			},
		);
	});
});
