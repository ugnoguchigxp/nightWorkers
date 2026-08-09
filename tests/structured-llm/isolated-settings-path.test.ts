import { describe, expect, it } from "vitest";
import { resolveStructuredLlmSettingsPath } from "../../api/services/structured-llm/settings";

describe("isolated structured LLM settings path", () => {
	it("allows an explicit file for test and isolated evaluation scopes", () => {
		expect(
			resolveStructuredLlmSettingsPath({
				NODE_ENV: "test",
				NIGHTWORKERS_LLM_SETTINGS_PATH: " /tmp/test-llm.json ",
			}),
		).toBe("/tmp/test-llm.json");
		expect(
			resolveStructuredLlmSettingsPath({
				NODE_ENV: "development",
				NIGHTWORKERS_DATABASE_ACCESS_SCOPE: "isolated_evaluation",
				NIGHTWORKERS_LLM_SETTINGS_PATH: "/tmp/evaluation-llm.json",
			}),
		).toBe("/tmp/evaluation-llm.json");
	});

	it("ignores the explicit file in operational scope", () => {
		expect(
			resolveStructuredLlmSettingsPath({
				NODE_ENV: "production",
				NIGHTWORKERS_DATABASE_ACCESS_SCOPE: "operational",
				NIGHTWORKERS_LLM_SETTINGS_PATH: "/tmp/untrusted-override.json",
			}),
		).toBeUndefined();
	});
});
