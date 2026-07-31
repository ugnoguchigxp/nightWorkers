import { isDeepStrictEqual } from "node:util";
import { type AppError, isAppError } from "../../../lib/errors";
import { callMissionPilotPersistence } from "../../persistence-port";
import {
	getTaskOperatorActionDefinition,
	readTaskOperatorProjection,
} from "../../taskOperator";
import { createMissionPilotTaskOperatorAccess } from "../mission-pilot-delegation";
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
	getMissionPilotActionUnavailableReason,
	validateMissionPilotActionArguments,
} from "./mission-pilot-task-action.registry";
import {
	hasConsumedMissionPilotQuestionnaireAnsweringEvent,
	projectMissionPilotExecutionEvent,
} from "./mission-pilot-task-event.repository";

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
		const definition = getTaskOperatorActionDefinition(input.actionId);
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
		const { session, toolCall, agent } = await callMissionPilotPersistence(
			"readMissionPilotTaskActionState",
			{
				sessionId: input.sessionId,
				taskId: input.taskId,
				toolCallId: input.toolCallId,
				actionId: input.actionId,
				idempotencyKey: input.idempotencyKey,
			},
		);
		if (!session)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"domain_precondition",
				"Task or Mission Pilot session not found",
			);
		let access: Awaited<
			ReturnType<typeof createMissionPilotTaskOperatorAccess>
		>;
		let projection: Awaited<ReturnType<typeof readTaskOperatorProjection>>;
		try {
			access = await createMissionPilotTaskOperatorAccess({
				sessionId: input.sessionId,
				taskId: input.taskId,
			});
			projection = await readTaskOperatorProjection(
				input.taskId,
				access.context,
				access.delegatedAuthorization,
			);
		} catch (error) {
			return failed(
				input.actionId,
				input.idempotencyKey,
				"permission",
				error instanceof Error ? error.message : String(error),
			);
		}
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
			!isDeepStrictEqual(
				normalizePersistedActionArguments(toolCall.argumentsJson),
				input.arguments,
			) ||
			toolCall.expectedTaskRevision !== input.expectedTaskRevision
		)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"invalid_request",
				"Task action arguments do not match the persisted tool call.",
			);
		if (input.expectedTaskRevision !== projection.task.revision)
			return failed(
				input.actionId,
				input.idempotencyKey,
				"revision_conflict",
				"Task revision changed; re-read the Task workspace.",
				{ currentTaskRevision: projection.task.revision },
			);
		if (input.actionId === "questionnaire.submit") {
			const questionnaireSessionId = readText(
				validated.data.questionnaireSessionId,
			);
			if (
				!questionnaireSessionId ||
				!(await hasConsumedMissionPilotQuestionnaireAnsweringEvent({
					sessionId: input.sessionId,
					questionnaireSessionId,
				}))
			)
				return failed(
					input.actionId,
					input.idempotencyKey,
					"domain_precondition",
					"Questionnaireへの代理回答は、ユーザー待機時間が終了したanswering eventを受信した後にだけ実行できます。",
				);
		}
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
					principal: access.context.principal,
					signal,
				},
			);
			await completeMissionPilotActionExecution({
				id: receipt.id,
				result: data,
				sourceResourceType: input.actionId,
				sourceResourceId: resourceId(data),
			});
			const startedRunId =
				input.actionId === "run.implementation.start" ? resourceId(data) : null;
			if (startedRunId)
				await projectMissionPilotExecutionEvent({
					taskId: input.taskId,
					type: "task.run.started",
					runId: startedRunId,
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
				isAppError(error) && error.statusCode < 500
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

function normalizePersistedActionArguments(value: unknown) {
	const record = readRecord(value);
	const nested = readRecord(record.arguments);
	return Object.keys(nested).length > 0 || "arguments" in record
		? nested
		: record;
}

function stoppedDuringAction(actionId: string, idempotencyKey: string) {
	return failed(
		actionId,
		idempotencyKey,
		"outcome_unknown",
		"Mission Pilot was stopped while the Task action was running. Re-read the current resource before retrying.",
	);
}

function resourceId(value: unknown) {
	const result = readRecord(value);
	const receipt = readRecord(result.receipt);
	const operationRef = readRecord(receipt.operationRef);
	const operationId = readText(operationRef.id);
	if (operationId) return operationId;
	const data = readRecord(result.data);
	for (const key of ["runId", "id", "taskId"]) {
		const id = readText(data[key]) ?? readText(result[key]);
		if (id) return id;
	}
	return null;
}
function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function readText(value: unknown) {
	return typeof value === "string" ? value : null;
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
				typeof currentTaskRevision === "number"
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
