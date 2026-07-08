import { describe, expect, it } from "vitest";
import {
	applyEvidenceToChecklist,
	summarizeChecklist,
} from "../api/services/verification/checklist-matcher";
import type {
	NormalizedVerificationEvidence,
	VerificationChecklistItem,
} from "../shared/schemas/verification-checklist.schema";

describe("verification checklist matcher", () => {
	it("distinguishes passed cases from full-gate coverage", () => {
		const items: VerificationChecklistItem[] = [item("AC-001"), item("AC-002")];
		const updated = applyEvidenceToChecklist({
			items,
			fullGate: true,
			evidence: evidence({
				exitCode: 0,
				cases: [
					{
						id: "case-1",
						name: "[AC-001] creates task",
						status: "passed",
						conditionIds: ["AC-001"],
					},
				],
			}),
		});

		expect(
			updated.find((entry) => entry.conditionId === "AC-001")?.status,
		).toBe("passed");
		expect(
			updated.find((entry) => entry.conditionId === "AC-002")?.status,
		).toBe("verified_by_gate");
		expect(summarizeChecklist(updated).complete).toBe(true);
	});

	it("keeps unknown required items incomplete", () => {
		const updated = applyEvidenceToChecklist({
			items: [item("AC-001")],
			evidence: evidence({ exitCode: 1, cases: [] }),
		});

		expect(updated[0]?.status).toBe("unknown");
		expect(summarizeChecklist(updated).complete).toBe(false);
	});
});

function item(conditionId: string): VerificationChecklistItem {
	return {
		id: `item-${conditionId}`,
		conditionId,
		text: `${conditionId} condition`,
		required: true,
		status: "pending",
		evidenceIds: [],
	};
}

function evidence(input: {
	exitCode: number;
	cases: NormalizedVerificationEvidence["cases"];
}): NormalizedVerificationEvidence {
	return {
		id: "evidence-1",
		runId: "run-1",
		taskId: "task-1",
		command: "bun test",
		cwd: ".",
		startedAt: "2026-07-08T00:00:00.000Z",
		finishedAt: "2026-07-08T00:00:01.000Z",
		durationMs: 1000,
		exitCode: input.exitCode,
		runner: "vitest",
		rawStdoutArtifactId: "stdout.log",
		rawStderrArtifactId: "stderr.log",
		summary: { passed: null, failed: null, skipped: null, total: null },
		cases: input.cases,
		commandLevelConditionIds: [],
	};
}
