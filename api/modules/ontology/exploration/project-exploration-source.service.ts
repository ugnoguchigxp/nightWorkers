import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import type {
	ProjectExplorationAvailabilityV2,
	ProjectExplorationCatalogPilotSettings,
} from "../../../../shared/schemas/project-exploration-catalog.schema";
import {
	type McpToolSummary,
	mcpClientManager,
} from "../../../services/mcp/mcp-client-manager";
import type { McpServerConfig } from "../../../services/mcp/mcp-config-schema";
import { getEffectiveMcpServer } from "../../../services/mcp/mcp-effective-settings";
import {
	clampProjectIntelligencePollMs,
	PROJECT_INTELLIGENCE_PREPARATION_POLICY,
	PROJECT_INTELLIGENCE_TOOLS,
	type ProjectIntelligencePreparationPolicy,
	type ProjectIntelligenceStatus,
	parseMcpJson,
	projectIntelligenceStatusSchema,
} from "./project-intelligence-contract";

export type ProjectExplorationMcpAccess = {
	resolveServer(serverId: string): McpServerConfig | undefined;
	listTools(server: McpServerConfig): Promise<McpToolSummary[]>;
	callTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<unknown>;
};

const defaultMcpAccess: ProjectExplorationMcpAccess = {
	resolveServer: (serverId) => getEffectiveMcpServer(serverId) ?? undefined,
	listTools: (server) => mcpClientManager.listToolsForServer(server),
	callTool: (serverId, toolName, args) =>
		mcpClientManager.callTool(serverId, toolName, args),
};
const execFileAsync = promisify(execFile);

type ProjectSourceState = { head: string | null; dirty: boolean };

export async function resolveProjectExplorationCatalogPin(input: {
	registeredRepoRoot: string;
	executionRoot: string;
	expectedHead: string | null;
	preExistingDirtyPaths: string[];
	settings: ProjectExplorationCatalogPilotSettings;
	runtimeLane: string;
	mcpAccess?: ProjectExplorationMcpAccess;
	policy?: ProjectIntelligencePreparationPolicy;
	sleep?: (milliseconds: number) => Promise<void>;
	readSourceState?: (projectPath: string) => Promise<ProjectSourceState>;
}): Promise<ProjectExplorationAvailabilityV2> {
	if (!input.settings.enabled) return unavailable("disabled");
	if (input.runtimeLane !== "native-api-runner") {
		return unavailable("wrong_runtime_lane");
	}
	if (!input.settings.mcpServerId) return unavailable("server_missing");
	if (!input.expectedHead || input.preExistingDirtyPaths.length > 0) {
		return unavailable("revision_unavailable");
	}

	let projectPath: string;
	try {
		const [registeredRoot, executionRoot] = await Promise.all([
			fs.realpath(input.registeredRepoRoot),
			fs.realpath(input.executionRoot),
		]);
		if (registeredRoot !== executionRoot) {
			return unavailable("workspace_mismatch");
		}
		projectPath = registeredRoot;
	} catch {
		return unavailable("workspace_mismatch");
	}

	const mcp = input.mcpAccess ?? defaultMcpAccess;
	const policy = input.policy ?? PROJECT_INTELLIGENCE_PREPARATION_POLICY;
	const sleep = input.sleep ?? delay;
	const readSourceState = input.readSourceState ?? readGitSourceState;
	const startedAt = Date.now();
	let waitedMs = 0;
	let pollCount = 0;
	try {
		const server = mcp.resolveServer(input.settings.mcpServerId);
		if (!server?.enabled) return unavailable("server_missing");
		const tools = await mcp.listTools(server);
		const contract = validateToolContract(tools);
		if (!contract.ok) return unavailable(contract.reason);
		if (
			!(await sourceRevisionMatches(
				projectPath,
				input.expectedHead,
				readSourceState,
			))
		) {
			return unavailable("stale");
		}

		const prepared = await callStatusTool({
			mcp,
			serverId: server.id,
			toolName: PROJECT_INTELLIGENCE_TOOLS.prepare,
			projectPath,
		});
		if (!prepared) return unavailable("contract_invalid");
		if (isReadyOrPending(prepared.status) && !prepared.ok) {
			return unavailable("contract_invalid");
		}
		if (prepared.status === "ready") {
			if (
				!(await sourceRevisionMatches(
					projectPath,
					input.expectedHead,
					readSourceState,
				))
			) {
				return unavailable("stale", {
					preparation: preparation(startedAt, waitedMs, pollCount),
				});
			}
			return available({
				serverId: server.id,
				expectedHead: input.expectedHead,
				status: prepared,
				startedAt,
				waitedMs,
				pollCount,
			});
		}
		if (!isPending(prepared.status)) {
			return unavailableForStatus(prepared, startedAt, waitedMs, pollCount);
		}

		let pendingStatus = prepared;
		while (waitedMs < policy.maxWaitMs) {
			const pollMs = Math.min(
				clampProjectIntelligencePollMs(pendingStatus.retryAfterMs, policy),
				policy.maxWaitMs - waitedMs,
			);
			await sleep(pollMs);
			waitedMs += pollMs;
			pollCount += 1;
			const status = await callStatusTool({
				mcp,
				serverId: server.id,
				toolName: PROJECT_INTELLIGENCE_TOOLS.status,
				projectPath,
			});
			if (!status) {
				return unavailable("contract_invalid", {
					preparation: preparation(startedAt, waitedMs, pollCount),
				});
			}
			if (isReadyOrPending(status.status) && !status.ok) {
				return unavailable("contract_invalid", {
					preparation: preparation(startedAt, waitedMs, pollCount),
				});
			}
			if (status.status === "ready") {
				if (
					!(await sourceRevisionMatches(
						projectPath,
						input.expectedHead,
						readSourceState,
					))
				) {
					return unavailable("stale", {
						preparation: preparation(startedAt, waitedMs, pollCount),
					});
				}
				return available({
					serverId: server.id,
					expectedHead: input.expectedHead,
					status,
					startedAt,
					waitedMs,
					pollCount,
				});
			}
			if (!isPending(status.status)) {
				return unavailableForStatus(status, startedAt, waitedMs, pollCount);
			}
			pendingStatus = status;
		}
		return unavailable("preparation_timeout", {
			retryable: true,
			preparation: preparation(startedAt, waitedMs, pollCount),
		});
	} catch {
		return unavailable("mcp_failed", {
			retryable: true,
			preparation: preparation(startedAt, waitedMs, pollCount),
		});
	}
}

