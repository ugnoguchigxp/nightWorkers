import type { MiddlewareHandler } from "hono";
import { AppError } from "../lib/errors";

export const NIGHTWORKERS_API_MAX_BODY_BYTES = 32 * 1024 * 1024;
// A malicious chunked request can stay below the byte ceiling while producing
// millions of tiny Uint8Arrays. Compact each bounded batch before rehydrating
// the request so object metadata cannot dominate the body budget.
export const NIGHTWORKERS_REQUEST_BODY_COMPACTION_CHUNK_COUNT = 1024;

/**
 * Enforces the API body ceiling before a route handler can read a request.
 *
 * Hono's built-in bodyLimit trusts a declared Content-Length below its limit,
 * so it cannot defend against an under-declared stream.  This policy checks
 * the declaration as an early rejection and always counts the stream before
 * rehydrating it for the route handler.
 */
export function nightworkersRequestBodyLimit(): MiddlewareHandler {
	return async (context, next) => {
		if (context.req.method === "GET" || context.req.method === "HEAD") {
			return next();
		}
		if (
			declaredContentLengthExceedsLimit(context.req.header("content-length"))
		) {
			await cancelRequestBody(context.req.raw.body);
			throw requestBodyTooLargeError();
		}
		const body = context.req.raw.body;
		if (!body) return next();

		const chunks = await readBodyWithinLimit(body);
		context.req.raw = new Request(context.req.raw, {
			body: new ReadableStream<Uint8Array>({
				start(controller) {
					for (const chunk of chunks) controller.enqueue(chunk);
					controller.close();
				},
			}),
			duplex: "half",
		} as RequestInit);
		return next();
	};
}

function declaredContentLengthExceedsLimit(value: string | undefined) {
	if (!value || !/^\d+$/.test(value)) return false;
	const bytes = Number(value);
	return Number.isSafeInteger(bytes) && bytes > NIGHTWORKERS_API_MAX_BODY_BYTES;
}

export async function readBodyWithinLimit(body: ReadableStream<Uint8Array>) {
	const reader = body.getReader();
	const compactedChunks: Uint8Array[] = [];
	let chunks: Uint8Array[] = [];
	let bytes = 0;
	let pendingBytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return [...compactedChunks, ...chunks];
			bytes += value.byteLength;
			if (bytes > NIGHTWORKERS_API_MAX_BODY_BYTES) {
				throw requestBodyTooLargeError();
			}
			chunks.push(value);
			pendingBytes += value.byteLength;
			if (chunks.length < NIGHTWORKERS_REQUEST_BODY_COMPACTION_CHUNK_COUNT)
				continue;
			compactedChunks.push(Buffer.concat(chunks, pendingBytes));
			chunks = [];
			pendingBytes = 0;
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	}
}

async function cancelRequestBody(body: ReadableStream<Uint8Array> | null) {
	await body?.cancel().catch(() => undefined);
}

function requestBodyTooLargeError() {
	return new AppError(
		413,
		"REQUEST_BODY_TOO_LARGE",
		"Request body exceeds the API size limit.",
	);
}
