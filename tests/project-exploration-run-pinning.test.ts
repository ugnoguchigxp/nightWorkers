import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveRunProjectExplorationCatalogPin } from "../api/modules/nightworkers/run-orchestration/start-task-run-runtime-context";

const availablePin = {
	version: 2 as const,
	available: true as const,
	serverId: "server-1",
	preparedAt: "2026-07-15T00:00:00.000Z",
	preparationStatus: "ready" as const,
	freshness: {
		status: "current" as const,
		sourceRevisionKind: "git" as const,
		sourceRevisionValue: "abc123",
	},
	readiness: { codeStructure: "available" as const, reasonCodes: [] },
	preparation: { reused: true, durationMs: 10, pollCount: 0 },
	toolName: "vuln_get_project_exploration_catalog" as const,
};

describe("project exploration run pinning", () => {
	it("returns the immutable selected generation and forwards Git baseline facts", async () => {
		const resolvePin = vi.fn().mockResolvedValue(availablePin);
		await expect(
			resolveRunProjectExplorationCatalogPin({
				...baseInput(),
				resolvePin,
			}),
		).resolves.toEqual(availablePin);
		expect(resolvePin).toHaveBeenCalledWith({
			registeredRepoRoot: "/registered/repository",
			executionRoot: "/registered/repository",
			expectedHead: "abc123",
			preExistingDirtyPaths: ["pre-existing.ts"],
			settings: { enabled: true, mcpServerId: "server-1" },
			runtimeLane: "native-api-runner",
		});
	});

	it("fails open to the existing exploration path when MCP resolution throws", async () => {
		await expect(
			resolveRunProjectExplorationCatalogPin({
				...baseInput(),
				resolvePin: vi.fn().mockRejectedValue(new Error("offline")),
			}),
		).resolves.toEqual({
			version: 2,
			available: false,
			reason: "mcp_failed",
			retryable: true,
		});
	});

	it("persists the same pin in both run snapshots without runtimeOptions injection", async () => {
		const source = await fs.readFile(
			path.resolve(
				process.cwd(),
				"api/modules/nightworkers/run-orchestration/start-task-run.ts",
			),
			"utf8",
		);
		expect(
			source.match(/projectExplorationCatalog: projectExplorationCatalogPin/g),
		).toHaveLength(2);
		expect(source).toContain("registeredRepoRoot: repoInfo.localPath");
		expect(source).toContain("executionRoot");
		expect(source).not.toMatch(
			/runtimeOptions[\s\S]{0,120}projectExplorationCatalogPin/,
		);
	});
});

function baseInput() {
	return {
		registeredRepoRoot: "/registered/repository",
		executionRoot: "/registered/repository",
		expectedHead: "abc123",
		preExistingDirtyPaths: ["pre-existing.ts"],
		settings: { enabled: true, mcpServerId: "server-1" },
		runtimeLane: "native-api-runner",
	};
}
