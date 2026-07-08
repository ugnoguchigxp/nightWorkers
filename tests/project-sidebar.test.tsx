import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "../src/i18n/setup";
import { ProjectSidebar } from "../src/modules/nightworkers/components/ProjectSidebar";
import type {
	Repository,
	WorkbenchSessionView,
} from "../src/modules/nightworkers/types";

function repository(): Repository {
	const now = "2026-07-08T00:00:00.000Z";
	return {
		id: "11111111-1111-4111-8111-111111111111",
		name: "NightWorkers",
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
		allowed: true,
		queueEnabled: true,
		maxConcurrentSessions: 1,
		createdAt: now,
		updatedAt: now,
	};
}

function sessionView(
	id: string,
	title: string,
	group: WorkbenchSessionView["group"],
): WorkbenchSessionView {
	const now = "2026-07-08T00:00:00.000Z";
	return {
		task: {
			id,
			repositoryId: "11111111-1111-4111-8111-111111111111",
			title,
			description: "",
			objective: "",
			acceptanceCriteria: "",
			status: group === "archive" ? "cancelled" : "ready",
			timeoutSeconds: 3600,
			priority: 0,
			createdAt: now,
			updatedAt: now,
		},
		group,
		emailState: group === "archive" ? "failed" : "plan_ready",
		primaryAction: group === "archive" ? "inspect" : "queue",
		phase: group === "archive" ? "Archived" : "Queued",
		progress: {
			percent: 0,
			phase: group === "archive" ? "Archived" : "Queued",
			basis: [],
			blockers: [],
		},
	};
}

describe("ProjectSidebar", () => {
	it("hides archived tasks from the project task list", () => {
		const project = repository();
		const markup = renderToStaticMarkup(
			<ProjectSidebar
				projects={[project]}
				groupedSessions={{
					[project.id]: {
						processing: [
							sessionView(
								"22222222-2222-4222-8222-222222222222",
								"Active implementation",
								"processing",
							),
						],
						queue: [
							sessionView(
								"33333333-3333-4333-8333-333333333333",
								"Ready implementation",
								"queue",
							),
						],
						archive: [
							sessionView(
								"44444444-4444-4444-8444-444444444444",
								"Archived implementation",
								"archive",
							),
						],
					},
				}}
				isProjectsLoading={false}
				activeSessionId={null}
				expandedProjects={{ [project.id]: true }}
				onSelectSession={() => undefined}
				onCreateSession={() => undefined}
				onDeleteProject={() => undefined}
				onToggleProject={() => undefined}
				onOpenProjectQueue={() => undefined}
				activeProjectQueueId={null}
				onOpenProjectDetail={() => undefined}
				activeProjectDetailId={null}
				onOpenOverview={() => undefined}
				isOverviewActive={false}
				onOpenFolderBrowser={() => undefined}
				onRefreshProjects={() => undefined}
				isProjectListRefreshing={false}
			/>,
		);

		expect(markup).toContain("Active implementation");
		expect(markup).toContain("Ready implementation");
		expect(markup).not.toContain("Archived implementation");
	});
});
