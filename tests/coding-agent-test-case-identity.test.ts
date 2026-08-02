import { describe, expect, it } from "vitest";
import {
	assignShortTestCaseKeys,
	normalizeTestCaseName,
	normalizeTestCasePath,
	resolveInventoryRelativeTestCasePath,
} from "../api/modules/codingAgent/verification/test-case-identity";

describe("Coding Agent testcase identity", () => {
	it("normalizes Vitest suite separators without weakening name identity", () => {
		expect(normalizeTestCaseName("TodoView > creates a todo")).toBe(
			normalizeTestCaseName("TodoView creates a todo"),
		);
		expect(normalizeTestCaseName("TodoView creates another todo")).not.toBe(
			normalizeTestCaseName("TodoView creates a todo"),
		);
	});

	it("normalizes NFKC, case, and whitespace deterministically", () => {
		expect(normalizeTestCaseName("  ＴＯＤＯ  >\tＣＲＥＡＴＥＳ  ")).toBe(
			"todo creates",
		);
	});

	it("preserves filesystem path case while normalizing separators", () => {
		expect(normalizeTestCasePath("tests\\Foo.test.ts")).toBe(
			"tests/Foo.test.ts",
		);
		expect(normalizeTestCasePath("tests/Foo.test.ts")).not.toBe(
			normalizeTestCasePath("tests/foo.test.ts"),
		);
	});

	it("resolves relative discovery paths from the inventory cwd", () => {
		expect(
			resolveInventoryRelativeTestCasePath({
				cwd: "/workspace/project",
				filePath: "tests/example.test.ts",
			}),
		).toBe("tests/example.test.ts");
	});

	it("sorts by runner, file, and canonical name before assigning short keys", () => {
		const cases = assignShortTestCaseKeys([
			{
				caseKey: "legacy-b",
				name: "second",
				filePath: "tests/b.test.ts",
				runner: "vitest",
				discoveryLevel: "active",
				declaredConditionIds: [],
			},
			{
				caseKey: "legacy-a",
				name: "first",
				filePath: "tests/a.test.ts",
				runner: "vitest",
				discoveryLevel: "active",
				declaredConditionIds: [],
			},
		]);

		expect(
			cases.map(({ caseKey, filePath }) => ({ caseKey, filePath })),
		).toEqual([
			{ caseKey: "T1", filePath: "tests/a.test.ts" },
			{ caseKey: "T2", filePath: "tests/b.test.ts" },
		]);
	});
});
