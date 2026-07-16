import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotToolCalls,
} from "../../../db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import { tasks } from "../../../db/schema";
import { taskRuns } from "../../../db/schema-task-execution";
import { AppError } from "../../../lib/errors";
import { executeMissionPilotAction } from "./mission-pilot-action-command-executor";
import {
	claimMissionPilotActionExecution,
	completeMissionPilotActionExecution,
	createMissionPilotActionExecutionIntent,
} from "./mission-pilot-action-execution.repository";
import type {
	MissionPilotActionResult,
	MissionPilotTaskActionPort,
} from "./mission-pilot-agent.ports";
import {
	getMissionPilotActionDefinition,
	getMissionPilotActionUnavailableReason,
	validateMissionPilotActionArguments,
} from "./mission-pilot-task-action.registry";
import { actionResourceBelongsToTask } from "./mission-pilot-task-action-resources";

export const missionPilotTaskActionPort: MissionPilotTaskActionPort = {
	async execute(input) {
		const { signal } = input;
		if (signal.aborted)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"domain_precondition",
				"Mission Pilot was stopped before the Task action started.",
			);
		const definition = getMissionPilotActionDefinition(input.actionId);
		if (!definition)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"invalid_request",
				"Unknown Task action",
			);
		const unavailableReason = getMissionPilotActionUnavailableReason(
			input.actionId,
		);
		if (unavailableReason)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"domain_precondition",
				unavailableReason,
			);
		const validated = validateMissionPilotActionArguments(
			definition,
			input.arguments,
		);
		if (!validated.success)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"schema_validation",
				validated.message,
			);
		const [session, task, toolCall, agent] = await Promise.all([
			db.query.missionPilotSessions.findFirst({
				where: and(
					eq(missionPilotSessions.id, input.sessionId),
					eq(missionPilotSessions.taskId, input.taskId),
				),
			}),
			db.query.tasks.findFirst({ where: eq(tasks.id, input.taskId) }),
			db
				.select()
				.from(missionPilotToolCalls)
				.where(
					and(
						eq(missionPilotToolCalls.id, input.toolCallId),
						eq(missionPilotToolCalls.sessionId, input.sessionId),
						eq(missionPilotToolCalls.actionId, input.actionId),
						eq(missionPilotToolCalls.idempotencyKey, input.idempotencyKey),
					),
				)
				.then((rows) => rows[0] ?? null),
			db
				.select()
				.from(missionPilotAgentSessions)
				.where(eq(missionPilotAgentSessions.sessionId, input.sessionId))
				.then((rows) => rows[0] ?? null),
		]);
		if (!session || !task)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"domain_precondition",
				"Task or Mission Pilot session not found",
			);
		const authorization = session.authorizationJson;
		if (
			authorization?.version !== 3 ||
			authorization.sessionId !== session.id ||
			authorization.taskId !== task.id ||
			authorization.taskRef.source !== "task" ||
			authorization.taskRef.id !== task.id ||
			!authorization.scopes[definition.authorizationScope]
		)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"permission",
				`authorization scope ${definition.authorizationScope} is not granted`,
			);
		if (
			session.desiredState !== "playing" ||
			agent?.runtimeState !== "running" ||
			agent.leaseOwner !== input.leaseOwner ||
			agent.currentTurnId !== toolCall?.turnId
		)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"domain_precondition",
				"Mission Pilot is not in an active agent turn.",
			);
		if (toolCall?.status !== "running")
			return failed(
				input.actionId,
				input.idempotencyKey,
				"domain_precondition",
				"Task action tool call has not been claimed for execution.",
			);
		if (
			!isDeepStrictEqual(toolCall.argumentsJson, input.arguments) ||
			toolCall.expectedTaskRevision !== input.expectedTaskRevision ||
			validated.data.expectedTaskRevision !== input.expectedTaskRevision
		)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"invalid_request",
				"Task action arguments do not match the persisted tool call.",
			);
		if (input.expectedTaskRevision !== task.updatedAt.getTime())
			return failed(
				input.actionId,
				input.idempotencyKey,
				"revision_conflict",
				"Task revision changed; re-read the Task workspace.",
				{ currentTaskRevision: task.updatedAt.getTime() },
			);
		if (
			!(await actionResourceBelongsToTask(
				input.taskId,
				input.actionId,
				validated.data,
			))
		)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"permission",
				"The requested resource does not belong to this Task.",
			);
		if (input.actionId === "task.complete")
			await assertMissionPilotTaskCompletion({
				taskId: input.taskId,
				sessionId: input.sessionId,
				sourceRunId: requiredText(validated.data.sourceRunId),
			});
		let receipt: Awaited<
			ReturnType<typeof createMissionPilotActionExecutionIntent>
		>;
		try {
			receipt = await createMissionPilotActionExecutionIntent({
				sessionId: input.sessionId,
				taskId: input.taskId,
				toolCallId: input.toolCallId,
				actionId: input.actionId,
				idempotencyKey: input.idempotencyKey,
				arguments: validated.data,
				expectedTaskRevision: input.expectedTaskRevision,
			});
		} catch (error) {
			return failed(
				input.actionId,
				input.idempotencyKey,
				"invalid_request",
				error instanceof Error ? error.message : String(error),
			);
		}
		if (receipt.status === "succeeded")
			return {
				ok: true,
				actionId: input.actionId,
				data: receipt.resultJson,
				replayed: true,
			};
		if (receipt.status === "failed")
			return {
				ok: false,
				actionId: input.actionId,
				failure:
					receipt.failureJson ??
					failed(
						input.actionId,
						input.idempotencyKey,
						"domain_precondition",
						"Mission Pilot action receipt is failed.",
					).failure,
			};
		if (receipt.status === "outcome_unknown" || receipt.status === "executing")
			return failed(
				input.actionId,
				input.idempotencyKey,
				"outcome_unknown",
				"A previous process may have completed this mutation. Read the current resource before retrying.",
			);
		if (!(await claimMissionPilotActionExecution(receipt.id)))
			return failed(
				input.actionId,
				input.idempotencyKey,
				"outcome_unknown",
				"The action receipt changed before execution. Re-read current state before retrying.",
			);
		if (signal.aborted) {
			const result = stoppedBeforeAction(input.actionId, input.idempotencyKey);
			await completeMissionPilotActionExecution({
				id: receipt.id,
				status: "failed",
				failure: result.failure,
			});
			return result;
		}
		try {
			const data = await executeMissionPilotAction(
				input.taskId,
				input.actionId,
				validated.data,
				{
					sessionId: input.sessionId,
					toolCallId: input.toolCallId,
					idempotencyKey: input.idempotencyKey,
					expectedTaskRevision: input.expectedTaskRevision,
					sourceRunId: readRepairSourceRunId(validated.data),
					signal,
				},
			);
			await completeMissionPilotActionExecution({
				id: receipt.id,
				result: data,
				sourceResourceType: input.actionId,
				sourceResourceId: resourceId(data),
			});
			return { ok: true, actionId: input.actionId, data, replayed: false };
		} catch (error) {
			if (signal.aborted) {
				const result = stoppedDuringAction(
					input.actionId,
					input.idempotencyKey,
				);
				await completeMissionPilotActionExecution({
					id: receipt.id,
					status: "outcome_unknown",
					failure: result.failure,
				});
				return result;
			}
			const result =
				error instanceof AppError && error.statusCode < 500
					? failedFromAppError(input.actionId, input.idempotencyKey, error)
					: failed(
							input.actionId,
							input.idempotencyKey,
							"outcome_unknown",
							`Action execution outcome is unknown. Re-read the current resource before retrying. ${error instanceof Error ? error.message : String(error)}`,
						);
			await completeMissionPilotActionExecution({
				id: receipt.id,
				status:
					result.failure.kind === "outcome_unknown"
						? "outcome_unknown"
						: "failed",
				failure: result.failure,
			});
			return result;
		}
	},
};

