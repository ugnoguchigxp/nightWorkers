import { describe, expect, it } from "vitest";
import {
	artifactRouteFromSearch,
	buildOverviewRoute,
	isKnownWorkbenchPath,
	normalizeOverviewRange,
	normalizePlanWorkspaceTab,
	normalizeProjectDetailTab,
	normalizeProjectQueueViewMode,
	normalizeRelativeProjectPath,
	normalizeSettingsSection,
	parseWorkbenchRouteUrl,
	serializeWorkbenchRoute,
	shouldCanonicalizeWorkbenchRoute,
} from "../src/modules/nightworkers/routing/workbench-route-state";

describe("workbench-route-state extra coverage", () => {
	it("normalizes every route enum and falls back for invalid non-string values", () => {
		for (const value of ["24h", "7d", "30d", "all"] as const) {
			expect(normalizeOverviewRange(value)).toBe(value);
		}
		expect(normalizeOverviewRange("year")).toBe("30d");
		expect(normalizeOverviewRange(null)).toBe("30d");

		for (const value of [
			"general",
			"plan-mode",
			"appearance",
			"llm-providers",
			"llm-routing",
			"security-intelligence",
			"hooks",
			"mcp",
		] as const) {
			expect(normalizeSettingsSection(value)).toBe(value);
		}
		expect(normalizeSettingsSection("unknown")).toBe("general");
		expect(normalizeSettingsSection(1)).toBe("general");

		for (const value of [
			"overview",
			"mission",
			"evaluation",
			"quality",
			"security",
			"stack",
			"worktrees",
		] as const) {
			expect(normalizeProjectDetailTab(value)).toBe(value);
		}
		expect(normalizeProjectDetailTab("files")).toBe("overview");

		expect(normalizeProjectQueueViewMode("board")).toBe("board");
		expect(normalizeProjectQueueViewMode("table")).toBe("table");
		expect(normalizeProjectQueueViewMode(false)).toBe("board");

		for (const value of [
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
		] as const) {
			expect(normalizePlanWorkspaceTab(value)).toBe(value);
		}
		expect(normalizePlanWorkspaceTab("unknown-tab")).toBe("status");
	});

	it("accepts relative project files and rejects every absolute or traversal form", () => {
		for (const value of [undefined, null, 1, "", "   "]) {
			expect(normalizeRelativeProjectPath(value)).toBeNull();
		}
		for (const value of [
			"/etc/passwd",
			"\\server\\share",
			"C:\\project\\file.ts",
			"D:/project/file.ts",
			"../secret",
			"src/../secret",
			"src\\..\\secret",
		]) {
			expect(normalizeRelativeProjectPath(value)).toBeNull();
		}
		expect(normalizeRelativeProjectPath("src/App.tsx")).toBe("src/App.tsx");
		expect(normalizeRelativeProjectPath("src\\App.tsx")).toBe("src\\App.tsx");
		expect(normalizeRelativeProjectPath("src/.../file.ts")).toBe(
			"src/.../file.ts",
		);
	});

	it("builds defaults and serializes every top-level route with optional queries", () => {
		expect(buildOverviewRoute()).toEqual({
			kind: "overview",
			range: "30d",
			projectId: null,
		});
		expect(buildOverviewRoute("24h", "project-1")).toEqual({
			kind: "overview",
			range: "24h",
			projectId: "project-1",
		});
		expect(
			serializeWorkbenchRoute({
				kind: "overview",
				range: "30d",
				projectId: "project / one",
			}),
		).toBe("/overview?projectId=project+%2F+one");
		expect(
			serializeWorkbenchRoute({
				kind: "overview",
				range: "all",
				projectId: null,
			}),
		).toBe("/overview?range=all");
		expect(
			serializeWorkbenchRoute({ kind: "settings", section: "llm-routing" }),
		).toBe("/settings/llm-routing");
		expect(
			serializeWorkbenchRoute({ kind: "global_queue", projectId: null }),
		).toBe("/queue");
		expect(
			serializeWorkbenchRoute({
				kind: "global_queue",
				projectId: "project-1",
			}),
		).toBe("/queue?projectId=project-1");
		expect(
			serializeWorkbenchRoute({
				kind: "project_queue",
				projectId: "project / one",
				view: "board",
			}),
		).toBe("/projects/project%20%2F%20one/queue");
		expect(
			serializeWorkbenchRoute({
				kind: "project_queue",
				projectId: "project-1",
				view: "table",
			}),
		).toBe("/projects/project-1/queue?view=table");
		expect(
			serializeWorkbenchRoute({
				kind: "project_detail",
				projectId: "project / one",
				tab: "quality",
			}),
		).toBe("/projects/project%20%2F%20one/detail/quality");
	});

	it("serializes every session artifact and optional project tree field", () => {
		const route = (artifact: Record<string, unknown> | null) =>
			serializeWorkbenchRoute({
				kind: "session",
				sessionId: "session / one",
				artifact: artifact as never,
			});
		expect(route(null)).toBe("/sessions/session%20%2F%20one");
		expect(route({ kind: "todo" })).toContain("artifact=todo");
		expect(route({ kind: "project_tree", mode: "tree", filePath: null })).toBe(
			"/sessions/session%20%2F%20one?artifact=project_tree",
		);
		expect(
			route({ kind: "project_tree", mode: "diff", filePath: "src/App.tsx" }),
		).toContain("artifact=project_tree&mode=diff&file=src%2FApp.tsx");
		expect(route({ kind: "plan_mode_workspace", tab: "status" })).toContain(
			"artifact=plan_mode_workspace&tab=status",
		);
		expect(route({ kind: "evidence_check" })).toContain(
			"artifact=evidence_check",
		);
		expect(route({ kind: "review_status" })).toContain(
			"artifact=review_status",
		);
		expect(route({ kind: "artifact_ref", artifactId: "artifact / one" })).toBe(
			"/sessions/session%20%2F%20one?artifactId=artifact+%2F+one",
		);
	});

	it("parses URLs and normalizes every artifact search state", () => {
		expect(
			parseWorkbenchRouteUrl(
				"https://example.test/overview?range=7d&range=all&projectId=p#hash",
			),
		).toEqual({
			pathname: "/overview",
			search: { range: "all", projectId: "p" },
		});
		expect(artifactRouteFromSearch({})).toBeNull();
		expect(artifactRouteFromSearch({ artifact: 1 })).toBeNull();
		expect(
			artifactRouteFromSearch({
				artifactId: " artifact-1 ",
				artifact: "todo",
			}),
		).toEqual({ kind: "artifact_ref", artifactId: " artifact-1 " });
		expect(
			artifactRouteFromSearch({ artifactId: " ", artifact: "todo" }),
		).toEqual({ kind: "todo" });
		expect(
			artifactRouteFromSearch({
				artifact: "project_tree",
				mode: "diff",
				file: "src/App.tsx",
			}),
		).toEqual({ kind: "project_tree", mode: "diff", filePath: "src/App.tsx" });
		expect(
			artifactRouteFromSearch({
				artifact: "project_tree",
				mode: "invalid",
				file: "/unsafe",
			}),
		).toEqual({ kind: "project_tree", mode: "tree", filePath: null });
		expect(
			artifactRouteFromSearch({
				artifact: "plan_mode_workspace",
				tab: "user-flow",
			}),
		).toEqual({ kind: "plan_mode_workspace", tab: "user-flow" });
		expect(
			artifactRouteFromSearch({
				artifact: "plan_mode_workspace",
				tab: "bad",
			}),
		).toEqual({ kind: "plan_mode_workspace", tab: "status" });
		expect(artifactRouteFromSearch({ artifact: "evidence_check" })).toEqual({
			kind: "evidence_check",
		});
		expect(artifactRouteFromSearch({ artifact: "review_status" })).toEqual({
			kind: "review_status",
		});
		expect(artifactRouteFromSearch({ artifact: "unknown" })).toBeNull();
	});

	it("canonicalizes only legacy overview, settings, and short project-detail paths", () => {
		const overview = {
			kind: "overview",
			range: "30d",
			projectId: "project / one",
		} as const;
		expect(
			shouldCanonicalizeWorkbenchRoute(
				overview,
				"/projects/project%20%2F%20one/detail",
			),
		).toBe(true);
		expect(
			shouldCanonicalizeWorkbenchRoute(
				overview,
				"/projects/project%20%2F%20one/detail/overview",
			),
		).toBe(true);
		for (const pathname of [
			"/projects/project%20%2F%20one/detail/mission",
			"/projects/other/detail",
			"/wrong/project%20%2F%20one/detail",
			"/projects/project%20%2F%20one/queue",
			"/projects/project%20%2F%20one/detail/overview/extra",
		]) {
			expect(shouldCanonicalizeWorkbenchRoute(overview, pathname)).toBe(false);
		}
		expect(
			shouldCanonicalizeWorkbenchRoute(
				{ ...overview, projectId: null },
				"/projects/project-1/detail",
			),
		).toBe(false);
		expect(
			shouldCanonicalizeWorkbenchRoute(overview, "/projects/%E0%A4%A/detail"),
		).toBe(false);

		expect(
			shouldCanonicalizeWorkbenchRoute(
				{ kind: "settings", section: "general" },
				"/settings",
			),
		).toBe(true);
		expect(
			shouldCanonicalizeWorkbenchRoute(
				{ kind: "settings", section: "general" },
				"/settings/general",
			),
		).toBe(false);

		const detail = {
			kind: "project_detail",
			projectId: "project-1",
			tab: "overview",
		} as const;
		expect(
			shouldCanonicalizeWorkbenchRoute(detail, "/projects/project-1/detail"),
		).toBe(true);
		for (const pathname of [
			"/projects/project-1/detail/overview",
			"/projects/other/detail",
			"/projects/project-1/queue",
			"/wrong/project-1/detail",
		]) {
			expect(shouldCanonicalizeWorkbenchRoute(detail, pathname)).toBe(false);
		}

		for (const state of [
			{ kind: "global_queue", projectId: null },
			{ kind: "project_queue", projectId: "project-1", view: "board" },
			{ kind: "session", sessionId: "session-1", artifact: null },
		] as const) {
			expect(shouldCanonicalizeWorkbenchRoute(state, "/anything")).toBe(false);
		}
	});

	it("recognizes every known workbench path and rejects malformed boundaries", () => {
		for (const pathname of ["/overview", "/queue", "/settings"]) {
			expect(isKnownWorkbenchPath(pathname)).toBe(true);
		}
		for (const section of [
			"general",
			"plan-mode",
			"appearance",
			"llm-providers",
			"llm-routing",
			"security-intelligence",
			"hooks",
			"mcp",
		]) {
			expect(isKnownWorkbenchPath(`/settings/${section}`)).toBe(true);
		}
		expect(isKnownWorkbenchPath("/sessions/session-1")).toBe(true);
		expect(isKnownWorkbenchPath("/projects/project-1/queue")).toBe(true);
		expect(isKnownWorkbenchPath("/projects/project-1/detail")).toBe(true);
		for (const tab of [
			"overview",
			"mission",
			"evaluation",
			"quality",
			"security",
			"stack",
			"worktrees",
		]) {
			expect(isKnownWorkbenchPath(`/projects/project-1/detail/${tab}`)).toBe(
				true,
			);
		}

		for (const pathname of [
			"/",
			"/overview/extra",
			"/settings/unknown",
			"/settings/general/extra",
			"/sessions",
			"/sessions/session-1/extra",
			"/projects//queue",
			"/projects/project-1",
			"/projects/project-1/files",
			"/projects/project-1/detail/unknown",
			"/wrong/project-1/queue",
			"/projects/project-1/wrong",
		]) {
			expect(isKnownWorkbenchPath(pathname)).toBe(false);
		}
	});
});
