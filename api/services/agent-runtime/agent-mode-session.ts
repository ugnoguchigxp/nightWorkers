import { and, desc, eq, max } from "drizzle-orm";
import { type DbTransaction, db } from "../../db/client";
import { agentModeSessions } from "../../db/schema";
import { digestText } from "../text-digest";
import type { AgentExecutionMode } from "./types";

export type AgentModeSessionStatus = "active" | "closed" | "invalid";
export type AgentModeSessionCloseReason =
	| "mode_changed"
	| "role_route_changed"
	| "route_identity_unavailable"
	| "task_closed"
	| "explicit_reset"
	| "superseded_by_concurrent_transition";

export type AgentModeSessionRouteIdentity = {
	runtimeLane: string;
	provider: string | null;
	providerEndpointId: string | null;
	model: string | null;
	thinkingDepth: string | null;
	fingerprint?: string;
	continuationEligible: boolean;
};

export function buildAgentModeSessionRouteIdentity(input: {
	executionMode: AgentExecutionMode | string;
	llmRole: string;
	runtimeLane: string;
	provider?: string | null;
	providerEndpointId?: string | null;
	model?: string | null;
	thinkingDepth?: string | null;
}) {
	const canonical = [
		input.executionMode,
		input.llmRole,
		input.runtimeLane,
		input.provider ?? null,
		input.providerEndpointId ?? null,
		input.model ?? null,
		input.thinkingDepth ?? null,
	];
	return digestText(JSON.stringify(canonical));
}

export type ResolveOrOpenAgentModeSessionInput = {
	taskId: string;
	repositoryId: string;
	executionMode: AgentExecutionMode | string;
	llmRole: string;
	routeIdentity: AgentModeSessionRouteIdentity;
};

export type ResolveOrOpenAgentModeSessionResult = {
	session: typeof agentModeSessions.$inferSelect;
	transition: "reused" | "opened";
	closeReason?: AgentModeSessionCloseReason;
	predecessorSessionId?: string;
};

/**
 * Resolve a logical agent epoch inside a caller-owned transaction.
 * The caller must insert the TaskRun in the same transaction.
 */
export async function resolveOrOpenAgentModeSession(
	tx: DbTransaction,
	input: ResolveOrOpenAgentModeSessionInput,
): Promise<ResolveOrOpenAgentModeSessionResult> {
	const [active] = await tx
		.select()
		.from(agentModeSessions)
		.where(
			and(
				eq(agentModeSessions.taskId, input.taskId),
				eq(agentModeSessions.status, "active"),
			),
		)
		.orderBy(desc(agentModeSessions.updatedAt))
		.limit(1);
	const fingerprint =
		input.routeIdentity.fingerprint ??
		buildAgentModeSessionRouteIdentity({
			executionMode: input.executionMode,
			llmRole: input.llmRole,
			runtimeLane: input.routeIdentity.runtimeLane,
			provider: input.routeIdentity.provider,
			providerEndpointId: input.routeIdentity.providerEndpointId,
			model: input.routeIdentity.model,
			thinkingDepth: input.routeIdentity.thinkingDepth,
		});

	if (
		active &&
		input.routeIdentity.continuationEligible &&
		active.executionMode === input.executionMode &&
		active.llmRole === input.llmRole &&
		active.routeFingerprint === fingerprint
	) {
		return { session: active, transition: "reused" };
	}

	const closeReason = active
		? resolveCloseReason(active, input, fingerprint)
		: undefined;
	if (active) {
		await tx
			.update(agentModeSessions)
			.set({
				status: "closed",
				closeReason,
				closedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(agentModeSessions.id, active.id));
	}

	const [epochRow] = await tx
		.select({ epoch: max(agentModeSessions.epoch) })
		.from(agentModeSessions)
		.where(eq(agentModeSessions.taskId, input.taskId));
	const epoch = Number(epochRow?.epoch ?? 0) + 1;
	const now = new Date();
	const [session] = await tx
		.insert(agentModeSessions)
		.values({
			taskId: input.taskId,
			repositoryId: input.repositoryId,
			epoch,
			predecessorSessionId: active?.id ?? null,
			executionMode: input.executionMode,
			llmRole: input.llmRole,
			runtimeLane: input.routeIdentity.runtimeLane,
			provider: input.routeIdentity.provider,
			providerEndpointId: input.routeIdentity.providerEndpointId,
			model: input.routeIdentity.model,
			thinkingDepth: input.routeIdentity.thinkingDepth,
			routeFingerprint: fingerprint,
			status: "active",
			openedAt: now,
		})
		.returning();
	if (!session) throw new Error("Failed to open agent mode session.");
	return {
		session,
		transition: "opened",
		...(closeReason ? { closeReason } : {}),
		...(active ? { predecessorSessionId: active.id } : {}),
	};
}

function resolveCloseReason(
	active: typeof agentModeSessions.$inferSelect,
	input: ResolveOrOpenAgentModeSessionInput,
	fingerprint: string,
): AgentModeSessionCloseReason {
	if (active.executionMode !== input.executionMode) return "mode_changed";
	if (
		active.llmRole !== input.llmRole ||
		active.routeFingerprint !== fingerprint
	)
		return "role_route_changed";
	return input.routeIdentity.continuationEligible
		? "superseded_by_concurrent_transition"
		: "route_identity_unavailable";
}

export async function closeActiveAgentModeSession(
	tx: DbTransaction,
	input: {
		taskId: string;
		reason: AgentModeSessionCloseReason;
	},
) {
	const now = new Date();
	return tx
		.update(agentModeSessions)
		.set({
			status: "closed",
			closeReason: input.reason,
			closedAt: now,
			updatedAt: now,
		})
		.where(
			and(
				eq(agentModeSessions.taskId, input.taskId),
				eq(agentModeSessions.status, "active"),
			),
		)
		.returning();
}

export async function listAgentModeSessionsForTask(taskId: string) {
	return db
		.select()
		.from(agentModeSessions)
		.where(eq(agentModeSessions.taskId, taskId))
		.orderBy(agentModeSessions.epoch);
}
