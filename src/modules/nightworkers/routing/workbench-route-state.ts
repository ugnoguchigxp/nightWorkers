import type { ProjectQueueViewMode } from "../../queue/projectQueueTypes";
import type { SettingsSectionId } from "../../settings/SettingsForms";
import type { PlanWorkspaceTab } from "../../specification";
import type { ProjectDetailTab } from "../components/project-detail/types";

export type OverviewRange = "24h" | "7d" | "30d" | "all";
export type ProjectArtifactMode = "tree" | "diff";

export type WorkbenchArtifactRouteState =
	| { kind: "todo" }
	| { kind: "project_tree"; mode: ProjectArtifactMode; filePath: string | null }
	| { kind: "plan_mode_workspace"; tab: PlanWorkspaceTab }
	| { kind: "test_mode" }
	| { kind: "review_status" }
	| { kind: "artifact_ref"; artifactId: string };

export type WorkbenchRouteState =
	| { kind: "overview"; range: OverviewRange; projectId: string | null }
	| { kind: "settings"; section: SettingsSectionId }
	| { kind: "global_queue"; projectId: string | null }
	| { kind: "project_queue"; projectId: string; view: ProjectQueueViewMode }
	| { kind: "project_detail"; projectId: string; tab: ProjectDetailTab }
	| {
			kind: "session";
			sessionId: string;
			artifact: WorkbenchArtifactRouteState | null;
	  };

const overviewRanges = ["24h", "7d", "30d", "all"] as const;
const settingsSections = [
	"general",
	"plan-mode",
	"appearance",
	"llm-providers",
	"llm-routing",
	"test",
	"hooks",
	"mcp",
] as const;
const projectDetailTabs = [
	"overview",
	"mission",
	"evaluation",
	"quality",
	"stack",
] as const;
const projectQueueViewModes = ["board", "table"] as const;
const planWorkspaceTabs = [
	"feature-plan",
	"blueprint",
	"data-model",
	"user-flow",
	"api-io-contract",
	"activity-flow",
	"sequence-flow",
	"zod-schema-design",
	"questionnaire",
	"status",
] as const;

function includes<T extends readonly string[]>(
	values: T,
	value: unknown,
): value is T[number] {
	return typeof value === "string" && values.includes(value);
}

function stringOrNull(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}

export function normalizeOverviewRange(value: unknown): OverviewRange {
	return includes(overviewRanges, value) ? value : "30d";
}

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
	return includes(settingsSections, value) ? value : "general";
}

export function normalizeProjectDetailTab(value: unknown): ProjectDetailTab {
	return includes(projectDetailTabs, value) ? value : "overview";
}

export function normalizeProjectQueueViewMode(
	value: unknown,
): ProjectQueueViewMode {
	return includes(projectQueueViewModes, value) ? value : "board";
}

export function normalizePlanWorkspaceTab(value: unknown): PlanWorkspaceTab {
	return includes(planWorkspaceTabs, value) ? value : "status";
}

export function normalizeRelativeProjectPath(value: unknown): string | null {
	const path = stringOrNull(value);
	if (!path) return null;
	if (path.startsWith("/") || path.startsWith("\\")) return null;
	if (/^[A-Za-z]:[\\/]/.test(path)) return null;
	const parts = path.split(/[\\/]+/);
	if (parts.some((part) => part === "..")) return null;
	return path;
}

export function buildOverviewRoute(
	range: OverviewRange = "30d",
	projectId: string | null = null,
): WorkbenchRouteState {
	return { kind: "overview", range, projectId };
}

export function serializeWorkbenchRoute(state: WorkbenchRouteState): string {
	const params = new URLSearchParams();
	switch (state.kind) {
		case "overview":
			if (state.range !== "30d") params.set("range", state.range);
			if (state.projectId) params.set("projectId", state.projectId);
			return withSearch("/overview", params);
		case "settings":
			return `/settings/${encodeURIComponent(state.section)}`;
		case "global_queue":
			if (state.projectId) params.set("projectId", state.projectId);
			return withSearch("/queue", params);
		case "project_queue":
			if (state.view !== "board") params.set("view", state.view);
			return withSearch(
				`/projects/${encodeURIComponent(state.projectId)}/queue`,
				params,
			);
		case "project_detail":
			return `/projects/${encodeURIComponent(state.projectId)}/detail/${encodeURIComponent(
				state.tab,
			)}`;
		case "session":
			appendArtifactSearch(params, state.artifact);
			return withSearch(
				`/sessions/${encodeURIComponent(state.sessionId)}`,
				params,
			);
	}
}

