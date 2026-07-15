import crypto from "node:crypto";

const MAX_PROVIDER_ERROR_BODY_BYTES = 8_192;

export type StructuredProviderFailureKind =
	| "transport"
	| "timeout"
	| "rate_limit"
	| "provider_capacity"
	| "authentication"
	| "permission"
	| "invalid_request"
	| "unknown";

export class StructuredProviderError extends Error {
	readonly kind: StructuredProviderFailureKind;
	readonly code: string | null;
	readonly httpStatus: number | null;
	readonly retryable: boolean;
	readonly retryAfterMs: number | null;
	readonly attempt: number;

	constructor(input: {
		kind: StructuredProviderFailureKind;
		message: string;
		code?: string | null;
		httpStatus?: number | null;
		retryable: boolean;
		retryAfterMs?: number | null;
		attempt?: number;
		cause?: unknown;
	}) {
		super(input.message, { cause: input.cause });
		this.name = "StructuredProviderError";
		this.kind = input.kind;
		this.code = input.code ?? null;
		this.httpStatus = input.httpStatus ?? null;
		this.retryable = input.retryable;
		this.retryAfterMs = input.retryAfterMs ?? null;
		this.attempt = input.attempt ?? 1;
	}
}

export function providerHttpError(input: {
	provider: string;
	status: number;
	body: string;
	retryAfter: string | null;
}) {
	const kind = httpFailureKind(input.status);
	const body = boundedProviderErrorBody(input.body);
	return new StructuredProviderError({
		kind,
		message: `${input.provider} native tool call failed with status ${input.status}: ${body}`,
		code: `HTTP_${input.status}`,
		httpStatus: input.status,
		retryable: isRetryableHttpStatus(input.status),
		retryAfterMs: parseRetryAfter(input.retryAfter),
	});
}

function boundedProviderErrorBody(body: string) {
	const bytes = Buffer.byteLength(body, "utf8");
	if (bytes <= MAX_PROVIDER_ERROR_BODY_BYTES) return body;
	let low = 0;
	let high = body.length;
	while (low < high) {
		const candidate = Math.ceil((low + high) / 2);
		if (
			Buffer.byteLength(body.slice(0, candidate), "utf8") <=
			MAX_PROVIDER_ERROR_BODY_BYTES
		)
			low = candidate;
		else high = candidate - 1;
	}
	let end = low;
	if (end < body.length && isLowSurrogate(body.charCodeAt(end))) end--;
	const digest = crypto.createHash("sha256").update(body).digest("hex");
	return `${body.slice(0, end)}\n[provider error body truncated: bytes=${bytes}, sha256=${digest}]`;
}

function isLowSurrogate(code: number) {
	return code >= 0xdc00 && code <= 0xdfff;
}

export function normalizeStructuredProviderError(error: unknown) {
	if (error instanceof StructuredProviderError) return error;
	const record =
		error && typeof error === "object"
			? (error as Record<string, unknown>)
			: {};
	const status = readStatus(record);
	if (status !== null) {
		return new StructuredProviderError({
			kind: httpFailureKind(status),
			message: error instanceof Error ? error.message : String(error),
			code: typeof record.code === "string" ? record.code : null,
			httpStatus: status,
			retryable: isRetryableHttpStatus(status),
			cause: error,
		});
	}
	const name = typeof record.name === "string" ? record.name : null;
	const code = typeof record.code === "string" ? record.code : null;
	const timeout =
		name === "TimeoutError" ||
		code === "ETIMEDOUT" ||
		code === "UND_ERR_CONNECT_TIMEOUT";
	const transport =
		error instanceof TypeError ||
		code === "ECONNRESET" ||
		code === "ECONNREFUSED" ||
		code === "EAI_AGAIN";
	return new StructuredProviderError({
		kind: timeout ? "timeout" : transport ? "transport" : "unknown",
		message: error instanceof Error ? error.message : String(error),
		code,
		retryable: timeout || transport,
		cause: error,
	});
}

export function withStructuredProviderAttempt(
	error: StructuredProviderError,
	attempt: number,
) {
	return new StructuredProviderError({
		kind: error.kind,
		message: error.message,
		code: error.code,
		httpStatus: error.httpStatus,
		retryable: error.retryable,
		retryAfterMs: error.retryAfterMs,
		attempt,
		cause: error,
	});
}

function httpFailureKind(status: number): StructuredProviderFailureKind {
	if (status === 401) return "authentication";
	if (status === 403) return "permission";
	if (status === 408) return "timeout";
	if (status === 429) return "rate_limit";
	if (status >= 500) return "provider_capacity";
	if (status >= 400) return "invalid_request";
	return "unknown";
}

function isRetryableHttpStatus(status: number) {
	return (
		status === 408 ||
		status === 429 ||
		status === 500 ||
		status === 502 ||
		status === 503 ||
		status === 504
	);
}

function readStatus(record: Record<string, unknown>) {
	if (typeof record.httpStatus === "number") return record.httpStatus;
	if (typeof record.statusCode === "number") return record.statusCode;
	const metadata = record.$metadata;
	if (metadata && typeof metadata === "object") {
		const status = (metadata as Record<string, unknown>).httpStatusCode;
		if (typeof status === "number") return status;
	}
	return null;
}

function parseRetryAfter(value: string | null) {
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0)
		return Math.round(seconds * 1000);
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp)
		? Math.max(0, timestamp - Date.now())
		: null;
}
