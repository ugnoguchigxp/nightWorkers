import { createHash } from "node:crypto";
import { callMissionPilotHost } from "./host-bindings";

export type StructuredProviderCallAuthorizationContext = {
	role: string;
	taskId?: string;
	signal?: AbortSignal;
};

export type StructuredProviderExecutionPolicy = {
	isolatedHome?: boolean;
	enableMcp?: boolean;
	enableMemory?: boolean;
	allowProviderTools?: boolean;
	authorizationContext?: StructuredProviderCallAuthorizationContext;
	developerInstructions?: string;
	authorizeProviderCall?: (
		context: StructuredProviderCallAuthorizationContext,
	) => Promise<void>;
	bindDeveloperInstructions?: (binding: unknown) => {
		text: string;
		systemContextAudit?: readonly unknown[];
	};
};

export function contentDigest(content: string) {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function sliceUtf8ContentPage(
	content: string,
	input: { cursor?: number; maxChars?: number; maxBytes?: number } = {},
) {
	const cursor = Math.max(0, Math.min(content.length, input.cursor ?? 0));
	const maxChars = Math.max(1, input.maxChars ?? 16_000);
	const maxBytes = Math.max(1, input.maxBytes ?? 16_000);
	let end = cursor;
	let bytes = 0;
	let chars = 0;
	while (end < content.length && chars < maxChars) {
		const codePoint = content.codePointAt(end);
		if (codePoint === undefined) break;
		const character = String.fromCodePoint(codePoint);
		const nextBytes = Buffer.byteLength(character, "utf8");
		if (bytes + nextBytes > maxBytes && end > cursor) break;
		bytes += nextBytes;
		end += character.length;
		chars += 1;
	}
	const pageContent = content.slice(cursor, end);
	return {
		content: pageContent,
		page: {
			cursor,
			nextCursor: end < content.length ? end : null,
			bytes: Buffer.byteLength(pageContent, "utf8"),
			truncated: end < content.length,
		},
	};
}

export const submitTaskUserIntake = (...args: unknown[]) =>
	callMissionPilotHost("submitTaskUserIntake", ...args);

export function registerTaskRunTerminalListener(
	listener: (event: {
		type: "task_run.terminal";
		eventId: string;
		taskId: string;
		taskRevision: number;
		runId: string;
		status: string;
		occurredAt: string;
	}) => void | Promise<void>,
) {
	return callMissionPilotHost("registerTaskRunTerminalListener", listener);
}
