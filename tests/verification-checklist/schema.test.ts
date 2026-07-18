import { describe, expect, it } from "vitest";
import {
	isVerificationChecklistItemComplete,
	specificationAcceptanceCriterionSchema,
	specificationVerificationDocumentSchema,
	verificationChecklistItemSchema,
} from "../../shared/schemas/verification-checklist.schema";

describe("verification checklist schemas", () => {
	it("requires executable unit-test details for generated acceptance criteria", () => {
		const criterion = {
			title: "空白titleを拒否する",
			category: "validation",
			testCase: {
				target: "CreateTodoInput schema",
				preconditions: ["titleに半角空白3文字を指定する"],
				action: "safeParseを実行する",
				assertions: ["successがfalseになる"],
			},
		};

		expect(specificationAcceptanceCriterionSchema.parse(criterion)).toEqual(
			criterion,
		);
		expect(() =>
			specificationAcceptanceCriterionSchema.parse({
				...criterion,
				testCase: { ...criterion.testCase, assertions: [] },
			}),
		).toThrow();
		expect(() =>
			specificationAcceptanceCriterionSchema.parse({
				...criterion,
				category: "quality",
			}),
		).toThrow();
	});

	it("rejects unknown fields and duplicate condition ids", () => {
		const base = {
			version: 1,
			specId: "spec-1",
			specPath: "spec/spec-1.md",
			generatedAt: "2026-07-08T00:00:00.000Z",
			source: {
				taskId: "task-1",
				sourceMessageIds: [],
				workspaceArtifactIds: [],
			},
			conditions: [
				{
					id: "AC-001",
					text: "API route returns tasks.",
					category: "api",
					verificationKind: "automated_test",
					expectedEvidence: ["unit_test"],
					expectedResult: "API route returns tasks.",
					failureMeaning: "route regression",
					required: true,
					status: "pending",
				},
			],
			commands: [],
			nonGoals: [],
		};

		expect(specificationVerificationDocumentSchema.parse(base)).toBeTruthy();
		expect(() =>
			specificationVerificationDocumentSchema.parse({
				...base,
				extra: true,
			}),
		).toThrow();
		expect(() =>
			specificationVerificationDocumentSchema.parse({
				...base,
				conditions: [base.conditions[0], base.conditions[0]],
			}),
		).toThrow(/duplicate condition id/);
	});

	it("keeps required checklist completion deterministic", () => {
		expect(
			isVerificationChecklistItemComplete(
				verificationChecklistItemSchema.parse({
					id: "item-1",
					conditionId: "AC-001",
					text: "condition",
					required: true,
					status: "verified_by_gate",
					evidenceIds: ["evidence-1"],
				}),
			),
		).toBe(false);
		expect(
			isVerificationChecklistItemComplete({
				required: true,
				status: "unknown",
			}),
		).toBe(false);
		expect(
			isVerificationChecklistItemComplete({
				required: true,
				status: "legacy_complete",
			}),
		).toBe(false);
	});
});
