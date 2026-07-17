import { afterEach, describe, expect, it, vi } from "vitest";
import {
	registerCodingAgentRunHandlers,
	startCodingAgentRun,
} from "../api/modules/agentsShare";

let unregister: (() => void) | null = null;

afterEach(() => {
	unregister?.();
	unregister = null;
});

describe("Coding Agent requester provenance", () => {
	it("keeps automation provenance in the neutral application command without a runtime mode", async () => {
		const start = vi.fn(async (command) => ({
			runId: "run-1",
			taskId: command.taskId,
			status: "queued",
		}));
		unregister = registerCodingAgentRunHandlers({
			start,
			resume: async () => ({
				runId: "run-1",
				taskId: "task-1",
				status: "running",
			}),
		});
		const command = {
			taskId: "task-1",
			instruction: "確定済み設計を実装して検証する",
			artifactRefs: [
				{
					kind: "feature_plan",
					id: "artifact-1",
					revision: 3,
					digest: "sha256:artifact",
				},
			],
			repositoryRef: { id: "repository-1", revision: 7 },
			requestProvenance: {
				requestedBy: { kind: "automation" as const, actorId: "session-1" },
				orchestrationRef: { kind: "mission_pilot_session", id: "session-1" },
			},
		};

		await expect(startCodingAgentRun(command)).resolves.toEqual({
			runId: "run-1",
			taskId: "task-1",
			status: "queued",
		});
		expect(start).toHaveBeenCalledWith(command);
		const serialized = JSON.stringify(start.mock.calls[0]?.[0]);
		expect(serialized).not.toContain("codingAgentInvocationSource");
		expect(serialized).not.toContain("completionOwner");
		expect(serialized).not.toContain("missionPilotAgent");
	});
});
