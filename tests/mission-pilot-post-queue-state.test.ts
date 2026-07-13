import { describe, expect, it } from "vitest";
import {
	assertMissionPilotPhaseTransition,
	evaluateCompletionAdmission,
	evaluateImplementationCompletionGate,
} from "../api/modules/missionPilot/mission-pilot-post-queue-state";

describe("Mission Pilot post-Queue state", () => {
	it("accepts the deterministic happy-path transitions", () => {
		expect(() =>
			assertMissionPilotPhaseTransition("queued", "repository_bootstrapping"),
		).not.toThrow();
		expect(() =>
			assertMissionPilotPhaseTransition("repository_bootstrapping", "queued"),
		).not.toThrow();
		expect(() =>
			assertMissionPilotPhaseTransition("queued", "implementation_starting"),
		).not.toThrow();
		expect(() =>
			assertMissionPilotPhaseTransition("completed", "archiving"),
		).not.toThrow();
		expect(() =>
			assertMissionPilotPhaseTransition("archiving", "archived"),
		).not.toThrow();
	});

	it("rejects skipping Test and Review", () => {
		expect(() =>
			assertMissionPilotPhaseTransition("implementing", "committing"),
		).toThrow("Invalid Mission Pilot phase transition");
	});

	it("blocks Test start when implementation evidence is incomplete", () => {
		const result = evaluateImplementationCompletionGate({
			runStatus: "completed",
			openTodoCount: 1,
			securityAllowed: true,
			hasOwnershipEvidence: false,
			hasDiffOrNoopEvidence: true,
			hasFinalReport: true,
			contextDigestMatches: true,
		});
		expect(result).toEqual({
			pass: false,
			reasons: ["open_todos", "ownership_missing"],
		});
	});

	it("requires Test pass, Review pass, and local commit before completion", () => {
		expect(
			evaluateCompletionAdmission({
				testPass: true,
				reviewPass: true,
				closeoutStatus: "committed",
				pushPolicy: "never",
				pushStatus: "skipped",
				hasOwnedChanges: true,
				commitSha: "abc123",
			}),
		).toEqual({ pass: true, reasons: [] });
	});
});
