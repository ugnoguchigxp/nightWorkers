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
	it("keeps an empty or optional-only checklist incomplete", () => {
		expect(summarizeChecklist([]).complete).toBe(false);
		expect(
			summarizeChecklist([{ ...item("AC-001"), required: false }]).complete,
		).toBe(false);
	});

	it("keeps unmapped full-gate coverage incomplete", () => {
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
		const summary = summarizeChecklist(updated);
		expect(summary.complete).toBe(false);
		expect(summary.unknownRequired.map((item) => item.conditionId)).toEqual([
			"AC-002",
		]);
	});

	it("keeps command-level coverage as a non-terminal projection", () => {
		const updated = applyEvidenceToChecklist({
			items: [item("AC-001")],
			evidence: evidence({
				exitCode: 0,
				cases: [],
				conditionIds: ["AC-001"],
			}),
		});

		expect(updated[0]?.status).toBe("covered");
		expect(summarizeChecklist(updated).complete).toBe(false);
	});

	it("does not cover managed automated conditions without resolved case evidence", () => {
		const managedItem = {
			...item("AC-001"),
			verificationKind: "automated_test" as const,
			expectedEvidence: ["unit_test" as const],
		};
		const empty = applyEvidenceToChecklist({
			items: [managedItem],
			evidence: evidence({
				exitCode: 0,
				cases: [],
				conditionIds: ["AC-001"],
				evidenceKinds: ["unit_test"],
			}),
		});
		expect(empty[0]?.status).toBe("pending");

		const unresolved = applyEvidenceToChecklist({
			items: [managedItem],
			evidence: evidence({
				exitCode: 0,
				conditionIds: ["AC-001"],
				evidenceKinds: ["unit_test"],
				cases: [
					{
						id: "case-unresolved",
						name: "ambiguous case",
						status: "passed",
						conditionIds: ["AC-001"],
						failureMessage: "TEST_IDENTITY_AMBIGUOUS",
					},
				],
			}),
		});
		expect(unresolved[0]?.status).toBe("unknown");

		const commandFailed = applyEvidenceToChecklist({
			items: [managedItem],
			evidence: evidence({
				exitCode: 1,
				conditionIds: ["AC-001"],
				evidenceKinds: ["unit_test"],
				cases: [
					{
						id: "case-resolved",
						caseKey: "T1",
						name: "resolved case",
						status: "passed",
						conditionIds: ["AC-001"],
					},
				],
			}),
		});
		expect(commandFailed[0]?.status).toBe("failed");
	});

	it("keeps unknown required items incomplete", () => {
		const updated = applyEvidenceToChecklist({
			items: [item("AC-001")],
			evidence: evidence({ exitCode: 1, cases: [] }),
		});

		expect(updated[0]?.status).toBe("unknown");
		expect(summarizeChecklist(updated).complete).toBe(false);
	});

	it("appends a new full-gate evidence id to already verified gate items", () => {
		const updated = applyEvidenceToChecklist({
			items: [
				{
					...item("AC-001"),
					status: "verified_by_gate",
					evidenceIds: ["evidence-old"],
				},
			],
			fullGate: true,
			evidence: evidence({ id: "evidence-new", exitCode: 0, cases: [] }),
		});

		expect(updated[0]?.status).toBe("verified_by_gate");
		expect(updated[0]?.evidenceIds).toEqual(["evidence-old", "evidence-new"]);
	});

	it("does not treat skipped matching cases as passed", () => {
		const updated = applyEvidenceToChecklist({
			items: [item("AC-001")],
			evidence: evidence({
				exitCode: 0,
				cases: [
					{
						id: "case-1",
						name: "[AC-001] creates task",
						status: "skipped",
						conditionIds: ["AC-001"],
					},
				],
			}),
		});

		expect(updated[0]?.status).toBe("unknown");
		expect(summarizeChecklist(updated).complete).toBe(false);
	});

	it("keeps a failed case dominant within the same evidence run", () => {
		const updated = applyEvidenceToChecklist({
			items: [item("AC-001")],
			evidence: evidence({
				exitCode: 1,
				cases: [
					{
						id: "case-failed",
						name: "[AC-001] failure path",
						status: "failed",
						conditionIds: ["AC-001"],
					},
					{
						id: "case-passed",
						name: "[AC-001] success path",
						status: "passed",
						conditionIds: ["AC-001"],
					},
				],
			}),
		});

		expect(updated[0]?.status).toBe("failed");
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
	id?: string;
	exitCode: number;
	cases: NormalizedVerificationEvidence["cases"];
	conditionIds?: string[];
	evidenceKinds?: NormalizedVerificationEvidence["evidenceKinds"];
}): NormalizedVerificationEvidence {
	return {
		id: input.id ?? "evidence-1",
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
		evidenceKinds: input.evidenceKinds,
		commandLevelConditionIds: input.conditionIds ?? [],
	};
}
