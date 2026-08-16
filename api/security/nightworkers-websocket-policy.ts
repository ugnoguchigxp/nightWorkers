import { z } from "zod";
import { codingAgentCommandRequestV1Schema } from "../../shared/modules/codingAgent";

export const NIGHTWORKERS_WS_MAX_MESSAGE_BYTES = 128 * 1024;
export const NIGHTWORKERS_WS_MESSAGE_RATE_WINDOW_MS = 60_000;
export const NIGHTWORKERS_WS_MESSAGE_RATE_LIMIT = 120;
export const NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE = "INVALID_WEBSOCKET_PAYLOAD";
export const NIGHTWORKERS_WS_INVALID_PAYLOAD_MESSAGE =
	"Invalid websocket payload";
export const NIGHTWORKERS_WS_RATE_LIMIT_CODE = "WEBSOCKET_RATE_LIMIT_EXCEEDED";
export const NIGHTWORKERS_WS_RATE_LIMIT_MESSAGE =
	"WebSocket message rate limit exceeded";
export const NIGHTWORKERS_WS_RATE_LIMIT_CLOSE_CODE = 1008;

export type NightWorkersWsMessageRateLimiter = {
	tryConsume(): boolean;
};

export function createNightWorkersWsMessageRateLimiter(
	input: { now?: () => number; windowMs?: number; limit?: number } = {},
): NightWorkersWsMessageRateLimiter {
	const now = input.now ?? Date.now;
	const windowMs = input.windowMs ?? NIGHTWORKERS_WS_MESSAGE_RATE_WINDOW_MS;
	const limit = input.limit ?? NIGHTWORKERS_WS_MESSAGE_RATE_LIMIT;
	let windowStartedAt: number | undefined;
	let count = 0;
	return {
		tryConsume() {
			const timestamp = now();
			if (
				windowStartedAt === undefined ||
				timestamp - windowStartedAt >= windowMs
			) {
				windowStartedAt = timestamp;
				count = 0;
			}
			if (count >= limit) return false;
			count += 1;
			return true;
		},
	};
}

export function isAllowedNightWorkersWebSocketOrigin(
	origin: string | undefined,
	allowedOrigins: readonly string[],
) {
	return origin !== undefined && allowedOrigins.includes(origin);
}

export const nightWorkersWsClientMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("subscribe_task"),
		taskId: z.string().uuid(),
		runId: z.string().uuid().optional(),
		afterSeq: z.number().int().min(0).optional(),
	}),
	z.object({ type: z.literal("unsubscribe_task"), taskId: z.string().uuid() }),
	codingAgentCommandRequestV1Schema,
]);

export class NightWorkersWsInvalidPayloadError extends Error {
	readonly code = NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE;

	constructor(cause: unknown) {
		super(NIGHTWORKERS_WS_INVALID_PAYLOAD_MESSAGE, { cause });
		this.name = "NightWorkersWsInvalidPayloadError";
	}
}

export function parseNightWorkersWsClientMessage(raw: string) {
	try {
		return nightWorkersWsClientMessageSchema.parse(JSON.parse(raw));
	} catch (cause) {
		throw new NightWorkersWsInvalidPayloadError(cause);
	}
}
