import { describe, expect, it } from "vitest";
import { isTestRunnerInScope } from "../api/modules/codingAgent/verification/test-scope";

describe("Coding Agent test runner scope", () => {
	it("applies every Questionnaire test-scope boundary", () => {
		expect(isTestRunnerInScope("vitest", "none")).toBe(false);
		expect(isTestRunnerInScope("vitest", "unit")).toBe(true);
		expect(isTestRunnerInScope("playwright", "unit")).toBe(false);
		expect(isTestRunnerInScope("playwright", "e2e_if_ui")).toBe(true);
		expect(isTestRunnerInScope("vitest", "e2e_if_ui")).toBe(false);
		expect(isTestRunnerInScope("vitest", "unit_and_e2e_if_ui")).toBe(true);
		expect(isTestRunnerInScope("playwright", "unit_and_e2e_if_ui")).toBe(true);
		expect(isTestRunnerInScope("unknown", "unspecified")).toBe(true);
		expect(isTestRunnerInScope("unknown", undefined)).toBe(true);
	});
});
