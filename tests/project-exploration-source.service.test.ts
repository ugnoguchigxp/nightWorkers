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
const HEAD = "abc123";

describe("projectPath-first project exploration preparation", () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "exploration-source-")),
		);
	});

	afterEach(async () => {
		await fs.rm(projectRoot, { recursive: true, force: true });
	});

	it.each([
		[false, "native-api-runner", SERVER_ID, HEAD, [], "disabled"],
		[true, "codex-sdk", SERVER_ID, HEAD, [], "wrong_runtime_lane"],
		[true, "native-api-runner", null, HEAD, [], "server_missing"],
		[true, "native-api-runner", SERVER_ID, null, [], "revision_unavailable"],
		[
			true,
			"native-api-runner",
			SERVER_ID,
			HEAD,
			["dirty.ts"],
			"revision_unavailable",
		],
	] as const)("short-circuits guarded fallback %#", async (enabled, runtimeLane, serverId, expectedHead, dirty, reason) => {
		const access = fixture();
		await expect(
			resolveProjectExplorationCatalogPin({
				...baseInput(),
				expectedHead,
				preExistingDirtyPaths: [...dirty],
				settings: { enabled, mcpServerId: serverId },
				runtimeLane,
				mcpAccess: access.value,
			}),
		).resolves.toMatchObject({ version: 2, available: false, reason });
		expect(access.listTools).not.toHaveBeenCalled();
		expect(access.callTool).not.toHaveBeenCalled();
	});

	it("prepares by canonical projectPath and returns an ID-free v2 availability", async () => {
		const access = fixture({ statuses: [status("ready", true)] });
		const result = await resolve(access.value);
		expect(result).toMatchObject({
			version: 2,
			available: true,
			serverId: SERVER_ID,
			preparationStatus: "ready",
			freshness: {
				status: "current",
				sourceRevisionKind: "git",
				sourceRevisionValue: HEAD,
			},
			preparation: { reused: true, pollCount: 0 },
		});
		expect(access.callTool).toHaveBeenCalledTimes(1);
		expect(access.callTool).toHaveBeenCalledWith(
			SERVER_ID,
			"vuln_prepare_project_intelligence",
			{ projectPath: await fs.realpath(projectRoot) },
		);
		for (const internalKey of [
			"projectId",
			"scanRunId",
			"generationId",
			"rootRef",
		]) {
			expect(JSON.stringify(result)).not.toContain(internalKey);
		}
	});

	it("does not enable a generation when the source changes during preparation", async () => {
		const access = fixture({ statuses: [status("ready")] });
		const readSourceState = vi
			.fn()
			.mockResolvedValueOnce({ head: HEAD, dirty: false })
			.mockResolvedValueOnce({ head: "different-head", dirty: false });
		await expect(
			resolveProjectExplorationCatalogPin({
				...baseInput(),
				mcpAccess: access.value,
				policy: { maxWaitMs: 0, minPollMs: 1, maxPollMs: 1 },
				readSourceState,
			}),
		).resolves.toMatchObject({
			available: false,
			reason: "stale",
		});
		expect(readSourceState).toHaveBeenCalledTimes(2);
	});

	it("polls the same job without starting a duplicate prepare", async () => {
		const access = fixture({
			statuses: [status("queued"), status("running"), status("ready")],
		});
		const sleep = vi.fn(async () => undefined);
		const result = await resolve(
			access.value,
			{
				maxWaitMs: 500,
				minPollMs: 100,
				maxPollMs: 100,
			},
			sleep,
		);
		expect(result).toMatchObject({
			available: true,
			preparation: { pollCount: 2 },
		});
		expect(
			access.callTool.mock.calls.filter(
				(call) => call[1] === "vuln_prepare_project_intelligence",
			),
		).toHaveLength(1);
		expect(
			access.callTool.mock.calls.filter(
				(call) => call[1] === "vuln_get_project_intelligence_status",
			),
		).toHaveLength(2);
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it("fails open after bounded polling", async () => {
		const access = fixture({
			statuses: [status("queued"), status("running"), status("running")],
		});
		await expect(
			resolve(
				access.value,
				{ maxWaitMs: 200, minPollMs: 100, maxPollMs: 100 },
				async () => undefined,
			),
		).resolves.toMatchObject({
			version: 2,
			available: false,
			reason: "preparation_timeout",
			retryable: true,
			preparation: { pollCount: 2 },
		});
	});

	it("reuses registered-root intelligence for a clean same-revision worktree", async () => {
		const otherRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "exploration-worktree-"),
		);
		try {
			const access = fixture({ statuses: [status("ready", true)] });
			await expect(
				resolveProjectExplorationCatalogPin({
					...baseInput(),
					executionRoot: otherRoot,
					mcpAccess: access.value,
					readSourceState: async () => ({ head: HEAD, dirty: false }),
				}),
			).resolves.toMatchObject({
				version: 2,
				available: true,
			});
			expect(access.callTool).toHaveBeenCalledWith(
				SERVER_ID,
				"vuln_prepare_project_intelligence",
				{ projectPath: projectRoot },
			);
		} finally {
			await fs.rm(otherRoot, { recursive: true, force: true });
		}
	});

	it("rejects a worktree at a different revision before MCP access", async () => {
		const otherRoot = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "exploration-worktree-")),
		);
		try {
			const access = fixture();
			await expect(
				resolveProjectExplorationCatalogPin({
					...baseInput(),
					executionRoot: otherRoot,
					mcpAccess: access.value,
					readSourceState: async (projectPath) => ({
						head: projectPath === otherRoot ? "different-head" : HEAD,
						dirty: false,
					}),
				}),
			).resolves.toMatchObject({ available: false, reason: "stale" });
			expect(access.callTool).not.toHaveBeenCalled();
		} finally {
			await fs.rm(otherRoot, { recursive: true, force: true });
		}
	});

	it("requires action/query annotations and all path-first tools", async () => {
		const missing = fixture({
			toolNames: ["vuln_prepare_project_intelligence"],
		});
		await expect(resolve(missing.value)).resolves.toMatchObject({
			available: false,
			reason: "tool_missing",
		});
		const invalid = fixture({ invalidAnnotations: true });
		await expect(resolve(invalid.value)).resolves.toMatchObject({
			available: false,
			reason: "contract_invalid",
		});
		const compatibleUnion = fixture({ catalogAnyOf: true });
		await expect(resolve(compatibleUnion.value)).resolves.toMatchObject({
			available: true,
		});
		const missingFocus = fixture({ catalogMissingFocus: true });
		await expect(resolve(missingFocus.value)).resolves.toMatchObject({
			available: false,
			reason: "contract_invalid",
		});
	});

	it("separates malformed contracts, stale state, and MCP failures", async () => {
		const malformed = fixture({ rawStatuses: [mcp({ invalid: true })] });
		await expect(resolve(malformed.value)).resolves.toMatchObject({
			reason: "contract_invalid",
		});
		const wrongProject = accessFixture({
			statuses: [status("ready")],
			projectPath: "/different/project",
		});
		await expect(resolve(wrongProject.value)).resolves.toMatchObject({
			reason: "contract_invalid",
		});
		const stale = fixture({ statuses: [status("stale")] });
		await expect(resolve(stale.value)).resolves.toMatchObject({
			reason: "stale",
		});
		const failed = fixture();
		failed.callTool.mockRejectedValueOnce(new Error("offline"));
		await expect(resolve(failed.value)).resolves.toMatchObject({
			reason: "mcp_failed",
			retryable: true,
		});
	});

	it("requires producer revision parity and usable readiness before exposing the tool", async () => {
		const mismatched = fixture({
			statuses: [status("ready", false, { head: "different-head" })],
		});
		await expect(resolve(mismatched.value)).resolves.toMatchObject({
			available: false,
			reason: "stale",
		});

		const unusable = fixture({
			statuses: [status("ready", false, { usability: "unusable" })],
		});
		await expect(resolve(unusable.value)).resolves.toMatchObject({
			available: false,
			reason: "degraded_unusable",
			readiness: {
				usability: "unusable",
				reasonCodes: ["fixture_degraded"],
			},
		});
	});

	function baseInput() {
		return {
			registeredRepoRoot: projectRoot,
			executionRoot: projectRoot,
			expectedHead: HEAD,
			preExistingDirtyPaths: [],
			settings: { enabled: true, mcpServerId: SERVER_ID },
			runtimeLane: "native-api-runner",
		};
	}

	function fixture(overrides: Parameters<typeof accessFixture>[0] = {}) {
		return accessFixture({ ...overrides, projectPath: projectRoot });
	}

	function resolve(
		mcpAccess: ProjectExplorationMcpAccess,
		policy = { maxWaitMs: 0, minPollMs: 1, maxPollMs: 1 },
		sleep = async () => undefined,
	) {
		return resolveProjectExplorationCatalogPin({
			...baseInput(),
			mcpAccess,
			policy,
			sleep,
			readSourceState: async () => ({ head: HEAD, dirty: false }),
		});
	}
});

