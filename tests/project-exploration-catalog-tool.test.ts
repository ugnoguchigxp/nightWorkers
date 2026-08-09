import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { projectWorkerResultToMcpStructuredPayload } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-result-projector";
import { projectExplorationCatalogTool } from "../api/modules/ontology/exploration/project-exploration-catalog-tool";
import { executeWorkerTool } from "../api/services/worker-tools/dispatcher";
import { projectExplorationPathCatalogResultSchema } from "../shared/schemas/project-exploration-catalog.schema";

describe("project exploration catalog worker adapter", () => {
	it("parses the producer V2 contract fixture", () => {
		const fixture = JSON.parse(
			readFileSync(
				new URL(
					"./fixtures/project-exploration-catalog-v2.json",
					import.meta.url,
				),
				"utf8",
			),
		);
		expect(projectExplorationPathCatalogResultSchema.parse(fixture)).toEqual(
			fixture,
		);
	});

	it("injects the project path and exposes only bounded model-safe clues", async () => {
		const callTool = vi.fn(async () =>
			mcp(
				catalog({
					projectPath: "/registered/private-project",
					focusResolution: {
						matchedPaths: ["src/app.ts"],
						matchedModuleIds: [],
						matchedTerms: ["routing"],
						unmatched: [],
					},
					likelyFiles: [
						{
							...file("src/app.ts"),
							roleTags: ["source", "project-internal"],
							unexpected: { scanRunId: "scan-internal" },
						},
					],
					degradedReasons: ["generation_degraded", "scan-internal"],
					provenance: {
						projectId: "project-internal",
						scanRunId: "scan-internal",
						generationId: "generation-internal",
					},
				}),
			),
		);
		const result = await projectExplorationCatalogTool({
			serverId: "server-1",
			projectPath: "/registered/private-project",
			executionPath: "/execution/worktree",
			expectedHead: "abc123",
			focus: { paths: ["src/app.ts"], terms: ["routing"] },
			mcpAccess: { callTool },
			readSourceState: currentSource,
		});

		expect(result.ok).toBe(true);
		expect(callTool).toHaveBeenCalledWith(
			"server-1",
			"vuln_get_project_exploration_catalog",
			{
				projectPath: "/registered/private-project",
				focus: { paths: ["src/app.ts"], terms: ["routing"] },
			},
		);
		expect(result.payload.audit.provenance).toMatchObject({
			projectId: "project-internal",
		});
		expect(result.payload.audit.rawResult).toMatchObject({
			projectPath: "/registered/private-project",
			provenance: { projectId: "project-internal" },
		});
		const modelView = JSON.stringify(
			projectWorkerResultToMcpStructuredPayload(result),
		);
		expect(modelView).toContain("src/app.ts");
		expect(modelView).toContain("src/app.test.ts");
		expect(modelView).not.toContain("/registered/private-project");
		expect(modelView).not.toContain("project-internal");
		expect(modelView).not.toContain("scan-internal");
		expect(modelView).not.toContain("generation-internal");
		expect(modelView).not.toContain("server-1");
	});

	it("does not return stale clues to the coding agent", async () => {
		const result = await projectExplorationCatalogTool({
			serverId: "server-1",
			projectPath: "/registered/project",
			executionPath: "/execution/worktree",
			expectedHead: "abc123",
			focus: { terms: ["routing"] },
			mcpAccess: {
				callTool: async () => mcp(catalog({ freshness: { status: "stale" } })),
			},
			readSourceState: currentSource,
		});
		expect(result).toMatchObject({
			ok: false,
			error: { code: "PROJECT_EXPLORATION_STALE" },
			payload: { status: "unavailable" },
		});
		expect(
			JSON.stringify(projectWorkerResultToMcpStructuredPayload(result)),
		).not.toContain("src/app.ts");
	});

	it("rejects producer revision mismatches and unusable readiness", async () => {
		const missingRevision = await projectExplorationCatalogTool({
			serverId: "server-1",
			projectPath: "/registered/project",
			executionPath: "/execution/worktree",
			expectedHead: "abc123",
			focus: { terms: ["routing"] },
			mcpAccess: {
				callTool: async () => mcp(catalog({ source: undefined })),
			},
			readSourceState: currentSource,
		});
		expect(missingRevision).toMatchObject({
			ok: false,
			error: { code: "PROJECT_EXPLORATION_CONTRACT_INVALID" },
		});

		const mismatched = await projectExplorationCatalogTool({
			serverId: "server-1",
			projectPath: "/registered/project",
			executionPath: "/execution/worktree",
			expectedHead: "abc123",
			focus: { terms: ["routing"] },
			mcpAccess: {
				callTool: async () =>
					mcp(
						catalog({
							source: source("different-head"),
						}),
					),
			},
			readSourceState: currentSource,
		});
		expect(mismatched).toMatchObject({
			ok: false,
			error: { code: "PROJECT_EXPLORATION_STALE" },
			payload: {
				audit: { failureCategory: "PROJECT_EXPLORATION_STALE" },
			},
		});

		const unusable = await projectExplorationCatalogTool({
			serverId: "server-1",
			projectPath: "/registered/project",
			executionPath: "/execution/worktree",
			expectedHead: "abc123",
			focus: { terms: ["routing"] },
			mcpAccess: {
				callTool: async () =>
					mcp(
						catalog({
							readiness: readiness("unusable"),
						}),
					),
			},
			readSourceState: currentSource,
		});
		expect(unusable).toMatchObject({
			ok: false,
			error: { code: "PROJECT_EXPLORATION_UNUSABLE" },
		});
	});

	it("returns degraded usable clues with readiness reasons intact", async () => {
		const result = await projectExplorationCatalogTool({
			serverId: "server-1",
			projectPath: "/registered/project",
			executionPath: "/execution/worktree",
			expectedHead: "abc123",
			focus: { terms: ["routing"] },
			mcpAccess: {
				callTool: async () =>
					mcp(
						catalog({
							status: "degraded",
							readiness: readiness("degraded_usable"),
						}),
					),
			},
			readSourceState: currentSource,
		});
		expect(result).toMatchObject({
			ok: true,
			payload: {
				status: "degraded",
				catalog: {
					readiness: {
						usability: "degraded_usable",
						reasonCodes: ["fixture_degraded"],
					},
				},
			},
		});
	});

	it("requires a focused query before MCP access", async () => {
		const callTool = vi.fn();
		const result = await projectExplorationCatalogTool({
			serverId: "server-1",
			projectPath: "/registered/project",
			executionPath: "/execution/worktree",
			expectedHead: "abc123",
			focus: {},
			mcpAccess: { callTool },
		});
		expect(result).toMatchObject({
			ok: false,
			error: { code: "PROJECT_EXPLORATION_FOCUS_REQUIRED" },
		});
		expect(callTool).not.toHaveBeenCalled();
	});

	it("rejects absolute and traversal paths returned by the producer", async () => {
		for (const unsafePath of [
			"/tmp/outside.ts",
			"../outside.ts",
			"C:\\outside.ts",
		]) {
			const result = await projectExplorationCatalogTool({
				serverId: "server-1",
				projectPath: "/registered/project",
				executionPath: "/execution/worktree",
				expectedHead: "abc123",
				focus: { terms: ["routing"] },
				mcpAccess: {
					callTool: async () =>
						mcp(
							catalog({
								likelyFiles: [file(unsafePath)],
							}),
						),
				},
				readSourceState: currentSource,
			});
			expect(result).toMatchObject({
				ok: false,
				error: { code: "PROJECT_EXPLORATION_UNSAFE_PATH" },
			});
		}
	});

	it("rejects absolute focus paths before MCP access", async () => {
		const callTool = vi.fn();
		const result = await projectExplorationCatalogTool({
			serverId: "server-1",
			projectPath: "/registered/project",
			executionPath: "/execution/worktree",
			expectedHead: "abc123",
			focus: { paths: ["/registered/project/src/app.ts"] },
			mcpAccess: { callTool },
		});
		expect(result).toMatchObject({
			ok: false,
			error: { code: "PROJECT_EXPLORATION_FOCUS_REQUIRED" },
		});
		expect(callTool).not.toHaveBeenCalled();
	});

	it("rejects catalog use after the execution worktree changes", async () => {
		const callTool = vi.fn();
		const result = await projectExplorationCatalogTool({
			serverId: "server-1",
			projectPath: "/registered/project",
			executionPath: "/execution/worktree",
			expectedHead: "abc123",
			focus: { terms: ["routing"] },
			mcpAccess: { callTool },
			readSourceState: async () => ({ head: "abc123", dirty: true }),
		});
		expect(result).toMatchObject({
			ok: false,
			error: { code: "PROJECT_EXPLORATION_EXECUTION_SOURCE_CHANGED" },
		});
		expect(callTool).not.toHaveBeenCalled();
	});

	it("does not return clues when the worktree changes during the MCP read", async () => {
		const callTool = vi.fn(async () => mcp(catalog()));
		const readSourceState = vi
			.fn()
			.mockResolvedValueOnce({ head: "abc123", dirty: false })
			.mockResolvedValueOnce({ head: "abc123", dirty: true });
		const result = await projectExplorationCatalogTool({
			serverId: "server-1",
			projectPath: "/registered/project",
			executionPath: "/execution/worktree",
			expectedHead: "abc123",
			focus: { terms: ["routing"] },
			mcpAccess: { callTool },
			readSourceState,
		});
		expect(result).toMatchObject({
			ok: false,
			error: { code: "PROJECT_EXPLORATION_EXECUTION_SOURCE_CHANGED" },
		});
		expect(callTool).toHaveBeenCalledTimes(1);
		expect(
			JSON.stringify(projectWorkerResultToMcpStructuredPayload(result)),
		).not.toContain("src/app.ts");
	});

	it("returns a structured unavailable result when run access is absent", async () => {
		const dispatched = await executeWorkerTool({
			toolName: "project_exploration_catalog",
			args: { focus: { terms: ["routing"] } },
			repoRoot: "/registered/project",
			readFiles: [],
		});
		expect(dispatched.result).toMatchObject({
			ok: false,
			error: { code: "PROJECT_EXPLORATION_NOT_AVAILABLE" },
			payload: { status: "unavailable" },
		});
	});
});

