import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ProjectExplorationMcpAccess,
	resolveProjectExplorationCatalogPin,
} from "../api/modules/ontology/exploration/project-exploration-source.service";
import type { McpServerConfig } from "../api/services/mcp/mcp-config-schema";

const SERVER_ID = "00000000-0000-4000-8000-000000000201";
const GENERATION_ID = "00000000-0000-4000-8000-000000000202";
const HEAD = "abc123";
const HASH = "a".repeat(64);

describe("project exploration source selection", () => {
	let tempDir: string;
	let rootRef: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "exploration-source-"));
		rootRef = createHash("sha256")
			.update(await fs.realpath(tempDir))
			.digest("hex");
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it.each([
		[false, "native-api-runner", SERVER_ID, HEAD, [], "disabled"],
		[true, "codex-sdk", SERVER_ID, HEAD, [], "wrong_runtime_lane"],
		[true, "native-api-runner", null, HEAD, [], "server_missing"],
		[true, "native-api-runner", SERVER_ID, null, [], "revision_mismatch"],
		[
			true,
			"native-api-runner",
			SERVER_ID,
			HEAD,
			["dirty.ts"],
			"revision_mismatch",
		],
	] as const)("short-circuits guarded fallback %#", async (enabled, runtimeLane, serverId, expectedHead, dirty, reason) => {
		const access = accessFixture();
		await expect(
			resolveProjectExplorationCatalogPin({
				registeredRepoRoot: tempDir,
				expectedHead,
				preExistingDirtyPaths: [...dirty],
				settings: { enabled, mcpServerId: serverId },
				runtimeLane,
				mcpAccess: access.value,
			}),
		).resolves.toEqual({ version: 1, available: false, reason });
		expect(access.listTools).not.toHaveBeenCalled();
		expect(access.callTool).not.toHaveBeenCalled();
	});

	it("hashes the canonical registered root and returns one validated immutable pin", async () => {
		const access = accessFixture();
		const result = await resolve(access.value);
		expect(result).toEqual({
			version: 1,
			available: true,
			serverId: SERVER_ID,
			rootRef,
			projectId: "project-1",
			scanRunId: "scan-1",
			generationId: GENERATION_ID,
			snapshotRef: "code_structure:fixture",
			sourceTreeHash: HASH,
			sourceStateHash: "b".repeat(64),
			sourceRevisionHead: HEAD,
			toolName: "vuln_get_project_exploration_catalog",
		});
		expect(access.callTool).toHaveBeenNthCalledWith(
			1,
			SERVER_ID,
			"vuln_list_knowledge_sources",
			{ rootRef, limit: 20 },
		);
		expect(JSON.stringify(access.callTool.mock.calls)).not.toContain(tempDir);
	});

	it("selects generatedAt desc then generationId asc", async () => {
		const lowerId = "00000000-0000-4000-8000-000000000203";
		const higherId = "00000000-0000-4000-8000-000000000204";
		const access = accessFixture({
			sources: [
				source({ generationId: higherId }),
				source({ generationId: lowerId }),
			],
			manifestGenerationId: lowerId,
		});
		const result = await resolve(access.value);
		expect(result).toMatchObject({ available: true, generationId: lowerId });
		expect(access.callTool).toHaveBeenNthCalledWith(
			2,
			SERVER_ID,
			"vuln_get_knowledge_source_manifest",
			{ scanRunId: "scan-1", generationId: lowerId },
		);
	});

	it.each([
		["empty", "source_missing"],
		["nonmatching_root", "source_missing"],
		["stale", "source_unusable"],
		["head_mismatch", "revision_mismatch"],
		["tree_hash_only", "revision_mismatch"],
	] as const)("classifies unusable discovery %#", async (scenario, reason) => {
		const sources =
			scenario === "empty"
				? []
				: [
						source(
							scenario === "nonmatching_root"
								? { rootRef: "f".repeat(64) }
								: scenario === "stale"
									? { readiness: "stale" }
									: scenario === "head_mismatch"
										? { head: "different" }
										: { sourceRevisionKind: "tree_hash_only" },
						),
					];
		const access = accessFixture({ sources });
		await expect(resolve(access.value)).resolves.toEqual({
			version: 1,
			available: false,
			reason,
		});
	});

	it("fails closed for missing server or tool", async () => {
		const missingServer = accessFixture({ server: undefined });
		await expect(resolve(missingServer.value)).resolves.toMatchObject({
			available: false,
			reason: "server_missing",
		});
		const missingTool = accessFixture({
			toolNames: ["vuln_list_knowledge_sources"],
		});
		await expect(resolve(missingTool.value)).resolves.toMatchObject({
			available: false,
			reason: "tool_missing",
		});
	});

	it("maps malformed and rejected MCP responses without throwing", async () => {
		const malformed = accessFixture({
			discoveryRaw: { content: [{ type: "text", text: "{" }] },
		});
		await expect(resolve(malformed.value)).resolves.toMatchObject({
			available: false,
			reason: "mcp_failed",
		});
		const rejected = accessFixture();
		rejected.callTool.mockRejectedValueOnce(new Error("offline"));
		await expect(resolve(rejected.value)).resolves.toMatchObject({
			available: false,
			reason: "mcp_failed",
		});
	});

	it("rejects malformed or mismatched exact manifests", async () => {
		const malformed = accessFixture({ manifestRaw: mcp({ ok: false }) });
		await expect(resolve(malformed.value)).resolves.toMatchObject({
			available: false,
			reason: "manifest_invalid",
		});
		const mismatch = accessFixture({ manifestProjectId: "other-project" });
		await expect(resolve(mismatch.value)).resolves.toMatchObject({
			available: false,
			reason: "manifest_invalid",
		});
	});

	async function resolve(mcpAccess: ProjectExplorationMcpAccess) {
		return resolveProjectExplorationCatalogPin({
			registeredRepoRoot: tempDir,
			expectedHead: HEAD,
			preExistingDirtyPaths: [],
			settings: { enabled: true, mcpServerId: SERVER_ID },
			runtimeLane: "native-api-runner",
			mcpAccess,
		});
	}

	function source(
		overrides: {
			rootRef?: string;
			generationId?: string;
			readiness?: "available" | "stale" | "degraded";
			head?: string;
			sourceRevisionKind?: "git" | "tree_hash_only";
		} = {},
	) {
		return {
			projectId: "project-1",
			rootRef: overrides.rootRef ?? rootRef,
			scanRunId: "scan-1",
			generationId: overrides.generationId ?? GENERATION_ID,
			generationGeneratedAt: "2026-07-14T12:00:00.000Z",
			sourceRevision: {
				kind: overrides.sourceRevisionKind ?? "git",
				...(overrides.sourceRevisionKind === "tree_hash_only"
					? {}
					: { head: overrides.head ?? HEAD }),
				value: overrides.head ?? HEAD,
			},
			readiness: overrides.readiness ?? "available",
		};
	}

	function accessFixture(
		overrides: {
			server?: McpServerConfig;
			toolNames?: string[];
			sources?: ReturnType<typeof source>[];
			discoveryRaw?: unknown;
			manifestRaw?: unknown;
			manifestProjectId?: string;
			manifestGenerationId?: string;
		} = {},
	) {
		const server = "server" in overrides ? overrides.server : serverFixture();
		const toolNames = overrides.toolNames ?? [
			"vuln_list_knowledge_sources",
			"vuln_get_knowledge_source_manifest",
			"vuln_get_project_exploration_catalog",
		];
		const listTools = vi.fn(async () =>
			toolNames.map((name) => ({
				serverId: SERVER_ID,
				serverName: "fixture",
				toolPrefix: "vuln",
				name,
				namespacedName: `mcp__vuln__${name}`,
			})),
		);
		const callTool = vi.fn(async (_serverId: string, toolName: string) => {
			if (toolName === "vuln_list_knowledge_sources") {
				return (
					overrides.discoveryRaw ??
					mcp({
						ok: true,
						status: "completed",
						sources: overrides.sources ?? [source()],
					})
				);
			}
			return (
				overrides.manifestRaw ??
				mcp({
					ok: true,
					status: "completed",
					manifest: {
						project: { id: overrides.manifestProjectId ?? "project-1" },
						scan: { id: "scan-1" },
						generation: {
							generationId: overrides.manifestGenerationId ?? GENERATION_ID,
							snapshotRef: "code_structure:fixture",
							sourceTreeHash: HASH,
							sourceStateHash: "b".repeat(64),
							status: "available",
						},
					},
				})
			);
		});
		return {
			listTools,
			callTool,
			value: {
				resolveServer: () => server,
				listTools,
				callTool,
			} satisfies ProjectExplorationMcpAccess,
		};
	}
});

function serverFixture(): McpServerConfig {
	return {
		id: SERVER_ID,
		name: "vulnWorkbench",
		enabled: true,
		transport: "stdio",
		command: "bun",
		args: [],
		env: {},
		toolPrefix: "vuln",
		createdAt: "2026-07-14T00:00:00.000Z",
		updatedAt: "2026-07-14T00:00:00.000Z",
	};
}

function mcp(payload: unknown) {
	return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}
