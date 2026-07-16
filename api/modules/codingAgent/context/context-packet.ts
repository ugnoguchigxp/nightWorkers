import * as repo from "../../nightworkers/nightworkers.repository";
import { buildCodingAgentSystemContext } from "./system-context";
import type {
	CodingAgentContextPacket,
	CodingAgentCurrentTodoContext,
} from "./types";

export async function loadCodingAgentContextPacket(
	runId: string,
): Promise<CodingAgentContextPacket | null> {
	const run = await repo.getTaskRun(runId);
	if (!run) return null;
	const [task, repository, todos] = await Promise.all([
		repo.getTask(run.taskId),
		run.repositoryId ? repo.getRepository(run.repositoryId) : null,
		repo.listTaskRunTodosForRun(run.id),
	]);
	if (!task || !repository) return null;
	const systemContext = buildCodingAgentSystemContext({
		taskGoal: [task.title, task.description].filter(Boolean).join("\n"),
		projectRulesJa: [],
		registeredRepositoryRoot: repository.localPath,
	});
	const current = todos.filter((todo) => todo.status === "running");
	return {
		systemContext,
		planSummary: {
			planRevision: run.todoPlanRevision,
			counts: {
				pending: todos.filter((todo) => todo.status === "pending").length,
				running: current.length,
				terminal: todos.filter((todo) =>
					["passed", "skipped"].includes(todo.status),
				).length,
				needsHuman: todos.filter((todo) => todo.status === "needs_human")
					.length,
			},
			todos: todos.map((todo) => ({
				id: todo.id,
				seq: todo.seq,
				title: todo.title,
				status: todo.status,
				revision: todo.revision,
			})),
		},
		currentTodo: current.length === 1 ? toCurrentTodoContext(current[0]) : null,
	};
}

export function renderCodingAgentContextPacket(
	packet: CodingAgentContextPacket,
): string {
	return [
		"[Coding Agent System Context]",
		JSON.stringify(packet.systemContext, null, 2),
		"",
		"[Todo Plan Summary]",
		JSON.stringify(packet.planSummary, null, 2),
		"",
		"[Current Todo Detail]",
		JSON.stringify(packet.currentTodo, null, 2),
	].join("\n");
}

function toCurrentTodoContext(
	todo: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>[number],
): CodingAgentCurrentTodoContext {
	return {
		id: todo.id,
		seq: todo.seq,
		revision: todo.revision,
		title: todo.title,
		objective: todo.objective ?? todo.description ?? null,
		context: todo.context,
		nextAction: todo.nextAction,
		acceptanceCriteria: Array.isArray(todo.acceptanceCriteriaJson)
			? todo.acceptanceCriteriaJson.filter(
					(value): value is string => typeof value === "string",
				)
			: [],
		dependsOn: Array.isArray(todo.dependsOn)
			? todo.dependsOn.filter(
					(value): value is string => typeof value === "string",
				)
			: [],
		lastFailure: todo.lastFailure,
		attemptCount: todo.attemptCount,
		statusReason: todo.statusReason,
		systemContextVersion: todo.systemContextVersion,
		systemContextSnapshot: todo.systemContextSnapshot,
	};
}
