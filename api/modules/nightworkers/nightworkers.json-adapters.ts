import { runEventSchema } from "../../../shared/schemas/nightworkers/run-events.schema";

export type JsonRecord = Record<string, unknown>;

export function isJsonRecord(value: unknown): value is JsonRecord {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function toJsonRecord(value: unknown): JsonRecord {
	return isJsonRecord(value) ? value : {};
}

export function activityPayloadJson(
	payload: unknown,
	normalizedKind: string,
	originalKind: string,
): JsonRecord {
	const base =
		payload === undefined
			? {}
			: isJsonRecord(payload)
				? payload
				: { rawPayload: payload };
	if (normalizedKind === originalKind) return base;
	return { ...base, originalKind, rawPayload: payload };
}

export function readRunEventPayload(payloadJson: unknown): {
	payload: JsonRecord;
	runEvent: JsonRecord | null;
	runEventTaskId: string | null;
} {
	const payload = toJsonRecord(payloadJson);
	const runEvent = parseRunEventRecord(payload.runEvent);
	return {
		payload,
		runEvent,
		runEventTaskId:
			typeof runEvent?.taskId === "string" ? runEvent.taskId : null,
	};
}

export function readRunEventCanonicalType(payloadJson: unknown): string | null {
	const { runEvent } = readRunEventPayload(payloadJson);
	return typeof runEvent?.type === "string" ? runEvent.type : null;
}

function parseRunEventRecord(value: unknown): JsonRecord | null {
	const parsed = runEventSchema.safeParse(value);
	if (parsed.success) return parsed.data;
	return isJsonRecord(value) ? value : null;
}
