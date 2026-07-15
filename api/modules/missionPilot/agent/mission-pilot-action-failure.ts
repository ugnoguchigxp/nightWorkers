import type {
	MissionPilotActionFailure,
	MissionPilotActionResult,
} from "../../../../shared/schemas/mission-pilot-agent.schema";
import { AppError } from "../../../lib/errors";

const failureKinds = new Set<MissionPilotActionFailure["kind"]>([
	"transport",
	"timeout",
	"rate_limit",
	"provider_capacity",
	"authentication",
	"invalid_request",
	"schema_validation",
	"domain_precondition",
	"permission",
	"provider_capability",
	"resource_limit",
	"revision_conflict",
	"outcome_unknown",
	"unknown",
]);

export function toMissionPilotActionFailure(
	error: unknown,
	actionId: string,
	idempotencyKey: string,
): MissionPilotActionFailure {
	const structured = asRecord(error);
	const status =
		error instanceof AppError
			? error.statusCode
			: typeof structured.httpStatus === "number"
				? structured.httpStatus
				: null;
	const providerCode =
		error instanceof AppError
			? error.code
			: typeof structured.code === "string"
				? structured.code
				: null;
	const structuredKind =
		typeof structured.kind === "string" &&
		failureKinds.has(structured.kind as MissionPilotActionFailure["kind"])
			? (structured.kind as MissionPilotActionFailure["kind"])
			: null;
	let kind: MissionPilotActionFailure["kind"] = structuredKind ?? "unknown";
	if (
		providerCode === "TASK_REVISION_CONFLICT" ||
		providerCode === "QUESTIONNAIRE_REVISION_CONFLICT"
	)
		kind = "revision_conflict";
	else if (status === 401) kind = "authentication";
	else if (status === 403) kind = "permission";
	else if (status === 429) kind = "rate_limit";
	else if (status !== null && status >= 500) kind = "provider_capacity";
	else if (status === 409 || status === 404) kind = "domain_precondition";
	else if (status === 400 || status === 422) kind = "invalid_request";
	return {
		kind,
		retryable:
			typeof structured.retryable === "boolean"
				? structured.retryable
				: kind === "rate_limit" || kind === "provider_capacity"
					? true
					: kind === "unknown"
						? null
						: false,
		providerCode,
		httpStatus: status,
		message: error instanceof Error ? error.message : String(error),
		retryAfterMs:
			typeof structured.retryAfterMs === "number"
				? structured.retryAfterMs
				: null,
		attempt: 1,
		actionId,
		idempotencyKey,
	};
}

export function missionPilotActionFailed(
	input: { actionId: string; idempotencyKey: string },
	kind: MissionPilotActionFailure["kind"],
	message: string,
	retryable: boolean | null,
): MissionPilotActionResult {
	return {
		ok: false,
		actionId: input.actionId,
		failure: {
			kind,
			retryable,
			providerCode: null,
			httpStatus: null,
			message,
			retryAfterMs: null,
			attempt: 1,
			actionId: input.actionId,
			idempotencyKey: input.idempotencyKey,
		},
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
