import { isCodingAgentChatTrace } from "../../codingAgent";
import type { ActivityEvent, ActivityReplay, Task } from "../types";

export const emptyActivityReplay: ActivityReplay = {
	events: [],
	artifacts: [],
};

export function resolveNextActiveSessionId(
	currentId: string | null,
	sessions: Pick<Task, "id">[],
) {
	if (currentId && sessions.some((session) => session.id === currentId))
		return currentId;
	return sessions[0]?.id ?? null;
}

export type {
	NightWorkersWorkspaceState,
	ProjectSessionGroups,
} from "./nightWorkersWorkspaceState";

export function isActiveRunStatus(status: string | undefined): boolean {
	return (
		status === "queued" ||
		status === "running" ||
		status === "context_compiling" ||
		status === "compiling_context" ||
		status === "finalizing" ||
		status === "verifying"
	);
}

export function normalizeActivityReplay(data: unknown): ActivityReplay {
	if (Array.isArray(data))
		return { events: data as ActivityEvent[], artifacts: [] };
	if (!data || typeof data !== "object") return emptyActivityReplay;
	const replay = data as Partial<ActivityReplay>;
	return {
		events: Array.isArray(replay.events)
			? replay.events.filter(isCodingAgentChatTrace)
			: [],
		artifacts: Array.isArray(replay.artifacts) ? replay.artifacts : [],
	};
}

export function isActiveTaskStatus(status: string | undefined): boolean {
	return (
		status === "queued" ||
		status === "running" ||
		status === "context_compiling" ||
		status === "compiling_context" ||
		status === "finalizing" ||
		status === "verifying"
	);
}
