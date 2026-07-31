import crypto from "node:crypto";
import type { MissionPilotActionFailure } from "../../../contracts";
import { callMissionPilotPersistence } from "../../persistence-port";

export class MissionPilotActionExecutionConflictError extends Error {
	readonly code = "MISSION_PILOT_ACTION_IDEMPOTENCY_CONFLICT";

	constructor(
		message = "Mission Pilot action idempotency key was reused with different arguments.",
	) {
		super(message);
		this.name = "MissionPilotActionExecutionConflictError";
	}
}

export async function createMissionPilotActionExecutionIntent(input: {
	sessionId: string;
	taskId: string;
	toolCallId: string;
	actionId: string;
	idempotencyKey: string;
	arguments: unknown;
	expectedTaskRevision: number | null;
}) {
	try {
		return await callMissionPilotPersistence(
			"createMissionPilotActionExecutionIntent",
			input,
		);
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "MISSION_PILOT_ACTION_IDEMPOTENCY_CONFLICT"
		)
			throw new MissionPilotActionExecutionConflictError(
				error instanceof Error ? error.message : undefined,
			);
		throw error;
	}
}

export function getMissionPilotActionExecutionByToolCall(
	sessionId: string,
	toolCallId: string,
) {
	return callMissionPilotPersistence(
		"getMissionPilotActionExecutionByToolCall",
		sessionId,
		toolCallId,
	);
}

export function getLatestSucceededMissionPilotImplementationRunId(
	sessionId: string,
) {
	return callMissionPilotPersistence<string | null>(
		"getLatestSucceededMissionPilotImplementationRunId",
		sessionId,
	);
}

export function claimMissionPilotActionExecution(id: string) {
	return callMissionPilotPersistence("claimMissionPilotActionExecution", id);
}

export function completeMissionPilotActionExecution(input: {
	id: string;
	result?: unknown;
	failure?: MissionPilotActionFailure;
	status?: "succeeded" | "failed" | "outcome_unknown";
	sourceResourceType?: string | null;
	sourceResourceId?: string | null;
}) {
	return callMissionPilotPersistence(
		"completeMissionPilotActionExecution",
		input,
	);
}

export function listMissionPilotActionExecutionReceipts(sessionId: string) {
	return callMissionPilotPersistence(
		"listMissionPilotActionExecutionReceipts",
		sessionId,
	);
}

export function reconcileMissionPilotActionExecutionReceipts(
	sessionId: string,
) {
	return callMissionPilotPersistence(
		"reconcileMissionPilotActionExecutionReceipts",
		sessionId,
	);
}

export function digestArguments(value: unknown) {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(canonicalize(value)))
		.digest("hex");
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, canonicalize(child)]),
	);
}
