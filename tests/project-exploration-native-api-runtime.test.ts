import { describe, expect, it } from "vitest";
import {
	buildInitialNativeApiHistory,
	readProjectExplorationCatalogPin,
} from "../api/services/agent-runtime/native-api-runner/native-api-tool-history";
import { getNativeApiToolDefinitions } from "../api/services/agent-runtime/native-api-runner/native-api-tool-registry";
import type { AgentRunContext } from "../api/services/agent-runtime/types";

const pin = {
	version: 2,
	available: true,
	serverId: "server-1",
	preparedAt: "2026-07-15T00:00:00.000Z",
	preparationStatus: "ready",
	freshness: {
		status: "current",
		sourceRevisionKind: "git",
		sourceRevisionValue: "abc123",
	},
	readiness: { codeStructure: "available", reasonCodes: [] },
	preparation: { reused: true, durationMs: 10, pollCount: 0 },
	toolName: "vuln_get_project_exploration_catalog",
};

describe("project exploration native API runtime", () => {
	it("exposes only the focus-only catalog adapter when catalog is enabled", () => {
		const enabled = toolNames({
			executionMode: "implementation",
			ontologyMcpEnabled: false,
			projectExplorationCatalogEnabled: true,
		});
		expect(enabled).toContain("project_exploration_catalog");
		expect(enabled).not.toContain("list_mcp_tools");
		expect(enabled).not.toContain("mcp_call_tool");
		const disabled = toolNames({
			executionMode: "implementation",
			ontologyMcpEnabled: false,
			projectExplorationCatalogEnabled: false,
		});
		expect(disabled).not.toContain("project_exploration_catalog");
	});

	it("does not expand tools outside implementation mode", () => {
		const before = toolNames({
			executionMode: "test",
			projectExplorationCatalogEnabled: false,
		});
		const after = toolNames({
			executionMode: "test",
			projectExplorationCatalogEnabled: true,
		});
		expect(after).toEqual(before);
		expect(after).not.toContain("project_exploration_catalog");
	});

	it("renders focus-only guidance without path, server, or provenance IDs", () => {
		const context = contextFixture(pin);
		expect(readProjectExplorationCatalogPin(context)).toEqual(pin);
		const system = buildInitialNativeApiHistory(context)[0];
		if (system?.type !== "system") throw new Error("missing system prompt");
		const prompt = system.content;
		expect(prompt).toContain("project_exploration_catalog");
		expect(prompt).toContain("少なくとも1つ");
		expect(prompt).toContain("moduleを捏造しない");
		expect(prompt).toContain("一度だけ");
		expect(prompt).toContain("単一file作業なら呼び出しを省略");
		expect(prompt).toContain("編集前に対象sourceをread_fileで読んで");
		expect(prompt).not.toContain(pin.serverId);
		expect(prompt).not.toContain("projectPath");
		expect(prompt).not.toContain("scanRunId");
		expect(prompt).not.toContain("generationId");
		expect(prompt).not.toContain("likelyFiles");
	});

	it("hides guidance for unavailable, invalid, and non-implementation snapshots", () => {
		for (const context of [
			contextFixture({ version: 2, available: false, reason: "disabled" }),
			contextFixture({ available: true, invalid: true }),
			contextFixture(pin, "review"),
		]) {
			const system = buildInitialNativeApiHistory(context)[0];
			if (system?.type !== "system") throw new Error("missing system prompt");
			expect(system.content).not.toContain(
				"vuln_get_project_exploration_catalog",
			);
		}
	});
});

function toolNames(input: Parameters<typeof getNativeApiToolDefinitions>[0]) {
	return getNativeApiToolDefinitions(input).map((tool) => tool.name);
}

function contextFixture(
	projectExplorationCatalog: unknown,
	executionMode = "implementation",
): AgentRunContext {
	return {
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		repoRoot: "/worktree",
		compiledPrompt: "Implement the task",
		latestUserMessage: "Implement the task",
		timeoutSeconds: 60,
		contextSnapshot: {
			compiledPrompt: "Implement the task",
			source: "task_prompt",
			executionMode,
			projectExplorationCatalog,
		},
		runtimeOptions: { executionMode },
	};
}
