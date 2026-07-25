import { describe, expect, it } from "vitest";
import {
	readLastWorkbenchRoute,
	sanitizeStoredWorkbenchRoute,
	writeLastWorkbenchRoute,
} from "../src/modules/nightworkers/routing/last-workbench-route";
import {
	artifactRouteFromSearch,
	normalizeRelativeProjectPath,
	parseWorkbenchRouteUrl,
	serializeWorkbenchRoute,
	shouldCanonicalizeWorkbenchRoute,
} from "../src/modules/nightworkers/routing/workbench-route-state";

class MemoryStorage implements Storage {
	private readonly values = new Map<string, string>();

	get length() {
		return this.values.size;
	}

	clear() {
		this.values.clear();
	}

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	key(index: number) {
		return Array.from(this.values.keys())[index] ?? null;
	}

	removeItem(key: string) {
		this.values.delete(key);
	}

	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
}

describe("workbench route state", () => {
	it("serializes routable workbench screens into direct URLs", () => {
		expect(
			serializeWorkbenchRoute({
				kind: "overview",
				range: "30d",
				projectId: null,
			}),
		).toBe("/overview");
		expect(
			serializeWorkbenchRoute({
				kind: "overview",
				range: "7d",
				projectId: "project-1",
			}),
		).toBe("/overview?range=7d&projectId=project-1");
		expect(
			serializeWorkbenchRoute({ kind: "settings", section: "plan-mode" }),
		).toBe("/settings/plan-mode");
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
				projectId: "project-1",
				tab: "mission",
			}),
		).toBe("/projects/project-1/detail/mission");
		expect(
			serializeWorkbenchRoute({
				kind: "session",
				sessionId: "session-1",
				artifact: { kind: "plan_mode_workspace", tab: "data-model" },
			}),
		).toBe("/sessions/session-1?artifact=plan_mode_workspace&tab=data-model");
		expect(
			serializeWorkbenchRoute({
				kind: "session",
				sessionId: "session-1",
				artifact: { kind: "evidence_check" },
			}),
		).toBe("/sessions/session-1?artifact=evidence_check");
	});

	it("normalizes artifact search params and rejects unsafe project file paths", () => {
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
				file: "../secret.env",
			}),
		).toEqual({
			kind: "project_tree",
			mode: "tree",
			filePath: null,
		});
		expect(artifactRouteFromSearch({ artifactId: "artifact-1" })).toEqual({
			kind: "artifact_ref",
			artifactId: "artifact-1",
		});
		expect(artifactRouteFromSearch({ artifact: "evidence_check" })).toEqual({
			kind: "evidence_check",
		});
		expect(normalizeRelativeProjectPath("/tmp/App.tsx")).toBeNull();
		expect(normalizeRelativeProjectPath("C:\\tmp\\App.tsx")).toBeNull();
	});

	it("stores only known same-origin workbench routes for last-screen restore", () => {
		const storage = new MemoryStorage();

		writeLastWorkbenchRoute("/settings?ignored=1", storage);
		expect(readLastWorkbenchRoute(storage)).toBe("/settings?ignored=1");

		writeLastWorkbenchRoute("https://example.com/overview", storage);
		expect(readLastWorkbenchRoute(storage)).toBe("/settings?ignored=1");

		expect(sanitizeStoredWorkbenchRoute("//example.com/overview")).toBeNull();
		expect(sanitizeStoredWorkbenchRoute("/admin")).toBeNull();
		expect(sanitizeStoredWorkbenchRoute("/settings/nope")).toBeNull();
		expect(sanitizeStoredWorkbenchRoute("/projects/project-1")).toBeNull();
		expect(
			sanitizeStoredWorkbenchRoute("/projects/project-1/files"),
		).toBeNull();
		expect(
			sanitizeStoredWorkbenchRoute("/projects/project-1/detail/nope"),
		).toBeNull();
		expect(
			sanitizeStoredWorkbenchRoute("/sessions/session-1?artifact=todo"),
		).toBe("/sessions/session-1?artifact=todo");
		expect(
			sanitizeStoredWorkbenchRoute("/projects/project-1/detail/mission"),
		).toBe("/projects/project-1/detail/mission");
	});

	it("splits serialized URLs into router pathname and search objects", () => {
		expect(
			parseWorkbenchRouteUrl("/overview?range=7d&projectId=project-1"),
		).toEqual({
			pathname: "/overview",
			search: { range: "7d", projectId: "project-1" },
		});
		expect(
			parseWorkbenchRouteUrl(
				"/sessions/session-1?artifact=project_tree&file=src%2FApp.tsx",
			),
		).toEqual({
			pathname: "/sessions/session-1",
			search: { artifact: "project_tree", file: "src/App.tsx" },
		});
	});

	it("does not canonicalize intra-screen navigation while a stale route state is still mounted", () => {
		expect(
			shouldCanonicalizeWorkbenchRoute(
				{ kind: "overview", range: "30d", projectId: null },
				"/sessions/s1",
			),
		).toBe(false);
		expect(
			shouldCanonicalizeWorkbenchRoute(
				{ kind: "project_detail", projectId: "project-1", tab: "overview" },
				"/projects/project-1/detail/mission",
			),
		).toBe(false);
		expect(
			shouldCanonicalizeWorkbenchRoute(
				{ kind: "project_detail", projectId: "project-1", tab: "overview" },
				"/projects/project-1/detail",
			),
		).toBe(true);
		expect(
			shouldCanonicalizeWorkbenchRoute(
				{ kind: "settings", section: "general" },
				"/settings/plan-mode",
			),
		).toBe(false);
		expect(
			shouldCanonicalizeWorkbenchRoute(
				{ kind: "settings", section: "general" },
				"/settings",
			),
		).toBe(true);
		expect(
			shouldCanonicalizeWorkbenchRoute(
				{ kind: "project_detail", projectId: "project-1", tab: "overview" },
				"/projects/project-1/queue",
			),
		).toBe(false);
		expect(
			shouldCanonicalizeWorkbenchRoute(
				{ kind: "project_queue", projectId: "project-1", view: "board" },
				"/projects/project-1/queue",
			),
		).toBe(false);
	});
});
