import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasRegisteredIsolatedNativeApiFixture } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-e2e-fixture-isolation";
import {
	clearFixtureProviderToolTurns,
	registerFixtureProviderToolTurns,
} from "../api/services/structured-llm/fixture-tool-provider";

const taskId = "fixture-task";

function context(repoRoot: string) {
	return {
		taskId,
		repoRoot,
		contextSnapshot: { compiledPrompt: "", source: "task_prompt" },
		runtimeOptions: { llmRouting: { activeRole: "implementation" } },
	} as never;
}

describe("isolated native API fixture capability", () => {
	beforeEach(() => {
		process.env.NIGHTWORKERS_E2E = "1";
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
		process.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE = "1";
		process.env.NIGHTWORKERS_E2E_WORKSPACE_ROOT = "/e2e/workspaces";
		registerFixtureProviderToolTurns(
			taskId,
			[{ content: "fixture", toolCalls: [] }],
			"implementation",
		);
	});

	afterEach(() => {
		clearFixtureProviderToolTurns(taskId);
		delete process.env.NIGHTWORKERS_E2E;
		delete process.env.NIGHTWORKERS_E2E_ISOLATED;
		delete process.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE;
		delete process.env.NIGHTWORKERS_E2E_WORKSPACE_ROOT;
	});

	it("requires the complete isolated-E2E capability and a registered workspace", () => {
		expect(
			hasRegisteredIsolatedNativeApiFixture(context("/e2e/workspaces/task")),
		).toBe(true);
		process.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE = "0";
		expect(
			hasRegisteredIsolatedNativeApiFixture(context("/e2e/workspaces/task")),
		).toBe(false);
	});

	it("never grants the fixture capability outside the isolated workspace", () => {
		expect(
			hasRegisteredIsolatedNativeApiFixture(context("/outside/workspace")),
		).toBe(false);
	});
});
