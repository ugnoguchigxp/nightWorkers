import { isDeepRecord, toDeepRecord } from "../../../shared/json-record";
import type { TaskEvent, TaskMessage } from "./types";

export function getRunEventType(event: TaskEvent): string {
	const payload = toDeepRecord(event.payloadJson);
	const runEvent = toDeepRecord(payload.runEvent);
	return String(runEvent.type || event.eventType || event.type || "");
}

export function taskMessageMetadata(message: TaskMessage) {
	return toDeepRecord(message.metadataJson);
}

export function readRecord(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

export function readRecordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function readStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is string => typeof item === "string" && item.length > 0,
			)
		: [];
}

export function readNonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function readPositiveInteger(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
		return null;
	return Math.floor(value);
}

export function readWarningSeverity(
	value: unknown,
): "info" | "warning" | "error" {
	if (value === "info" || value === "warning" || value === "error")
		return value;
	return "warning";
}

export function higherWarningSeverity(
	a: "info" | "warning" | "error",
	b: "info" | "warning" | "error",
) {
	return warningSeverityRank(a) >= warningSeverityRank(b) ? a : b;
}

export function warningSeverityRank(severity: "info" | "warning" | "error") {
	if (severity === "error") return 3;
	if (severity === "warning") return 2;
	return 1;
}

export function toMs(value: unknown): number {
	if (!value) return 0;
	if (value instanceof Date) return value.getTime();
	if (typeof value === "number" && Number.isFinite(value)) {
		return value > 0 && value < 1_000_000_000_000 ? value * 1000 : value;
	}
	if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
		const numeric = Number(value);
		if (Number.isFinite(numeric)) {
			return numeric > 0 && numeric < 1_000_000_000_000
				? numeric * 1000
				: numeric;
		}
	}
	const date = new Date(String(value));
	const ms = date.getTime();
	return Number.isFinite(ms) ? ms : 0;
}

export function isRecord(value: unknown) {
	return isDeepRecord(value);
}
