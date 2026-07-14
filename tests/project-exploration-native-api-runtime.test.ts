import { describe, expect, it } from "vitest";
import {
	buildInitialNativeApiHistory,
	readProjectExplorationCatalogPin,
} from "../api/services/agent-runtime/native-api-runner/native-api-tool-history";
import { getNativeApiToolDefinitions } from "../api/services/agent-runtime/native-api-runner/native-api-tool-registry";
import type { AgentRunContext } from "../api/services/agent-runtime/types";

const pin = {
	version: 1,
	available: true,
	serverId: "server-1",
	rootRef: "a".repeat(64),
	projectId: "project-1",
	scanRunId: "scan-1",
	generationId: "00000000-0000-4000-8000-000000000401",
	snapshotRef: "code_structure:fixture",
	sourceTreeHash: "b".repeat(64),
	sourceStateHash: "c".repeat(64),
	sourceRevisionHead: "abc123",
	toolName: "vuln_get_project_exploration_catalog",
};

describe("project exploration native API runtime", () => {
	it("exposes only the existing generic MCP tools when catalog is enabled", () => {
		const enabled = toolNames({
			executionMode: "implementation",
			ontologyMcpEnabled: false,
			projectExplorationCatalogEnabled: true,
		});
		expect(enabled).toEqual(
			expect.arrayContaining(["list_mcp_tools", "mcp_call_tool"]),
		);
		const disabled = toolNames({
			executionMode: "implementation",
			ontologyMcpEnabled: false,
			projectExplorationCatalogEnabled: false,
		});
		expect(disabled).not.toContain("list_mcp_tools");
		expect(disabled).not.toContain("mcp_call_tool");
		expect(enabled.filter((name) => name.includes("exploration"))).toEqual([]);
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
		expect(after).not.toContain("mcp_call_tool");
	});

	it("renders pinned one-call guidance without payload or provenance hashes", () => {
		const context = contextFixture(pin);
		expect(readProjectExplorationCatalogPin(context)).toEqual(pin);
		const system = buildInitialNativeApiHistory(context)[0];
		if (!system || system.type !== "system")
			throw new Error("missing system prompt");
		const prompt = system.content;
		expect(prompt).toContain("server-1");
		expect(prompt).toContain("scan-1");
		expect(prompt).toContain(pin.generationId);
		expect(prompt.match(/vuln_get_project_exploration_catalog/g)).toHaveLength(
			1,
		);
		expect(prompt).toContain("少なくとも1つ");
		expect(prompt).toContain("module IDを捏造しない");
		expect(prompt).toContain("一度だけ");
		expect(prompt).toContain("単一file作業なら呼び出しを省略");
		expect(prompt).toContain("編集前に対象sourceをread_fileで読んで");
		expect(prompt).not.toContain(pin.rootRef);
		expect(prompt).not.toContain(pin.sourceTreeHash);
		expect(prompt).not.toContain("likelyFiles");
	});

	it("hides guidance for unavailable, invalid, and non-implementation snapshots", () => {
		for (const context of [
			contextFixture({ version: 1, available: false, reason: "disabled" }),
			contextFixture({ available: true, invalid: true }),
			contextFixture(pin, "review"),
		]) {
			const system = buildInitialNativeApiHistory(context)[0];
			if (!system || system.type !== "system")
				throw new Error("missing system prompt");
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
