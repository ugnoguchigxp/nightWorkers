import { describe, expect, it } from "vitest";
import { buildInterruptedImplementationResumeOptions } from "../api/modules/missionPilot/mission-pilot-runtime-continuation.service";
import type { TaskRunTodoRow } from "../api/modules/nightworkers/nightworkers.runs-support";
import { buildInterruptedRunResumeTodos } from "../api/modules/nightworkers/run-orchestration/todo-resume";

function todo(
	seq: number,
	status: string,
	statusReason: string | null,
): TaskRunTodoRow {
	const now = new Date("2026-07-13T00:00:00.000Z");
	return {
		id: `todo-${seq}`,
		runId: "run-stopped",
		seq,
		title: `Todo ${seq}`,
		description: null,
		taskType: seq === 1 ? "coding_preparation" : "implementation",
		status,
		procedureId: seq === 1 ? "coding_preparation" : null,
		procedureSnapshot: null,
		contextSnapshot: null,
		completionGateResult: { previous: true },
		evidenceRequirementsJson: null,
		evidenceRefsJson: ["previous-evidence"],
		dependsOn: seq > 1 ? [seq - 1] : [],
		statusReason,
		startedAt: now,
		completedAt: now,
		createdAt: now,
		updatedAt: now,
	};
}

describe("Mission Pilot Todo resume", () => {
	it("sends only a short resume request and selects the interrupted Todo source", () => {
		const missionPilot = {
			sessionId: "session-1",
			cycle: 1,
			contextRevision: 7,
			contextDigest: "ctx-7",
			interruptedRunId: "run-stopped",
		};

		expect(buildInterruptedImplementationResumeOptions(missionPilot)).toEqual({
			executionMode: "implementation",
			executionModeSource: "explicit",
			latestUserMessageOverride: "再開してください。",
			resumeTodosFromRunId: "run-stopped",
			runtimeOptionsPatch: { missionPilot },
		});
	});

	it("keeps completed Todos and reopens only cancellation-closed work", () => {
		const resumedAt = new Date("2026-07-13T01:00:00.000Z");
		const result = buildInterruptedRunResumeTodos(
			[
				todo(1, "passed", null),
				todo(2, "failed", "Run was cancelled while this Todo was active."),
				todo(
					3,
					"skipped",
					"Skipped because the run was cancelled before this Todo started.",
				),
			],
			resumedAt,
		);

		expect(result[0]).toMatchObject({
			seq: 1,
			status: "passed",
			completionGateResult: { previous: true },
		});
		expect(result[1]).toMatchObject({
			seq: 2,
			status: "running",
			statusReason: null,
			completionGateResult: null,
			startedAt: resumedAt,
			completedAt: null,
		});
		expect(result[2]).toMatchObject({
			seq: 3,
			status: "pending",
			statusReason: null,
			completionGateResult: null,
			evidenceRefsJson: [],
			startedAt: null,
			completedAt: null,
		});
	});
});
