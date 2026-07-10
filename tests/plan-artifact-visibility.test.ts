import { describe, expect, it } from "vitest";
import {
	isActiveSessionWorkbenchRoute,
	shouldAutoOpenPlanArtifact,
} from "../src/modules/nightworkers/planArtifactVisibility";

describe("plan artifact visibility", () => {
	it("only auto-opens from the route of the active session", () => {
		const activeSessionId = "session-1";

		expect(
			isActiveSessionWorkbenchRoute(
				{ kind: "session", sessionId: activeSessionId, artifact: null },
				activeSessionId,
			),
		).toBe(true);
		expect(
			isActiveSessionWorkbenchRoute(
				{ kind: "session", sessionId: "session-2", artifact: null },
				activeSessionId,
			),
		).toBe(false);
		expect(
			isActiveSessionWorkbenchRoute(
				{ kind: "settings", section: "general" },
				activeSessionId,
			),
		).toBe(false);
		expect(
			isActiveSessionWorkbenchRoute(
				{ kind: "overview", range: "30d", projectId: null },
				activeSessionId,
			),
		).toBe(false);
	});

	it("auto-opens while plan generation is actively submitting", () => {
		expect(
			shouldAutoOpenPlanArtifact({
				activeSession: { status: "draft" },
				sessionView: { emailState: "draft" },
				isChatSubmitting: true,
			}),
		).toBe(true);
	});

	it("auto-opens after plan mode is ready for implementation", () => {
		expect(
			shouldAutoOpenPlanArtifact({
				activeSession: { status: "ready" },
				sessionView: { emailState: "plan_ready" },
				hasPlanArtifact: true,
			}),
		).toBe(true);
	});

	it("auto-opens draft plan artifacts before any implementation run starts", () => {
		expect(
			shouldAutoOpenPlanArtifact({
				activeSession: { status: "draft" },
				sessionView: { emailState: "draft" },
				hasPlanArtifact: true,
			}),
		).toBe(true);
	});

	it("does not auto-open completed, queued, or already executed sessions by default", () => {
		expect(
			shouldAutoOpenPlanArtifact({
				activeSession: { status: "completed" },
				sessionView: { emailState: "done" },
				hasPlanArtifact: true,
			}),
		).toBe(false);
		expect(
			shouldAutoOpenPlanArtifact({
				activeSession: { status: "queued" },
				sessionView: { emailState: "queued" },
				hasPlanArtifact: true,
			}),
		).toBe(false);
		expect(
			shouldAutoOpenPlanArtifact({
				activeSession: { status: "running" },
				sessionView: { emailState: "running" },
				latestRun: { status: "running" },
				hasPlanArtifact: true,
			}),
		).toBe(false);
	});
});