function status(
	value: "queued" | "running" | "ready" | "stale" | "failed",
	reused = false,
	capability: {
		head?: string;
		usability?: "usable" | "degraded_usable" | "unusable";
	} = {},
) {
	const usability = capability.usability ?? "usable";
	return {
		ok: value !== "failed",
		status: value,
		projectPath: "/canonical/project",
		reused,
		retryAfterMs: value === "queued" || value === "running" ? 100 : undefined,
		...(value === "ready"
			? {
					source: {
						structureSchemaVersion: "project-structure-v2",
						snapshotRef: "project_structure:v2:fixture",
						revision: {
							kind: "git",
							head: capability.head ?? HEAD,
							value: capability.head ?? HEAD,
						},
					},
					readiness: {
						usability,
						reasonCodes: usability === "usable" ? [] : ["fixture_degraded"],
						coverage: {
							inventoriedFiles: 10,
							analyzedFiles: 10,
							resolvedReferences: 4,
							unresolvedReferences: 0,
							inferredModules: 2,
						},
					},
				}
			: {}),
		...(value === "failed"
			? { errorCode: "SCAN_FAILED", retryable: true }
			: {}),
	};
}

function accessFixture(
	overrides: {
		server?: McpServerConfig;
		toolNames?: string[];
		statuses?: unknown[];
		rawStatuses?: unknown[];
		invalidAnnotations?: boolean;
		catalogAnyOf?: boolean;
		catalogMissingFocus?: boolean;
		projectPath?: string;
	} = {},
) {
	const server = "server" in overrides ? overrides.server : serverFixture();
	const toolNames = overrides.toolNames ?? [
		"vuln_prepare_project_intelligence",
		"vuln_get_project_intelligence_status",
		"vuln_get_project_exploration_catalog",
	];
	const listTools = vi.fn(async () =>
		toolNames.map((name) => ({
			serverId: SERVER_ID,
			serverName: "fixture",
			toolPrefix: "vuln",
			name,
			namespacedName: `mcp__vuln__${name}`,
			annotations: {
				readOnlyHint: overrides.invalidAnnotations
					? true
					: name !== "vuln_prepare_project_intelligence",
				destructiveHint: false,
				idempotentHint: true,
			},
			inputSchema:
				name === "vuln_get_project_exploration_catalog" &&
				overrides.catalogAnyOf
					? {
							anyOf: [
								{
									properties: {
										projectPath: { type: "string" },
										focus: { type: "object" },
										limits: { type: "object" },
									},
									required: ["projectPath"],
								},
								{
									properties: {
										scanRunId: { type: "string" },
										generationId: { type: "string" },
									},
									required: ["scanRunId"],
								},
							],
						}
					: {
							type: "object",
							properties: {
								projectPath: { type: "string" },
								...(name === "vuln_get_project_exploration_catalog" &&
								!overrides.catalogMissingFocus
									? { focus: { type: "object" } }
									: {}),
							},
							required: ["projectPath"],
							additionalProperties: false,
						},
		})),
	);
	const responses = [
		...(overrides.rawStatuses ?? []),
		...(overrides.statuses ?? [status("ready")]).map((value) =>
			mcp({
				...(value as Record<string, unknown>),
				projectPath: overrides.projectPath ?? "/canonical/project",
			}),
		),
	];
	const callTool = vi.fn(
		async () => responses.shift() ?? mcp(status("running")),
	);
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
