import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
	type ApiErrorEnvelope,
	apiErrorEnvelopeSchema,
} from "../../shared/schemas/api-error.schema";
import { AppError } from "./errors";

type ApiErrorLogLevel = "warn" | "error";

export type SerializedApiError = {
	status: ContentfulStatusCode;
	body: ApiErrorEnvelope;
	logLevel: ApiErrorLogLevel;
	logContext: Record<string, unknown>;
};

const httpExceptionCodes: Record<number, string> = {
	400: "BAD_REQUEST",
	401: "UNAUTHORIZED",
	403: "FORBIDDEN",
	404: "NOT_FOUND",
	405: "METHOD_NOT_ALLOWED",
	408: "REQUEST_TIMEOUT",
	409: "CONFLICT",
	413: "PAYLOAD_TOO_LARGE",
	415: "UNSUPPORTED_MEDIA_TYPE",
	422: "UNPROCESSABLE_ENTITY",
	429: "RATE_LIMITED",
	500: "INTERNAL_SERVER_ERROR",
	501: "NOT_IMPLEMENTED",
	502: "BAD_GATEWAY",
	503: "SERVICE_UNAVAILABLE",
	504: "GATEWAY_TIMEOUT",
};

function toStatusCode(status: number): ContentfulStatusCode {
	if (status >= 400 && status <= 599) return status as ContentfulStatusCode;
	return 500;
}

function isErrorCode(value: string): boolean {
	return value.trim().length > 0;
}

function errorBody(
	code: string,
	message: string,
	details?: unknown,
): ApiErrorEnvelope {
	return apiErrorEnvelopeSchema.parse({
		error: {
			code,
			message,
			...(details === undefined ? {} : { details }),
		},
	});
}

/**
 * Converts an error at the REST boundary into the sole public error shape.
 * It intentionally does not expose the message or stack from unknown errors.
 */
export function serializeApiError(error: unknown): SerializedApiError {
	if (error instanceof AppError) {
		if (!isErrorCode(error.code)) return internalServerError(error);
		return {
			status: toStatusCode(error.statusCode),
			body: errorBody(error.code, error.message, error.details),
			logLevel: error.statusCode >= 500 ? "error" : "warn",
			logContext: {
				err: error,
				code: error.code,
				status: error.statusCode,
			},
		};
	}

	if (error instanceof HTTPException) {
		const status = toStatusCode(error.status);
		return {
			status,
			body: errorBody(
				httpExceptionCodes[status] ?? "HTTP_EXCEPTION",
				error.message || "HTTP request exception",
			),
			logLevel: status >= 500 ? "error" : "warn",
			logContext: {
				err: error,
				code: httpExceptionCodes[status] ?? "HTTP_EXCEPTION",
				status,
			},
		};
	}

	return internalServerError(error);
}

function internalServerError(error: unknown): SerializedApiError {
	return {
		status: 500,
		body: errorBody("INTERNAL_SERVER_ERROR", "An unexpected error occurred"),
		logLevel: "error",
		logContext: {
			err: error,
			code: "INTERNAL_SERVER_ERROR",
			status: 500,
		},
	};
}

type ErrorLogger = {
	warn: (context: unknown, message?: string) => void;
	error: (context: unknown, message?: string) => void;
};

export function logSerializedApiError(
	logger: ErrorLogger,
	serialized: SerializedApiError,
) {
	logger[serialized.logLevel](serialized.logContext, "REST API error");
}
