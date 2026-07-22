import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	start: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/run-orchestration/start-task-run", () => ({
	startTaskRun: runtimeMocks.start,
}));

import {
	type CodingAgentSystemContextSnapshot,
	TodoMutationService,
} from "../api/modules/codingAgent/todo";
import {
	createRepository,
	createTask,
	createTaskRun,
	deleteRepository,
	updateTaskRun,
} from "../api/modules/nightworkers/nightworkers.repository";
import { resumeTaskRunTodo } from "../api/modules/nightworkers/run-orchestration/resume-task-run";

const repositoryIds: string[] = [];
const systemContext: CodingAgentSystemContextSnapshot = {
	version: 1,
	roleInstructionsJa: "Coding Agentとして作業する。",
	taskGoal: "同じRunを再開する。",
	projectRulesJa: [],
	todoRequirementJa: "Todoを使用する。",
	failureRecoveryJa: "失敗を記録する。",
	completionRuleJa: "Todo完了後に終了する。",
	toolContractJa: "tool結果を確認する。",
	registeredRepositoryRoot: "/tmp/todo-resume-fixture",
	planModeRequested: false,
	todoPolicy: "adaptive",
};

afterEach(async () => {
	runtimeMocks.start.mockReset();
	for (const id of repositoryIds.splice(0)) await deleteRepository(id);
});

describe("resumeTaskRunTodo", () => {
	it("resumes the existing Run, Todo, and provider session launch", async () => {
		const repository = await createRepository({
			name: `TEST: todo-resume-${crypto.randomUUID()}`,
			localPath: "/tmp/todo-resume-fixture",
			branch: "main",
			allowed: true,
		});
		repositoryIds.push(repository.id);
		const task = await createTask({
			repositoryId: repository.id,
			title: "TEST: resume Todo",
			status: "running",
		});
		const run = await createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "running",
		});
		const todoService = new TodoMutationService(systemContext, "agent");
		const plan = await todoService.execute(run.id, {
			op: "replace_plan",
			expectedPlanRevision: 0,
			todos: [
				{
					title: "確認する",
					systemContext: "同じRunとTodoを維持したまま不足情報を確認する。",
					nextAction: "ユーザーへ質問する。",
				},
			],
		});
		if (!plan.ok) throw new Error(plan.error.code);
		const started = await todoService.execute(run.id, {
			op: "start",
			todoId: plan.todos[0].id,
			expectedTodoRevision: plan.todos[0].revision,
		});
		if (!started.ok || !started.currentTodo) throw new Error("start failed");
		const paused = await todoService.execute(run.id, {
			op: "transition",
			todoId: started.currentTodo.id,
			expectedTodoRevision: started.currentTodo.revision,
			status: "needs_human",
			reason: "対象環境を確認してください。",
		});
		if (!paused.ok) throw new Error(paused.error.code);
		await updateTaskRun(run.id, {
			status: "needs_human",
			endedAt: new Date(),
			finishedAt: new Date(),
		});
		runtimeMocks.start.mockResolvedValue({ ...run, status: "running" });
		const pausedTodo = paused.todos[0];

		const resumed = await resumeTaskRunTodo({
			runId: run.id,
			todoId: pausedTodo.id,
			expectedTodoRevision: pausedTodo.revision,
			userContext: "staging環境を使用してください。",
		});

		expect(resumed.id).toBe(run.id);
		expect(runtimeMocks.start).toHaveBeenCalledWith(
			task.id,
			expect.objectContaining({
				resumeRunId: run.id,
				latestUserMessageOverride: "staging環境を使用してください。",
				resumeCommand: {
					kind: "todo",
					todoId: pausedTodo.id,
					expectedTodoRevision: pausedTodo.revision,
					userContext: "staging環境を使用してください。",
				},
			}),
		);
	});
});
