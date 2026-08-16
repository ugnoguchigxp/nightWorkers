import crypto from "node:crypto";

const MAX_PROVIDER_ERROR_BODY_BYTES = 8_192;
export const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
export const PROVIDER_RESPONSE_COMPACTION_CHUNK_COUNT = 1024;

export type StructuredProviderFailureKind =
	| "transport"
	| "timeout"
	| "rate_limit"
	| "provider_capacity"
	| "authentication"
	| "permission"
	| "invalid_request"
	| "invalid_response"
	| "schema_invalid"
	| "cancelled"
	| "unknown";

export class StructuredProviderError extends Error {
	readonly kind: StructuredProviderFailureKind;
	readonly code: string | null;
	readonly httpStatus: number | null;
	readonly retryable: boolean;
	readonly retryAfterMs: number | null;
	readonly attempt: number;
	readonly providerBody: string | null;

	constructor(input: {
		kind: StructuredProviderFailureKind;
		message: string;
		code?: string | null;
		httpStatus?: number | null;
		retryable: boolean;
		retryAfterMs?: number | null;
		attempt?: number;
		providerBody?: string | null;
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
		this.providerBody = input.providerBody ?? null;
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
		message: `${input.provider} request failed with status ${input.status}.`,
		code: `HTTP_${input.status}`,
		httpStatus: input.status,
		retryable: isRetryableHttpStatus(input.status),
		retryAfterMs: parseRetryAfter(input.retryAfter),
		providerBody: body,
	});
}

export function providerInvalidResponseError(input: {
	provider: string;
	body: string;
	cause?: unknown;
}) {
	const body = boundedProviderErrorBody(input.body);
	return new StructuredProviderError({
		kind: "invalid_response",
		message: `${input.provider} returned an invalid JSON response.`,
		code: "INVALID_PROVIDER_RESPONSE",
		retryable: false,
		providerBody: body,
		cause: input.cause,
	});
}

export function providerResponseTooLargeError(
	maxResponseBytes = MAX_PROVIDER_RESPONSE_BYTES,
) {
	return new StructuredProviderError({
		kind: "invalid_response",
		message: "Provider response exceeds the configured size limit.",
		code: "PROVIDER_RESPONSE_TOO_LARGE",
		retryable: false,
		providerBody: `[provider response exceeded byte limit: ${maxResponseBytes}]`,
	});
}

/**
 * Reads an HTTP provider response with a byte ceiling before decoding JSON.
 * The native Response.text() helper has no ceiling and would otherwise allow
 * a misconfigured or hostile provider endpoint to exhaust the API process.
 */
export async function readBoundedProviderResponseText(
	response: Response,
	maxResponseBytes = MAX_PROVIDER_RESPONSE_BYTES,
) {
	const declaredBytes = Number.parseInt(
		response.headers.get("content-length") ?? "",
		10,
	);
	if (Number.isFinite(declaredBytes) && declaredBytes > maxResponseBytes) {
		await response.body?.cancel().catch(() => undefined);
		throw providerResponseTooLargeError(maxResponseBytes);
	}
	if (!response.body) return "";

	const reader = response.body.getReader();
	const compactedChunks: Uint8Array[] = [];
	let chunks: Uint8Array[] = [];
	let pendingBytes = 0;
	let totalBytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			totalBytes += value.byteLength;
			if (totalBytes > maxResponseBytes) {
				throw providerResponseTooLargeError(maxResponseBytes);
			}
			chunks.push(value);
			pendingBytes += value.byteLength;
			if (chunks.length < PROVIDER_RESPONSE_COMPACTION_CHUNK_COUNT) continue;
			compactedChunks.push(Buffer.concat(chunks, pendingBytes));
			chunks = [];
			pendingBytes = 0;
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	}
	return Buffer.concat([...compactedChunks, ...chunks], totalBytes).toString(
		"utf8",
	);
}

export function providerInvalidToolArgumentsError(input: {
	provider: string;
	toolName: string;
	rawArguments: string;
	failure: "invalid_json" | "non_object" | "unknown_tool" | "schema_invalid";
	content?: string;
	responseBody?: string;
	schemaError?: string;
}) {
	return new StructuredProviderError({
		kind: "invalid_response",
		message: `${input.provider} returned invalid arguments for tool ${input.toolName}.`,
		code: "INVALID_TOOL_ARGUMENTS",
		retryable: false,
		providerBody: boundedProviderErrorBody(
			JSON.stringify({
				content: input.content ?? null,
				responseBody: input.responseBody ?? null,
				toolName: input.toolName,
				rawArguments: input.rawArguments,
				failure: input.failure,
				schemaError: input.schemaError ?? null,
			}),
		),
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
	if (name === "AbortError") {
		return new StructuredProviderError({
			kind: "cancelled",
			message: error instanceof Error ? error.message : String(error),
			code,
			retryable: false,
			cause: error,
		});
	}
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
		kind: timeout
			? "timeout"
			: transport
				? "transport"
				: error instanceof SyntaxError
					? "invalid_response"
					: "unknown",
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
		providerBody: error.providerBody,
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
	if (typeof record.status === "number") return record.status;
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
