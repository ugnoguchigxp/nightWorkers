import { describe, expect, it } from "vitest";
import { collectDefaultReviewEvidence } from "../api/modules/review/results/evidence-collector";

describe("review evidence collector extra coverage", () => {
	it("uses canonical payload data for final, diff, verification, and policy evidence", () => {
		const refs = collectDefaultReviewEvidence(
			{ id: "run-1", diffPatch: "fallback" },
			[
				event("final", {
					runEvent: { type: "run.runtime_finished", data: {} },
				}),
				event("diff", {
					runEvent: {
						type: "git.diff_collected",
						data: { diffBytes: 11, hasChanges: false },
					},
				}),
				event("verify", {
					runEvent: {
						type: "verification.finished",
						data: { passed: false, command: "test" },
					},
				}),
				event("policy", {
					runEvent: {
						type: "tool.policy_blocked",
						data: { code: "DENY", message: "denied" },
					},
				}),
			],
		);
		expect(refs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "run_event",
					eventId: "final",
					eventType: "run.runtime_finished",
				}),
				{ kind: "diff", runId: "run-1", bytes: 11, hasChanges: false },
				{
					kind: "verification",
					eventId: "verify",
					passed: false,
					command: "test",
				},
				{
					kind: "policy",
					eventId: "policy",
					code: "DENY",
					message: "denied",
				},
			]),
		);
	});

	it("uses event fields, byte fallbacks, verificationPassed, and policy message fallback", () => {
		const refs = collectDefaultReviewEvidence(
			{ id: "run-2", diffPatch: "é", finalReport: "report" },
			[
				{
					id: "final-type",
					type: "final_report",
					payloadJson: null,
				},
				{
					id: "diff-type",
					type: "git.diff_collected",
					payloadJson: { runEvent: { data: { bytes: 7 } } },
				},
				{
					id: "verify-type",
					type: "verification.finished",
					payloadJson: {
						runEvent: { data: { verificationPassed: true } },
					},
				},
				{
					id: "policy-type",
					eventType: "safety.policy_violation",
					message: "event message",
					payloadJson: { runEvent: { data: { code: 2, message: 2 } } },
				},
			],
		);
		expect(refs).toEqual(
			expect.arrayContaining([
				{ kind: "diff", runId: "run-2", bytes: 7, hasChanges: true },
				expect.objectContaining({
					kind: "verification",
					passed: true,
					command: undefined,
				}),
				{
					kind: "policy",
					eventId: "policy-type",
					code: undefined,
					message: "event message",
				},
			]),
		);
	});

	it.each([
		[{ diffBytes: "bad", bytes: "bad" }, "abc", 3, true],
		[{ diffBytes: "bad", bytes: "bad" }, null, undefined, undefined],
	] as const)("falls back from invalid diff data %#", (data, diffPatch, expectedBytes, expectedChanges) => {
		const refs = collectDefaultReviewEvidence({ id: "run", diffPatch }, [
			{
				id: "diff",
				eventType: "tool_result",
				payloadJson: { runEvent: { data } },
			},
		]);
		expect(refs).toContainEqual({
			kind: "diff",
			runId: "run",
			bytes: expectedBytes,
			hasChanges: expectedChanges,
		});
	});

	it("creates diff and final report evidence without matching events", () => {
		expect(
			collectDefaultReviewEvidence(
				{ id: "run", diffPatch: "diff", finalReport: " text " },
				[],
			),
		).toEqual([
			{ kind: "diff", runId: "run", bytes: 4, hasChanges: true },
			{ kind: "final_report", runId: "run" },
		]);
		expect(
			collectDefaultReviewEvidence(
				{ id: "run", diffPatch: "", finalReport: " ", finalJudgment: {} },
				[],
			),
		).toEqual([{ kind: "final_report", runId: "run" }]);
		expect(
			collectDefaultReviewEvidence(
				{ id: "run", diffPatch: null, finalReport: null, finalJudgment: null },
				[],
			),
		).toEqual([]);
	});

	it.each([
		[{ passed: true }, true],
		[{ verificationPassed: false }, false],
		[{ command: "test" }, undefined],
		[{ checkpoint: "done" }, undefined],
		[{ verification: {} }, undefined],
	] as const)("recognizes checkpoint verification payload %#", (data, passed) => {
		const refs = collectDefaultReviewEvidence({ id: "run" }, [
			{
				id: "checkpoint",
				eventType: "checkpoint",
				payloadJson: { runEvent: { data } },
			},
		]);
		expect(refs).toContainEqual(
			expect.objectContaining({
				kind: "verification",
				eventId: "checkpoint",
				passed,
			}),
		);
	});

	it("ignores unrelated checkpoints and uses the latest canonical event", () => {
		const refs = collectDefaultReviewEvidence({ id: "run" }, [
			{
				id: "ignored-checkpoint",
				eventType: "checkpoint",
				payloadJson: { runEvent: { data: { unrelated: true } } },
			},
			event("old", { runEvent: { type: "run.runtime_finished" } }),
			event("latest", { runEvent: { type: "run.final_judgment_created" } }),
		]);
		expect(refs.filter((ref) => ref.kind === "run_event")).toEqual([
			expect.objectContaining({ eventId: "latest" }),
		]);
		expect(refs.some((ref) => ref.kind === "verification")).toBe(false);
	});
});

function event(id: string, payloadJson: unknown) {
	return { id, seq: 1, payloadJson };
}
