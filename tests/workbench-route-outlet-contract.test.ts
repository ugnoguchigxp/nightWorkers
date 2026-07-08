import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

function readRoute(relativePath: string) {
	return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("workbench nested route outlet contract", () => {
	it("lets project detail tab URLs render the child route instead of the default detail route", () => {
		const source = readRoute("src/routes/projects.$projectId.detail.tsx");

		expect(source).toContain("Outlet");
		expect(source).toMatch(
			/location\.pathname !== `\/projects\/\$\{projectId\}\/detail`/,
		);
		expect(source).toContain("return <Outlet />");
	});

	it("lets settings section URLs render the child route instead of the default settings route", () => {
		const source = readRoute("src/routes/settings.tsx");

		expect(source).toContain("Outlet");
		expect(source).toMatch(/location\.pathname !== ['"]\/settings['"]/);
		expect(source).toContain("return <Outlet />");
	});

	it("renders primary sidebar navigation as real URL links", () => {
		const source = readRoute(
			"src/modules/nightworkers/components/ProjectSidebar.tsx",
		);

		expect(source).toMatch(/kind: ['"]overview['"]/);
		expect(source).toMatch(/kind: ['"]project_detail['"]/);
		expect(source).toMatch(/kind: ['"]project_queue['"]/);
		expect(source).toMatch(/kind: ['"]session['"]/);
		expect(source).toMatch(/tab: ['"]overview['"]/);
		expect(source).toContain("handleWorkbenchAnchorClick");
		expect(source).not.toContain("handleSidebarAnchorClick");
	});

	it("renders routable workbench controls as real URL links", () => {
		const projectDetailSource = readRoute(
			"src/modules/nightworkers/components/ProjectDetailScreen.tsx",
		);
		const overviewSource = readRoute(
			"src/modules/nightworkers/components/OverviewScreen.tsx",
		);
		const settingsSource = readRoute("src/modules/settings/SettingsScreen.tsx");
		const projectQueueSource = readRoute(
			"src/modules/queue/ProjectQueueScreen.tsx",
		);

		expect(projectDetailSource).toMatch(/kind: ['"]project_detail['"]/);
		expect(projectDetailSource).toContain("handleWorkbenchAnchorClick");
		expect(overviewSource).toMatch(/kind: ['"]overview['"]/);
		expect(overviewSource).toMatch(/kind: ['"]session['"]/);
		expect(settingsSource).toMatch(/kind: ['"]settings['"]/);
		expect(settingsSource).toMatch(/kind: ['"]overview['"]/);
		expect(projectQueueSource).toMatch(/kind: ['"]project_queue['"]/);
		expect(projectQueueSource).toContain('data-view-toggle="project-queue"');
	});
});
