import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
			<QueryClientProvider client={new QueryClient()}>
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
				/>
			</QueryClientProvider>,
		);

		expect(markup).toContain("Active implementation");
		expect(markup).toContain("Ready implementation");
		expect(markup).not.toContain("Archived implementation");
	});

	it("renders Mission Pilot as a sibling control with playing semantics", () => {
		const project = repository();
		const session = sessionView(
			"55555555-5555-4555-8555-555555555555",
			"Mission Pilot task",
			"processing",
		);
		session.task.missionPilot = {
			taskId: session.task.id,
			desiredState: "playing",
			activityState: "running",
			phase: "running",
			authorizationVersion: 2,
			initialPromptState: "sent",
			initialPromptMessageId: null,
			activeRunId: null,
			nextWakeAt: null,
			version: 3,
			lastError: null,
			updatedAt: "2026-07-11T00:00:00.000Z",
		};
		const timestampSession = sessionView(
			"66666666-6666-4666-8666-666666666666",
			"Mission Pilot idle task",
			"processing",
		);
		timestampSession.emailState = "idle";
		timestampSession.task.missionPilot = {
			...session.task.missionPilot,
			taskId: timestampSession.task.id,
			desiredState: "playing",
			activityState: "starting",
			phase: "starting",
		};
		const queryClient = new QueryClient();
		queryClient.setQueryData(
			["missionPilotControl", session.task.id],
			session.task.missionPilot,
		);
		queryClient.setQueryData(
			["missionPilotControl", timestampSession.task.id],
			timestampSession.task.missionPilot,
		);
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<ProjectSidebar
					projects={[project]}
					groupedSessions={{
						[project.id]: {
							processing: [session, timestampSession],
							queue: [],
							archive: [],
						},
					}}
					isProjectsLoading={false}
					activeSessionId={session.task.id}
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
				/>
			</QueryClientProvider>,
		);

		expect(markup).toContain('aria-label="Mission Pilotを一時停止"');
		expect(markup).toContain('aria-label="設計完了、実装開始待ち"');
		expect(markup).toContain(
			"nightworkers-sidebar-subtle shrink-0 text-[11px]",
		);
		expect(markup).toContain('aria-label="Mission Pilotを一時停止"');
		expect(markup).toContain("mission-pilot-starting-spinner");
		expect(markup).toContain("mission-pilot-starting-pause");
		const controlIndex = markup.indexOf('aria-label="Mission Pilotを一時停止"');
		expect(markup.lastIndexOf("</a>", controlIndex)).toBeGreaterThan(
			markup.lastIndexOf("<a", controlIndex),
		);
	});
});
