import { describe, expect, it } from "vitest";
import { parseVitestJsonCases } from "../../api/services/verification/adapters/vitest-json";

describe("Vitest JSON verification adapter", () => {
	it("extracts structured case results and evidence kind", () => {
		const cases = parseVitestJsonCases({
			evidenceKind: "unit_test",
			text: JSON.stringify({
				testResults: [
					{
						name: "/repo/tests/todo.test.ts",
						assertionResults: [
							{
								ancestorTitles: ["todo"],
								title: "creates a task",
								fullName: "todo creates a task",
								status: "passed",
								duration: 12,
								failureMessages: [],
							},
						],
					},
				],
			}),
		});

		expect(cases).toEqual([
			expect.objectContaining({
				name: "todo creates a task",
				filePath: "/repo/tests/todo.test.ts",
				runner: "vitest",
				evidenceKind: "unit_test",
				status: "passed",
				durationMs: 12,
			}),
		]);
	});

	it("does not infer structured evidence from mixed console output", () => {
		expect(
			parseVitestJsonCases({
				text: `log\n${JSON.stringify({ testResults: [] })}`,
			}),
		).toEqual([]);
	});
});