function stoppedBeforeAction(actionId: string, idempotencyKey: string) {
	return failed(
		actionId,
		idempotencyKey,
		"domain_precondition",
		"Mission Pilot was stopped before the Task action started.",
	);
}

function stoppedDuringAction(actionId: string, idempotencyKey: string) {
	return failed(
		actionId,
		idempotencyKey,
		"outcome_unknown",
		"Mission Pilot was stopped while the Task action was running. Re-read the current resource before retrying.",
	);
}

async function assertMissionPilotTaskCompletion(input: {
	taskId: string;
	sessionId: string;
	sourceRunId: string;
}) {
	const [run] = await db
		.select()
		.from(taskRuns)
		.where(
			and(
				eq(taskRuns.id, input.sourceRunId),
				eq(taskRuns.taskId, input.taskId),
			),
		)
		.limit(1);
	if (!run)
		throw new Error("Task completion requires a Run owned by this Task.");
	if (
		![
			"completed",
			"failed",
			"cancelled",
			"needs_review",
			"blocked",
			"timed_out",
			"needs_human",
		].includes(run.status)
	)
		throw new Error("Task completion requires a terminal Run.");
	const provenance = readRecord(run.contextSnapshot).missionPilotAgent;
	if (readText(readRecord(provenance).sessionId) !== input.sessionId)
		throw new Error("Task completion requires the Mission Pilot-owned Run.");
	if (
		![run.finalReport, run.summary].some(
			(value) => typeof value === "string" && value.trim().length > 0,
		) &&
		!run.testResults
	)
		throw new Error("Task completion requires terminal verification evidence.");
}

