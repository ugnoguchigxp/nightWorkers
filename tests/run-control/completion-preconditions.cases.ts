import { afterEach, describe, expect, it } from "vitest";
import { db } from "../../api/db/client";
import { verificationDocuments } from "../../api/db/verification-schema";
import { ActionExecutionJournal } from "../../api/modules/codingAgent/application/action-execution-journal";
import { RunFinalizeController } from "../../api/modules/codingAgent/application/run-finalize-controller";
import {
	type CodingAgentSystemContextSnapshot,
	TodoMutationService,
} from "../../api/modules/codingAgent/todo";
import {
	createRepository,
	createTask,
	createTaskRun,
	deleteRepository,
	updateTaskRun,
} from "../../api/modules/nightworkers/nightworkers.repository";

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
	planModeRequested: false,
	todoPolicy: "adaptive",
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
	return {
		task,
		run,
		service: new TodoMutationService(systemContext, "agent"),
	};
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

	it("allows no-plan completion and requires explicit closeout after Todo adoption", async () => {
		const { run, service } = await fixture();
		const controller = new RunFinalizeController();
		expect(await controller.evaluateCandidate({ runId: run.id })).toMatchObject(
			{
				allowFinalize: true,
				code: "FINALIZE_ALLOWED",
			},
		);
		const plan = await service.execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					title: "実装",
					systemContext: "完了条件を満たす変更を実装する。",
					nextAction: "対象を変更する",
				},
			],
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

	it("reconciles terminal Todos with an active verification result", async () => {
		const { task, run, service } = await fixture();
		const plan = await service.execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					title: "実装",
					systemContext: "変更と検証を完了し、完了判定へ必要な証拠を残す。",
					nextAction: "対象を変更して検証する",
				},
			],
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
			reason: "Todo上の作業は完了した。",
		});
		const controller = new RunFinalizeController({
			evaluateReadiness: async (input) => ({
				ready: false,
				authority: {
					taskId: task.id,
					runId: run.id,
					repositoryRoot: input.repositoryRoot,
					verificationDocumentId: "verification-document",
				},
				task: { goalDigest: "goal-digest" },
				workspace: { sourceStateHash: "source-hash" },
				verification: {
					applicability: "active",
					checkedSourceStateHash: "source-hash",
					result: null,
				},
				candidate: { revision: 1, digest: "candidate-digest" },
				discrepancies: [
					{
						code: "missing_successful_full_verify",
						summary: "full verify evidence is missing",
					},
				],
				satisfactionConditions: [
					"現在のsourceに対するfull verify結果を確認する。",
				],
			}),
		});

		const result = await controller.evaluateCandidate({
			runId: run.id,
			repositoryRoot: "/tmp/completion-preconditions",
			candidateRevision: 1,
			finalCandidate: "実装完了です。",
		});

		expect(result).toMatchObject({
			allowFinalize: false,
			code: "FINALIZE_RECONCILIATION_REQUIRED",
			missingConditions: ["現在のsourceに対するfull verify結果を確認する。"],
			snapshot: {
				readiness: {
					ready: false,
					authority: { taskId: task.id, runId: run.id },
					discrepancies: [{ code: "missing_successful_full_verify" }],
				},
			},
		});
	});

	it("loads the active verification document before allowing completion", async () => {
		const { task, run, service } = await fixture();
		await db.insert(verificationDocuments).values({
			taskId: task.id,
			runId: run.id,
			sourceSpecPath: "spec/docs/completion-fixture.md",
			documentJson: {},
			generatedAt: new Date(),
			status: "active",
		});
		const plan = await service.execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					title: "実装",
					systemContext:
						"active verification documentの条件を満たす変更と検証を行う。",
					nextAction: "対象を変更して検証する",
				},
			],
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
			reason: "Todo上の作業は完了した。",
		});

		const result = await new RunFinalizeController().evaluateCandidate({
			runId: run.id,
			repositoryRoot: process.cwd(),
			candidateRevision: 1,
			finalCandidate: "実装完了です。",
		});

		expect(result).toMatchObject({
			allowFinalize: false,
			code: "FINALIZE_RECONCILIATION_REQUIRED",
			snapshot: {
				readiness: {
					ready: false,
					verification: {
						applicability: "active",
						result: { ok: false },
					},
				},
			},
		});
		expect(result.snapshot?.readiness?.discrepancies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "required_conditions_incomplete" }),
				expect.objectContaining({ code: "missing_active_test_discovery" }),
				expect.objectContaining({ code: "missing_successful_test_execution" }),
				expect.objectContaining({ code: "missing_successful_full_verify" }),
			]),
		);
	});

	it("reports revision conflicts and needs_human without evidence gates", async () => {
		const { run, service } = await fixture();
		const controller = new RunFinalizeController();
		const plan = await service.execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					title: "確認",
					systemContext:
						"不足情報が人間の判断を要する場合はneeds_humanへ遷移する。",
					nextAction: "不足情報を確認する",
				},
			],
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
			todos: [
				{
					title: "計画",
					systemContext: "Coding AgentのTodo完了条件だけでcloseoutを評価する。",
					nextAction: "Questionnaireを開始する",
				},
			],
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
