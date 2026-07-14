import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveRunProjectExplorationCatalogPin } from "../api/modules/nightworkers/run-orchestration/start-task-run-runtime-context";

const availablePin = {
	version: 1 as const,
	available: true as const,
	serverId: "server-1",
	rootRef: "a".repeat(64),
	projectId: "project-1",
	scanRunId: "scan-1",
	generationId: "00000000-0000-4000-8000-000000000301",
	snapshotRef: "code_structure:fixture",
	sourceTreeHash: "b".repeat(64),
	sourceStateHash: "c".repeat(64),
	sourceRevisionHead: "abc123",
	toolName: "vuln_get_project_exploration_catalog" as const,
};

describe("project exploration run pinning", () => {
	it("skips every non-implementation mode without resolving MCP", async () => {
		for (const executionMode of [
			"planning",
			"test",
			"review",
			"general_answer",
		]) {
			const resolvePin = vi.fn();
			await expect(
				resolveRunProjectExplorationCatalogPin({
					...baseInput(),
					executionMode,
					resolvePin,
				}),
			).resolves.toEqual({
				version: 1,
				available: false,
				reason: "wrong_runtime_lane",
			});
			expect(resolvePin).not.toHaveBeenCalled();
		}
	});

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
			version: 1,
			available: false,
			reason: "mcp_failed",
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
		expect(source).not.toMatch(
			/runtimeOptions[\s\S]{0,120}projectExplorationCatalogPin/,
		);
	});
});

function baseInput() {
	return {
		executionMode: "implementation",
		registeredRepoRoot: "/registered/repository",
		expectedHead: "abc123",
		preExistingDirtyPaths: ["pre-existing.ts"],
		settings: { enabled: true, mcpServerId: "server-1" },
		runtimeLane: "native-api-runner",
	};
}