function catalog(overrides: Record<string, unknown> = {}) {
	return {
		ok: true,
		status: "completed",
		version: "v2",
		freshness: { status: "fresh" },
		source: source("abc123"),
		readiness: readiness("usable"),
		focusResolution: {
			matchedPaths: ["src/app.ts"],
			matchedModuleIds: [],
			matchedTerms: ["routing"],
			unmatched: [],
		},
		likelyFiles: [file("src/app.ts")],
		relatedTests: [
			{
				rank: 1,
				path: "src/app.test.ts",
				reasonCodes: ["direct_test_importer"],
				sourceRefs: ["file:src/app.ts"],
			},
		],
		verificationCandidates: [
			{
				rank: 1,
				command: "bun test src/app.test.ts",
				candidateOnly: true,
				sourceRefs: ["handoff:test"],
			},
		],
		truncation: {
			truncated: false,
			omittedFiles: 0,
			omittedTests: 0,
			omittedVerificationCommands: 0,
		},
		degradedReasons: [],
		...overrides,
	};
}

function source(head: string) {
	return {
		structureSchemaVersion: "project-structure-v2",
		snapshotRef: "project_structure:v2:fixture",
		revision: { kind: "git", head, value: head },
	};
}

function readiness(usability: "usable" | "degraded_usable" | "unusable") {
	return {
		usability,
		reasonCodes: usability === "usable" ? [] : ["fixture_degraded"],
		coverage: {
			inventoriedFiles: 10,
			analyzedFiles: 10,
			resolvedReferences: 4,
			unresolvedReferences: 0,
			inferredModules: 2,
		},
	};
}

function file(path: string) {
	return {
		rank: 1,
		path,
		roleTags: ["source"],
		reasonCodes: ["focus_path_exact"],
		sourceRefs: [`file:${path}`],
	};
}

function mcp(payload: unknown) {
	return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

async function currentSource() {
	return { head: "abc123", dirty: false };
}
