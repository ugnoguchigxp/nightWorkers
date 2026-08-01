import { z } from "zod";
import { codingAgentCommandRequestV1Schema } from "../../shared/modules/codingAgent";

export const NIGHTWORKERS_WS_MAX_MESSAGE_BYTES = 128 * 1024;
export const NIGHTWORKERS_WS_INVALID_PAYLOAD_CODE = "INVALID_WEBSOCKET_PAYLOAD";
export const NIGHTWORKERS_WS_INVALID_PAYLOAD_MESSAGE =
	"Invalid websocket payload";

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
