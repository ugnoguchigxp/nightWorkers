import { describe, expect, it } from "vitest";
import {
	isMissionPilotChatPending,
	resolveNextActiveSessionId,
} from "../src/modules/nightworkers/hooks/useNightWorkersWorkspace";
import type { Task } from "../src/modules/nightworkers/types";

describe("resolveNextActiveSessionId", () => {
	it("keeps the current active session when it is still present", () => {
		expect(
			resolveNextActiveSessionId("task-2", [
				{ id: "task-1" },
				{ id: "task-2" },
				{ id: "task-3" },
			]),
		).toBe("task-2");
	});

	it("falls back to the first session when the current session is missing", () => {
		expect(
			resolveNextActiveSessionId("removed-task", [
				{ id: "task-1" },
				{ id: "task-2" },
			]),
		).toBe("task-1");
	});

	it("selects the first session when no current session is active", () => {
		expect(
			resolveNextActiveSessionId(null, [{ id: "task-1" }, { id: "task-2" }]),
		).toBe("task-1");
	});

	it("returns null when no sessions are available", () => {
		expect(resolveNextActiveSessionId("removed-task", [])).toBeNull();
		expect(resolveNextActiveSessionId(null, [])).toBeNull();
	});
});

describe("isMissionPilotChatPending", () => {
	it("treats initial Mission Pilot intake like a pending user chat response", () => {
		const task = {
			missionPilot: {
				desiredState: "playing",
				activityState: "starting",
				initialPromptState: "sent",
			},
		} as Task;
		expect(isMissionPilotChatPending(task)).toBe(true);
		const missionPilot = task.missionPilot;
		if (!missionPilot) throw new Error("Mission Pilot summary is required");
		expect(
			isMissionPilotChatPending({
				...task,
				missionPilot: {
					...missionPilot,
					activityState: "idle",
				},
			}),
		).toBe(false);
	});
});
