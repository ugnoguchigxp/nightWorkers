import path from "node:path";
import {
	type ProjectExplorationCatalogFocus,
	type ProjectExplorationPathCatalogResult,
	projectExplorationCatalogFocusSchema,
	projectExplorationPathCatalogResultSchema,
} from "../../../../shared/schemas/project-exploration-catalog.schema";
import { mcpClientManager } from "../../../services/mcp/mcp-client-manager";
import type { WorkerToolResult } from "../../../services/worker-tools/types";
import {
	PROJECT_INTELLIGENCE_TOOLS,
	parseMcpJson,
} from "./project-intelligence-contract";

type CatalogMcpAccess = {
	callTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<unknown>;
};

type ProjectExplorationCatalogPayload = {
	status: "completed" | "degraded" | "unavailable";
	catalog?: Record<string, unknown>;
	audit: {
		serverId: string;
		toolName: typeof PROJECT_INTELLIGENCE_TOOLS.catalog;
		freshness?: unknown;
		provenance?: unknown;
		responseBytes?: number;
		rawResult?: unknown;
	};
};

export async function projectExplorationCatalogTool(input: {
	serverId: string;
	projectPath: string;
	focus: unknown;
	mcpAccess?: CatalogMcpAccess;
}): Promise<WorkerToolResult<ProjectExplorationCatalogPayload>> {
	const startedAt = new Date().toISOString();
	const audit: ProjectExplorationCatalogPayload["audit"] = {
		serverId: input.serverId,
		toolName: PROJECT_INTELLIGENCE_TOOLS.catalog,
	};
	const focus = projectExplorationCatalogFocusSchema.safeParse(input.focus);
	if (!focus.success) {
		return failed(
			startedAt,
			audit,
			"PROJECT_EXPLORATION_FOCUS_REQUIRED",
			"focusにはpaths、modules、termsの少なくとも一つが必要です。",
		);
	}
	try {
		const response = await (input.mcpAccess ?? mcpClientManager).callTool(
			input.serverId,
			PROJECT_INTELLIGENCE_TOOLS.catalog,
			{ projectPath: input.projectPath, focus: focus.data },
		);
		const json = parseMcpJson(response);
		const serializedJson = JSON.stringify(json);
		audit.responseBytes =
			typeof serializedJson === "string"
				? Buffer.byteLength(serializedJson, "utf8")
				: 0;
		audit.rawResult = json;
		if (!json || typeof json !== "object") {
			return failed(
				startedAt,
				audit,
				"PROJECT_EXPLORATION_CONTRACT_INVALID",
				"Project exploration catalog response was invalid.",
			);
		}
		audit.freshness = (json as Record<string, unknown>).freshness;
		audit.provenance = (json as Record<string, unknown>).provenance;
		const parsed = projectExplorationPathCatalogResultSchema.safeParse(json);
		if (!parsed.success) {
			return failed(
				startedAt,
				audit,
				"PROJECT_EXPLORATION_CONTRACT_INVALID",
				"Project exploration catalog response was invalid.",
			);
		}
		if (parsed.data.freshness.status !== "fresh") {
			return failed(
				startedAt,
				audit,
				"PROJECT_EXPLORATION_STALE",
				"Project exploration catalog is unavailable for the current source state.",
			);
		}
		const sensitive = sensitiveValues(input.projectPath, audit.provenance);
		if (
			!hasOnlyProjectRelativePaths(parsed.data) ||
			catalogPaths(parsed.data).some((candidatePath) =>
				containsSensitiveValue(candidatePath, sensitive),
			)
		) {
			return failed(
				startedAt,
				audit,
				"PROJECT_EXPLORATION_UNSAFE_PATH",
				"Project exploration catalog contained an unsafe path.",
			);
		}

		const catalog = projectModelSafeCatalog(
			parsed.data,
			focus.data,
			input.projectPath,
			audit.provenance,
		);
		return {
			ok: true,
			toolName: "project_exploration_catalog",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: { status: parsed.data.status, catalog, audit },
		};
	} catch {
		return failed(
			startedAt,
			audit,
			"PROJECT_EXPLORATION_MCP_FAILED",
			"Project exploration catalog is temporarily unavailable.",
		);
	}
}

