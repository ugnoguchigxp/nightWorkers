import { db } from "../../../db/client";
import { withSqliteBusyRetry } from "../../../db/retry";
import {
	type AgentModeSessionRouteIdentity,
	resolveOrOpenAgentModeSession,
} from "../../../services/agent-runtime/agent-mode-session";
import type { AgentExecutionMode } from "../../../services/agent-runtime/types";
import * as repo from "../nightworkers.repository";

export async function createTaskRunInAgentModeSession(input: {
	taskId: string;
	repositoryId: string;
	executionMode: AgentExecutionMode;
	llmRole: string;
	routeIdentity: AgentModeSessionRouteIdentity & { fingerprint: string };
	taskRun: Parameters<typeof repo.createTaskRun>[0];
}) {
	const { taskId, repositoryId, executionMode, llmRole, routeIdentity } = input;
	return withSqliteBusyRetry(() =>
		db.transaction(async (tx) => {
			const sessionTransition = await resolveOrOpenAgentModeSession(tx, {
				taskId,
				repositoryId,
				executionMode,
				llmRole,
				routeIdentity,
			});
			const run = await repo.createTaskRun(
				{
					...input.taskRun,
					agentModeSessionId: sessionTransition.session.id,
				},
				tx,
			);
			if (!run) throw new Error("Failed to create task run.");
			return { run, sessionTransition };
		}),
	);
}

export async function recordAgentModeSessionTransition(input: {
	runId: string;
	taskId: string;
	executionMode: AgentExecutionMode;
	llmRole: string;
	routeFingerprint: string;
	sessionTransition: Awaited<
		ReturnType<typeof createTaskRunInAgentModeSession>
	>["sessionTransition"];
}) {
	const { runId, taskId, executionMode, llmRole, routeFingerprint } = input;
	const { sessionTransition } = input;
	await repo.createRunEvent({
		version: 1,
		runId,
		taskId,
		timestamp: new Date().toISOString(),
		type:
			sessionTransition.transition === "reused"
				? "agent_mode_session.reused"
				: "agent_mode_session.opened",
		severity: "info",
		actor: "system",
		message:
			sessionTransition.transition === "reused"
				? "Agent mode session reused for the same execution route."
				: "Agent mode session opened for the execution route.",
		data: {
			agentModeSessionId: sessionTransition.session.id,
			epoch: sessionTransition.session.epoch,
			executionMode,
			llmRole,
			routeFingerprint,
			transition: sessionTransition.transition,
			predecessorSessionId: sessionTransition.predecessorSessionId ?? null,
		},
	});
}
