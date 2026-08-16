import { humanBlockerSchema } from "../../../../shared/modules/codingAgent";
import {
	bindSystemContextTextCatalog,
	readSystemContextBindingSnapshot,
} from "../../../systemContexts/catalog";
import { requireCodingAgentHost } from "../ports/coding-agent-host.binding";
import type { CodingAgentHostPorts } from "../ports/coding-agent-host.port";
import type { CodingAgentRunTodoSnapshot } from "../ports/coding-agent-host.types";
import {
	buildCodingAgentSystemContext,
	buildCodingAgentTaskGoal,
	readCodingAgentPlanModeRequested,
} from "./system-context";
import type {
	CodingAgentContextPacket,
	CodingAgentCurrentTodoContext,
} from "./types";

export async function loadCodingAgentContextPacket(
	runId: string,
	host: CodingAgentHostPorts = requireCodingAgentHost(),
): Promise<CodingAgentContextPacket | null> {
	const run = await host.runReader.getRun(runId);
	if (!run) return null;
	const [task, repository, todos] = await Promise.all([
		host.taskReader.getTask(run.taskId),
		run.repositoryId ? host.taskReader.getRepository(run.repositoryId) : null,
		host.runReader.listRunTodos(run.id),
	]);
	if (!task || !repository) return null;
	const systemContexts = bindSystemContextTextCatalog(
		readSystemContextBindingSnapshot(run.contextSnapshot) ?? undefined,
	);
	const systemContext = buildCodingAgentSystemContext(
		{
			taskGoal: buildCodingAgentTaskGoal(task),
			projectRulesJa: [],
			registeredRepositoryRoot: repository.localPath,
			planModeRequested: readCodingAgentPlanModeRequested(run.contextSnapshot),
		},
		systemContexts.p,
	);
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
				todoKey: todo.todoKey,
				seq: todo.seq,
				title: todo.title,
				status: todo.status,
				revision: todo.revision,
				humanBlocker: parseHumanBlocker(todo.humanBlocker),
			})),
		},
		currentTodo: current.length === 1 ? toCurrentTodoContext(current[0]) : null,
	};
}

function parseHumanBlocker(value: unknown) {
	const parsed = humanBlockerSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export function renderCodingAgentContextPacket(
	packet: CodingAgentContextPacket,
): string {
	return [
		"[Coding Agent System Context]",
		JSON.stringify(packet.systemContext, null, 2),
		"",
		"[Todo Plan Summary]",
		JSON.stringify(
			{
				counts: packet.planSummary.counts,
				next:
					packet.planSummary.todos.find((todo) => todo.status === "pending")
						?.title ?? null,
			},
			null,
			2,
		),
		"",
		"[Current Todo Detail]",
		JSON.stringify(
			packet.currentTodo
				? {
						title: packet.currentTodo.title,
						systemContext: packet.currentTodo.systemContext,
						lastFailure: packet.currentTodo.lastFailure,
						attemptCount: packet.currentTodo.attemptCount,
					}
				: null,
			null,
			2,
		),
	].join("\n");
}

export function requiresCurrentTodo(
	packet:
		| {
				planSummary: { todos: readonly unknown[] };
				currentTodo: unknown;
		  }
		| null
		| undefined,
) {
	if (!packet) return true;
	return packet.planSummary.todos.length > 0 && !packet.currentTodo;
}

function toCurrentTodoContext(
	todo: CodingAgentRunTodoSnapshot,
): CodingAgentCurrentTodoContext {
	return {
		id: todo.id,
		todoKey: todo.todoKey,
		seq: todo.seq,
		revision: todo.revision,
		title: todo.title,
		taskType: todo.taskType,
		objective: todo.objective ?? todo.description ?? null,
		systemContext: todo.context ?? "",
		context: todo.context,
		nextAction: todo.nextAction,
		acceptanceCriteria: Array.isArray(todo.acceptanceCriteria)
			? todo.acceptanceCriteria.filter(
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