function requiredText(value: unknown) {
	if (typeof value !== "string" || value.length === 0)
		throw new AppError(
			422,
			"MISSION_PILOT_ARGUMENT_REQUIRED",
			"A non-empty string is required.",
		);
	return value;
}
function resourceId(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? typeof (value as Record<string, unknown>).id === "string"
			? ((value as Record<string, unknown>).id as string)
			: null
		: null;
}
function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function readText(value: unknown) {
	return typeof value === "string" ? value : null;
}
function readRepairSourceRunId(args: Record<string, unknown>) {
	const repair = readRecord(args.repairRequest);
	const failure = readRecord(repair.failure);
	return readText(failure.sourceRunId);
}
function failed(
	actionId: string,
	idempotencyKey: string,
	kind: Parameters<typeof failureKind>[0],
	message: string,
	details?: Record<string, unknown>,
): Extract<MissionPilotActionResult, { ok: false }> {
	return {
		ok: false,
		actionId,
		failure: {
			kind,
			retryable: false,
			providerCode: null,
			httpStatus: null,
			message,
			retryAfterMs: null,
			attempt: 1,
			actionId,
			idempotencyKey,
			currentTaskRevision:
				typeof details?.currentTaskRevision === "number"
					? details.currentTaskRevision
					: null,
			details: details ?? null,
		},
	};
}
function failedFromAppError(
	actionId: string,
	idempotencyKey: string,
	error: AppError,
): Extract<MissionPilotActionResult, { ok: false }> {
	const currentTaskRevision = error.details?.currentTaskRevision;
	return {
		ok: false,
		actionId,
		failure: {
			kind:
				error.code === "TASK_REVISION_CONFLICT"
					? "revision_conflict"
					: error.statusCode === 401 || error.statusCode === 403
						? "permission"
						: "domain_precondition",
			retryable: false,
			providerCode: error.code,
			httpStatus: error.statusCode,
			message: error.message,
			retryAfterMs: null,
			attempt: 1,
			actionId,
			idempotencyKey,
			currentTaskRevision:
				typeof currentTaskRevision === "number" ? currentTaskRevision : null,
			details: error.details ?? null,
		},
	};
}
function failureKind(
	kind:
		| "invalid_request"
		| "schema_validation"
		| "domain_precondition"
		| "permission"
		| "revision_conflict"
		| "outcome_unknown",
) {
	return kind;
}
