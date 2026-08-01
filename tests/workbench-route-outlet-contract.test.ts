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
		expect(source).toMatch(/kind: ['"]project_queue['"]/);
		expect(source).toMatch(/kind: ['"]session['"]/);
		expect(source).toContain("handleWorkbenchAnchorClick");
		expect(source).not.toContain("handleSidebarAnchorClick");
	});

	it("renders routable workbench controls as real URL links", () => {
		const projectNavigationSource = readRoute(
			"src/modules/overview/components/ProjectScopeNavigation.tsx",
		);
		const overviewSource = [
			"src/modules/overview/OverviewScreen.tsx",
			"src/modules/overview/components/OverviewHeader.tsx",
			"src/modules/overview/components/OverviewTables.tsx",
		]
			.map(readRoute)
			.join("\n");
		const settingsSource = readRoute("src/modules/settings/SettingsScreen.tsx");
		const projectQueueSource = readRoute(
			"src/modules/queue/ProjectQueueScreen.tsx",
		);

		expect(projectNavigationSource).toMatch(/kind: ['"]project_detail['"]/);
		expect(projectNavigationSource).toMatch(/kind: ['"]overview['"]/);
		expect(projectNavigationSource).toContain("handleWorkbenchAnchorClick");
		expect(overviewSource).toMatch(/kind: ['"]overview['"]/);
		expect(overviewSource).toMatch(/kind: ['"]session['"]/);
		expect(settingsSource).toMatch(/kind: ['"]settings['"]/);
		expect(settingsSource).toMatch(/kind: ['"]overview['"]/);
		expect(projectQueueSource).toMatch(/kind: ['"]project_queue['"]/);
		expect(projectQueueSource).toContain('data-view-toggle="project-queue"');
	});

	it("loads workbench screens only when their route becomes active", () => {
		const source = readRoute(
			"src/modules/nightworkers/components/NightWorkersShellLayout.tsx",
		);

		expect(source).toContain("lazy(() =>");
		expect(source).toContain("<Suspense");
		expect(source).toContain('import("@/modules/overview")');
		expect(source).toContain('import("../../queue")');
		expect(source).toContain('import("./ProjectDetailScreen")');
		expect(source).toContain('import("./SettingsScreen")');
		expect(source).toContain('import("./NightWorkersShellThreadPanel")');
	});

	it("omits redundant headers from project detail tab surfaces", () => {
		const projectNavigationSource = readRoute(
			"src/modules/overview/components/ProjectScopeNavigation.tsx",
		);
		const taskGenerationSource = readRoute(
			"src/modules/taskGeneration/components/TaskGenerationTreeTable.tsx",
		);
		const evaluationToolbarSource = readRoute(
			"src/modules/project-evaluation/components/ProjectEvaluationToolbar.tsx",
		);
		const qualitySource = readRoute(
			"src/modules/quality/components/QualityReportPanel.tsx",
		);
		const techStackSource = readRoute(
			"src/modules/techStack/components/TechStackPanel.tsx",
		);

		expect(projectNavigationSource).not.toContain("border-b pb-2");
		expect(taskGenerationSource).not.toContain(
			"projectDetail.mission.treeTitle",
		);
		expect(evaluationToolbarSource).not.toContain("project.name");
		expect(evaluationToolbarSource).not.toContain("project.localPath");
		expect(evaluationToolbarSource).not.toContain("border-b");
		expect(qualitySource).not.toContain("projectDetail.quality.title");
		expect(techStackSource).not.toContain("techStack.profile.description");
	});
});