export function parseWorkbenchRouteUrl(route: string): {
	pathname: string;
	search: Record<string, string>;
} {
	const parsed = new URL(route, "http://nightworkers.local");
	return {
		pathname: parsed.pathname,
		search: Object.fromEntries(parsed.searchParams.entries()),
	};
}

export function shouldCanonicalizeWorkbenchRoute(
	state: WorkbenchRouteState,
	pathname: string,
) {
	const parts = pathname.split("/").filter(Boolean).map(decodePathPart);
	switch (state.kind) {
		case "overview":
			return false;
		case "settings":
			return pathname === "/settings";
		case "global_queue":
			return false;
		case "project_queue":
			return false;
		case "project_detail":
			return (
				parts.length === 3 &&
				parts[0] === "projects" &&
				parts[1] === state.projectId &&
				parts[2] === "detail"
			);
		case "session":
			return false;
	}
}

function decodePathPart(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function appendArtifactSearch(
	params: URLSearchParams,
	artifact: WorkbenchArtifactRouteState | null,
) {
	if (!artifact) return;
	switch (artifact.kind) {
		case "todo":
			params.set("artifact", "todo");
			return;
		case "project_tree":
			params.set("artifact", "project_tree");
			if (artifact.mode !== "tree") params.set("mode", artifact.mode);
			if (artifact.filePath) params.set("file", artifact.filePath);
			return;
		case "plan_mode_workspace":
			params.set("artifact", "plan_mode_workspace");
			params.set("tab", artifact.tab);
			return;
		case "test_mode":
			params.set("artifact", "test_mode");
			return;
		case "review_status":
			params.set("artifact", "review_status");
			return;
		case "artifact_ref":
			params.set("artifactId", artifact.artifactId);
			return;
	}
}

function withSearch(pathname: string, params: URLSearchParams) {
	const search = params.toString();
	return search ? `${pathname}?${search}` : pathname;
}

export function artifactRouteFromSearch(
	search: Record<string, unknown>,
): WorkbenchArtifactRouteState | null {
	const artifactId = stringOrNull(search.artifactId);
	if (artifactId) return { kind: "artifact_ref", artifactId };
	const artifact = stringOrNull(search.artifact);
	if (!artifact) return null;
	if (artifact === "todo") return { kind: "todo" };
	if (artifact === "project_tree") {
		return {
			kind: "project_tree",
			mode: search.mode === "diff" ? "diff" : "tree",
			filePath: normalizeRelativeProjectPath(search.file),
		};
	}
	if (artifact === "plan_mode_workspace") {
		return {
			kind: "plan_mode_workspace",
			tab: normalizePlanWorkspaceTab(search.tab),
		};
	}
	if (artifact === "test_mode") return { kind: "test_mode" };
	if (artifact === "review_status") return { kind: "review_status" };
	return null;
}

export function isKnownWorkbenchPath(pathname: string) {
	const parts = pathname.split("/").filter(Boolean);
	return (
		pathname === "/overview" ||
		pathname === "/queue" ||
		pathname === "/settings" ||
		(parts.length === 2 &&
			parts[0] === "settings" &&
			includes(settingsSections, parts[1])) ||
		(parts.length === 2 && parts[0] === "sessions" && Boolean(parts[1])) ||
		(parts.length === 3 &&
			parts[0] === "projects" &&
			Boolean(parts[1]) &&
			parts[2] === "queue") ||
		(parts.length === 3 &&
			parts[0] === "projects" &&
			Boolean(parts[1]) &&
			parts[2] === "detail") ||
		(parts.length === 4 &&
			parts[0] === "projects" &&
			Boolean(parts[1]) &&
			parts[2] === "detail" &&
			includes(projectDetailTabs, parts[3]))
	);
}