function projectModelSafeCatalog(
	data: ProjectExplorationPathCatalogResult,
	focus: ProjectExplorationCatalogFocus,
	projectPath: string,
	provenance: unknown,
) {
	const forbiddenValues = sensitiveValues(projectPath, provenance);
	const keepSafe = (value: string) =>
		!containsSensitiveValue(value, forbiddenValues);
	return {
		ok: true,
		status: data.status,
		freshness: { status: "fresh" },
		focus: {
			paths: focus.paths?.filter(keepSafe),
			modules: focus.modules?.filter(keepSafe),
			terms: focus.terms?.filter(keepSafe),
		},
		focusResolution: data.focusResolution
			? {
					matchedPaths: data.focusResolution.matchedPaths.filter(keepSafe),
					matchedModuleIds:
						data.focusResolution.matchedModuleIds.filter(keepSafe),
					matchedTerms: data.focusResolution.matchedTerms.filter(keepSafe),
					unmatched: data.focusResolution.unmatched.filter(keepSafe),
				}
			: undefined,
		likelyFiles: data.likelyFiles.map((item) => ({
			rank: item.rank,
			path: item.path,
			roleTags: item.roleTags?.filter(keepSafe),
			reasonCodes: item.reasonCodes?.filter(keepSafe),
		})),
		relatedTests: data.relatedTests.map((item) => ({
			rank: item.rank,
			path: item.path,
			reasonCodes: item.reasonCodes?.filter(keepSafe),
		})),
		verificationCandidates: data.verificationCandidates
			.filter((item) => keepSafe(item.command))
			.map((item) => ({
				rank: item.rank,
				command: item.command,
				candidateOnly: true,
			})),
		truncation: data.truncation,
		degradedReasons: data.degradedReasons?.filter(keepSafe) ?? [],
	};
}

function hasOnlyProjectRelativePaths(data: {
	likelyFiles: Array<{ path: string }>;
	relatedTests: Array<{ path: string }>;
	focusResolution?: { matchedPaths: string[] };
}) {
	return catalogPaths(data).every((candidatePath) => {
		if (
			!candidatePath ||
			candidatePath.includes("\0") ||
			candidatePath.includes("\\") ||
			path.isAbsolute(candidatePath) ||
			/^[a-zA-Z]:/.test(candidatePath)
		) {
			return false;
		}
		return !candidatePath.replaceAll("\\", "/").split("/").includes("..");
	});
}

function catalogPaths(data: {
	likelyFiles: Array<{ path: string }>;
	relatedTests: Array<{ path: string }>;
	focusResolution?: { matchedPaths: string[] };
}) {
	return [
		...data.likelyFiles.map((item) => item.path),
		...data.relatedTests.map((item) => item.path),
		...(data.focusResolution?.matchedPaths ?? []),
	];
}

function sensitiveValues(projectPath: string, provenance: unknown) {
	const values = new Set([projectPath]);
	if (
		!provenance ||
		typeof provenance !== "object" ||
		Array.isArray(provenance)
	) {
		return values;
	}
	const record = provenance as Record<string, unknown>;
	for (const key of [
		"projectId",
		"scanRunId",
		"generationId",
		"prepareJobId",
		"rootRef",
		"snapshotRef",
	]) {
		const value = record[key];
		if (typeof value === "string" && value.length >= 4) values.add(value);
	}
	return values;
}

function containsSensitiveValue(value: string, sensitive: Set<string>) {
	return [...sensitive].some((candidate) => value.includes(candidate));
}

export function projectExplorationCatalogUnavailableResult(
	message = "Project exploration catalog is not available for this run.",
): WorkerToolResult<ProjectExplorationCatalogPayload> {
	const startedAt = new Date().toISOString();
	return failed(
		startedAt,
		{ serverId: "unavailable", toolName: PROJECT_INTELLIGENCE_TOOLS.catalog },
		"PROJECT_EXPLORATION_NOT_AVAILABLE",
		message,
	);
}

function failed(
	startedAt: string,
	audit: ProjectExplorationCatalogPayload["audit"],
	code: string,
	message: string,
): WorkerToolResult<ProjectExplorationCatalogPayload> {
	return {
		ok: false,
		toolName: "project_exploration_catalog",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: { status: "unavailable", audit },
		error: { code, message },
	};
}
