import type { TaskOperatorFailure } from "../../../shared/modules/taskOperator";
import { AppError } from "../../lib/errors";

export type StoredTaskOperatorFailure = TaskOperatorFailure & {
	statusCode: number;
	details?: Record<string, unknown>;
};

export function normalizeTaskOperatorCommandFailure(
	error: unknown,
): StoredTaskOperatorFailure {
	if (!(error instanceof AppError)) {
		return {
			kind: "internal",
			statusCode: 500,
			code: "TASK_OPERATOR_COMMAND_FAILED",
			message: "Coding Agent command failed internally.",
			retryable: false,
			currentRevision: null,
		};
	}
	const currentRevision = readCurrentRevision(error.details);
	return {
		kind: failureKind(error, currentRevision),
		statusCode: error.statusCode,
		code: error.code,
		message: error.message.slice(0, 2_000),
		retryable: false,
		currentRevision,
		...(error.details ? { details: error.details } : {}),
	};
}

export function taskOperatorFailureContract(
	failure: StoredTaskOperatorFailure,
): TaskOperatorFailure {
	return {
		kind: failure.kind,
		code: failure.code,
		message: failure.message,
		retryable: failure.retryable,
		currentRevision: failure.currentRevision,
	};
}

export function taskOperatorCommandFailureResponse(error: unknown): {
	failure: TaskOperatorFailure;
	statusCode: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;
} {
	const stored = normalizeTaskOperatorCommandFailure(error);
	return {
		failure: taskOperatorFailureContract(stored),
		statusCode: commandTransportStatus(stored.statusCode),
	};
}

function readCurrentRevision(details?: Record<string, unknown>) {
	for (const key of [
		"currentTaskRevision",
		"currentTodoRevision",
		"currentRevision",
	]) {
		const value = details?.[key];
		if (typeof value === "number") return value;
	}
	return null;
}

function commandTransportStatus(
	statusCode: number,
): 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 {
	switch (statusCode) {
		case 400:
		case 401:
		case 403:
		case 404:
		case 409:
		case 422:
		case 429:
			return statusCode;
		default:
			return statusCode >= 400 && statusCode < 500 ? 400 : 500;
	}
}

function failureKind(
	error: AppError,
	currentRevision: number | null,
): TaskOperatorFailure["kind"] {
	switch (error.code) {
		case "TASK_OPERATOR_PERMISSION_DENIED":
			return "permission_denied";
		case "TASK_REVISION_CONFLICT":
		case "TODO_REVISION_CONFLICT":
			return "revision_conflict";
		case "TASK_RESOURCE_OWNERSHIP_MISMATCH":
			return "ownership_mismatch";
		case "TASK_OPERATOR_IDEMPOTENCY_CONFLICT":
			return "idempotency_conflict";
		case "TASK_OPERATOR_SCHEMA_VALIDATION":
		case "TASK_OPERATOR_ARGUMENT_REQUIRED":
			return "schema_validation";
	}
	if (error.statusCode === 401 || error.statusCode === 403)
		return "permission_denied";
	if (error.statusCode === 404) return "not_found";
	if (error.statusCode === 409 && currentRevision !== null)
		return "revision_conflict";
	if (error.statusCode === 422) return "schema_validation";
	if (error.statusCode === 429) return "resource_limit";
	if (error.statusCode >= 500) return "internal";
	return "domain_precondition";
}
