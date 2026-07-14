import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type {
	ProjectExplorationCatalogPilotSettings,
	ProjectExplorationCatalogRunPin,
} from "../../../../shared/schemas/project-exploration-catalog.schema";
import {
	projectExplorationKnowledgeSourceListSchema,
	projectExplorationManifestSchema,
} from "../../../../shared/schemas/project-exploration-catalog.schema";
import {
	type McpToolSummary,
	mcpClientManager,
} from "../../../services/mcp/mcp-client-manager";
import type { McpServerConfig } from "../../../services/mcp/mcp-config-schema";
import { getEffectiveMcpServer } from "../../../services/mcp/mcp-effective-settings";

const REQUIRED_TOOLS = [
	"vuln_list_knowledge_sources",
	"vuln_get_knowledge_source_manifest",
	"vuln_get_project_exploration_catalog",
] as const;

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

export async function resolveProjectExplorationCatalogPin(input: {
	registeredRepoRoot: string;
	expectedHead: string | null;
	preExistingDirtyPaths: string[];
	settings: ProjectExplorationCatalogPilotSettings;
	runtimeLane: string;
	mcpAccess?: ProjectExplorationMcpAccess;
}): Promise<ProjectExplorationCatalogRunPin> {
	if (!input.settings.enabled) return unavailable("disabled");
	if (input.runtimeLane !== "native-api-runner") {
		return unavailable("wrong_runtime_lane");
	}
	if (!input.settings.mcpServerId) return unavailable("server_missing");
	if (!input.expectedHead || input.preExistingDirtyPaths.length > 0) {
		return unavailable("revision_mismatch");
	}
	const mcp = input.mcpAccess ?? defaultMcpAccess;
	try {
		const canonicalRoot = await fs.realpath(input.registeredRepoRoot);
		const rootRef = createHash("sha256").update(canonicalRoot).digest("hex");
		const server = mcp.resolveServer(input.settings.mcpServerId);
		if (!server?.enabled) return unavailable("server_missing");
		const tools = await mcp.listTools(server);
		const availableToolNames = new Set(tools.map((tool) => tool.name));
		if (REQUIRED_TOOLS.some((tool) => !availableToolNames.has(tool))) {
			return unavailable("tool_missing");
		}

		const discoveryResponse = await mcp.callTool(
			server.id,
			"vuln_list_knowledge_sources",
			{ rootRef, limit: 20 },
		);
		const discovery = projectExplorationKnowledgeSourceListSchema.safeParse(
			parseMcpJson(discoveryResponse),
		);
		if (!discovery.success) return unavailable("mcp_failed");
		if (discovery.data.sources.length === 0) {
			return unavailable("source_missing");
		}
		const rootMatches = discovery.data.sources.filter(
			(source) => source.rootRef === rootRef,
		);
		if (rootMatches.length === 0) return unavailable("source_missing");
		const available = rootMatches.filter(
			(source) => source.readiness === "available",
		);
		if (available.length === 0) return unavailable("source_unusable");
		const revisionMatches = available.filter(
			(source) =>
				source.sourceRevision.kind === "git" &&
				source.sourceRevision.head === input.expectedHead &&
				source.sourceRevision.dirtyHash === undefined,
		);
		if (revisionMatches.length === 0) return unavailable("revision_mismatch");
		const [selected] = revisionMatches.sort(
			(left, right) =>
				right.generationGeneratedAt.localeCompare(left.generationGeneratedAt) ||
				left.generationId.localeCompare(right.generationId),
		);
		if (!selected) return unavailable("source_missing");

		let manifestJson: unknown;
		try {
			manifestJson = parseMcpJson(
				await mcp.callTool(server.id, "vuln_get_knowledge_source_manifest", {
					scanRunId: selected.scanRunId,
					generationId: selected.generationId,
				}),
			);
		} catch {
			return unavailable("mcp_failed");
		}
		const manifest = projectExplorationManifestSchema.safeParse(manifestJson);
		if (!manifest.success) return unavailable("manifest_invalid");
		const generation = manifest.data.manifest.generation;
		if (
			manifest.data.manifest.project.id !== selected.projectId ||
			manifest.data.manifest.scan.id !== selected.scanRunId ||
			generation.generationId !== selected.generationId ||
			generation.status !== "available"
		) {
			return unavailable("manifest_invalid");
		}
		return {
			version: 1,
			available: true,
			serverId: server.id,
			rootRef,
			projectId: selected.projectId,
			scanRunId: selected.scanRunId,
			generationId: selected.generationId,
			snapshotRef: generation.snapshotRef,
			sourceTreeHash: generation.sourceTreeHash,
			sourceStateHash: generation.sourceStateHash,
			sourceRevisionHead: input.expectedHead,
			toolName: "vuln_get_project_exploration_catalog",
		};
	} catch {
		return unavailable("mcp_failed");
	}
}

function parseMcpJson(value: unknown): unknown {
	if (!value || typeof value !== "object" || !("content" in value)) {
		throw new Error("MCP response content is missing.");
	}
	const content = (value as { content?: unknown }).content;
	if (!Array.isArray(content))
		throw new Error("MCP response content is invalid.");
	const text = content
		.filter(
			(block): block is { type: "text"; text: string } =>
				!!block &&
				typeof block === "object" &&
				(block as { type?: unknown }).type === "text" &&
				typeof (block as { text?: unknown }).text === "string",
		)
		.map((block) => block.text)
		.join("\n");
	if (!text) throw new Error("MCP response text is missing.");
	return JSON.parse(text);
}

function unavailable(
	reason: Extract<
		ProjectExplorationCatalogRunPin,
		{ available: false }
	>["reason"],
): ProjectExplorationCatalogRunPin {
	return { version: 1, available: false, reason };
}