async function callStatusTool(input: {
	mcp: ProjectExplorationMcpAccess;
	serverId: string;
	toolName: string;
	projectPath: string;
}) {
	const response = await input.mcp.callTool(input.serverId, input.toolName, {
		projectPath: input.projectPath,
	});
	const parsed = projectIntelligenceStatusSchema.safeParse(
		parseMcpJson(response),
	);
	if (!parsed.success || parsed.data.projectPath !== input.projectPath)
		return null;
	return parsed.data;
}

function validateToolContract(
	tools: McpToolSummary[],
): { ok: true } | { ok: false; reason: "tool_missing" | "contract_invalid" } {
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	const prepare = byName.get(PROJECT_INTELLIGENCE_TOOLS.prepare);
	const status = byName.get(PROJECT_INTELLIGENCE_TOOLS.status);
	const catalog = byName.get(PROJECT_INTELLIGENCE_TOOLS.catalog);
	if (!prepare || !status || !catalog)
		return { ok: false, reason: "tool_missing" };
	if (
		prepare.annotations?.readOnlyHint !== false ||
		status.annotations?.readOnlyHint !== true ||
		catalog.annotations?.readOnlyHint !== true
	) {
		return { ok: false, reason: "contract_invalid" };
	}
	return { ok: true };
}

function available(input: {
	serverId: string;
	expectedHead: string;
	status: ProjectIntelligenceStatus;
	startedAt: number;
	waitedMs: number;
	pollCount: number;
}): ProjectExplorationAvailabilityV2 {
	return {
		version: 2,
		available: true,
		serverId: input.serverId,
		toolName: PROJECT_INTELLIGENCE_TOOLS.catalog,
		preparedAt: new Date().toISOString(),
		preparationStatus: "ready",
		freshness: {
			status: "current",
			sourceRevisionKind: "git",
			sourceRevisionValue: input.expectedHead,
		},
		readiness: { codeStructure: "available", reasonCodes: [] },
		preparation: {
			reused: input.status.reused === true,
			...preparation(input.startedAt, input.waitedMs, input.pollCount),
		},
	};
}

function unavailableForStatus(
	status: ProjectIntelligenceStatus,
	startedAt: number,
	waitedMs: number,
	pollCount: number,
): ProjectExplorationAvailabilityV2 {
	const reason =
		status.status === "stale"
			? "stale"
			: status.status === "not_prepared"
				? "not_prepared"
				: "mcp_failed";
	return unavailable(reason, {
		retryable: status.retryable,
		errorCode: status.errorCode,
		preparation: preparation(startedAt, waitedMs, pollCount),
	});
}

function isPending(status: ProjectIntelligenceStatus["status"]) {
	return status === "queued" || status === "running";
}

function isReadyOrPending(status: ProjectIntelligenceStatus["status"]) {
	return status === "ready" || isPending(status);
}

function preparation(startedAt: number, waitedMs: number, pollCount: number) {
	return {
		durationMs: Math.max(waitedMs, Date.now() - startedAt),
		pollCount,
	};
}

function unavailable(
	reason: Extract<
		ProjectExplorationAvailabilityV2,
		{ available: false }
	>["reason"],
	detail: Omit<
		Extract<ProjectExplorationAvailabilityV2, { available: false }>,
		"version" | "available" | "reason"
	> = {},
): ProjectExplorationAvailabilityV2 {
	return { version: 2, available: false, reason, ...detail };
}

function delay(milliseconds: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function sourceRevisionMatches(
	projectPath: string,
	expectedHead: string,
	readSourceState: (projectPath: string) => Promise<ProjectSourceState>,
) {
	try {
		const source = await readSourceState(projectPath);
		return source.head === expectedHead && !source.dirty;
	} catch {
		return false;
	}
}

async function readGitSourceState(
	projectPath: string,
): Promise<ProjectSourceState> {
	const [head, status] = await Promise.all([
		execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
			cwd: projectPath,
		}),
		execFileAsync("git", ["status", "--porcelain=v1", "-z"], {
			cwd: projectPath,
		}),
	]);
	return {
		head: head.stdout.trim() || null,
		dirty: status.stdout.length > 0,
	};
}
