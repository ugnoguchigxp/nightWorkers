import { describe, expect, it } from "vitest";
import {
	matchTestEvidenceReferences,
	stringSimilarity,
	TEST_EVIDENCE_MATCH_THRESHOLD,
} from "../api/modules/codingAgent/verification/test-evidence-matcher";
import type { TestInventoryCase } from "../shared/schemas/verification-checklist.schema";

function activeCase(
	name: string,
	overrides: Partial<TestInventoryCase> = {},
): TestInventoryCase {
	return {
		caseKey: `vitest:tests/example.test.ts:${name}`,
		name,
		filePath: "tests/example.test.ts",
		runner: "vitest",
		discoveryLevel: "active",
		declaredConditionIds: [],
		...overrides,
	};
}

describe("schema test evidence matcher", () => {
	it("rejects an invalid similarity threshold", () => {
		expect(() =>
			matchTestEvidenceReferences({
				references: [],
				testCases: [],
				threshold: 0,
			}),
		).toThrow("threshold must be within");
	});

	it("normalizes case, punctuation, whitespace, and Unicode deterministically", () => {
		expect(
			stringSimilarity(
				"Todo Routes ＞ Rejects Invalid Input",
				"todo routes > rejects   invalid input",
			),
		).toBe(1);
		expect(stringSimilarity("𐐀a", "𐐀b")).toBe(0.5);
	});

	it("accepts a name at exactly 90% similarity", () => {
		const result = matchTestEvidenceReferences({
			references: [
				{
					testName: "abcdefghij",
					conditionIds: ["AC-001"],
				},
			],
			testCases: [activeCase("abcdefghiX")],
		});

		expect(TEST_EVIDENCE_MATCH_THRESHOLD).toBe(0.9);
		expect(result.matches).toHaveLength(1);
		expect(result.matches[0]?.nameScore).toBe(0.9);
		expect(result.missing).toEqual([]);
	});

	it("returns missing evidence below 90%", () => {
		const result = matchTestEvidenceReferences({
			references: [
				{
					testName: "abcdefghij",
					conditionIds: ["AC-001"],
				},
			],
			testCases: [activeCase("abcdefghXY")],
		});

		expect(result.matches).toEqual([]);
		expect(result.missing).toEqual([
			expect.objectContaining({
				referenceIndex: 0,
			}),
		]);
	});

	it("requires optional runner and file path selectors to reach the threshold", () => {
		const result = matchTestEvidenceReferences({
			references: [
				{
					testName: "creates a todo",
					filePath: "tests/todo-api.test.ts",
					runner: "vitest",
					conditionIds: ["AC-001"],
				},
			],
			testCases: [
				activeCase("creates a todo", {
					caseKey: "vitest:tests/archive-cleanup.test.ts:creates a todo",
					filePath: "tests/archive-cleanup.test.ts",
				}),
				activeCase("creates a todo", {
					caseKey: "jest:tests/todo-api.test.ts:creates a todo",
					filePath: "tests/todo-api.test.ts",
					runner: "jest",
				}),
			],
		});

		expect(result.matches).toEqual([]);
		expect(result.missing).toHaveLength(1);
	});

	it("does not promote filename candidates into mapping evidence", () => {
		const result = matchTestEvidenceReferences({
			references: [
				{
					testName: "creates a todo",
					conditionIds: ["AC-001"],
				},
			],
			testCases: [
				activeCase("creates a todo", {
					caseKey: "candidate:tests/todo.test.ts",
					discoveryLevel: "candidate",
				}),
			],
		});

		expect(result.matches).toEqual([]);
		expect(result.missing).toHaveLength(1);
	});

	it("returns ambiguity instead of choosing between equally matching tests", () => {
		const result = matchTestEvidenceReferences({
			references: [
				{
					testName: "creates a todo",
					conditionIds: ["AC-001"],
				},
			],
			testCases: [
				activeCase("creates a todo", {
					caseKey: "vitest:tests/a.test.ts:creates a todo",
					filePath: "tests/a.test.ts",
				}),
				activeCase("creates a todo", {
					caseKey: "vitest:tests/b.test.ts:creates a todo",
					filePath: "tests/b.test.ts",
				}),
			],
		});

		expect(result.matches).toEqual([]);
		expect(result.ambiguous[0]?.candidates).toHaveLength(2);
	});

	it("returns ambiguity when multiple non-equal candidates exceed 90%", () => {
		const result = matchTestEvidenceReferences({
			references: [
				{
					testName: "creates a todo successfully",
					conditionIds: ["AC-001"],
				},
			],
			testCases: [
				activeCase("creates a todo successfully", {
					caseKey: "vitest:tests/a.test.ts:creates a todo successfully",
				}),
				activeCase("creates todo successfully", {
					caseKey: "vitest:tests/b.test.ts:creates todo successfully",
					filePath: "tests/b.test.ts",
				}),
			],
		});

		expect(result.matches).toEqual([]);
		expect(result.ambiguous[0]?.candidates).toHaveLength(2);
		expect(result.ambiguous[0]?.candidates[0]?.score).toBe(1);
		expect(result.ambiguous[0]?.candidates[1]?.score).toBeGreaterThanOrEqual(
			0.9,
		);
	});

	it("does not interpret a case key as a test name", () => {
		const testCase = activeCase("unrelated test", {
			caseKey: "vitest:tests/example.test.ts:creates a todo",
		});
		const result = matchTestEvidenceReferences({
			references: [
				{
					testName: testCase.caseKey,
					conditionIds: ["AC-001"],
				},
			],
			testCases: [testCase],
		});

		expect(result.matches).toEqual([]);
		expect(result.missing).toHaveLength(1);
	});
});
