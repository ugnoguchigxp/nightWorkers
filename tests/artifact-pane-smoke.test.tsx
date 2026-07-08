import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "../src/i18n/setup";
import { ArtifactPane } from "../src/modules/nightworkers/components/ArtifactPane";

describe("ArtifactPane", () => {
	it("renders files outline tree when project tree focus is selected", () => {
		const markup = renderToStaticMarkup(
			<ArtifactPane
				activeProject={{
					id: "repo-1",
					name: "todolist",
					localPath: "/Users/y.noguchi/Code/nightWorkers",
					branch: "main",
					allowed: true,
					queueEnabled: true,
					maxConcurrentSessions: 1,
					createdAt: "2026-07-08T00:00:00Z",
					updatedAt: "2026-07-08T00:00:00Z",
				}}
				activeSessionId="session-1"
				focusType="project_tree"
				selectedArtifact={null}
				taskMessages={[]}
				activityArtifacts={[]}
				fileEntries={[
					{
						path: "src/main.tsx",
						name: "main.tsx",
						type: "file",
						size: 100,
						updatedAt: "2026-07-08T00:00:00Z",
					},
				]}
				fileEntriesByDirectory={{}}
				expandedDirectories={{}}
				loadingDirectories={{}}
				selectedFile={null}
				selectedFilePath={null}
				isFilesLoading={false}
				isFileLoading={false}
				projectDiff={null}
				isDiffLoading={false}
				onToggleDirectory={async () => undefined}
				onOpenFile={() => undefined}
				onRefreshFiles={async () => undefined}
				onRefreshDiff={async () => undefined}
			/>,
		);

		expect(markup).toContain("プロジェクトツリー");
		expect(markup).not.toContain("todolist");
		expect(markup).toContain("main.tsx");
	});

	it("renders artifact focus with only the artifact title in the shared header", () => {
		const markup = renderToStaticMarkup(
			<ArtifactPane
				activeProject={{
					id: "repo-1",
					name: "todolist",
					localPath: "/Users/y.noguchi/Code/todolist",
					branch: "main",
					allowed: true,
					queueEnabled: true,
					maxConcurrentSessions: 1,
					createdAt: "2026-07-08T00:00:00Z",
					updatedAt: "2026-07-08T00:00:00Z",
				}}
				activeSessionId="session-1"
				focusType="artifact"
				selectedArtifact={{
					id: "plan-mode-workspace-session-1",
					taskId: "session-1",
					kind: "plan_mode_workspace",
					title: "Plan Mode Workspace",
					summary: "Workspace summary",
					source: { type: "task_message", messageId: "message-1" },
					createdAt: "2026-07-08T00:00:00Z",
					metadata: { initialTab: "status" },
				}}
				taskMessages={[]}
				activityArtifacts={[]}
				fileEntries={[]}
				fileEntriesByDirectory={{}}
				expandedDirectories={{}}
				loadingDirectories={{}}
				selectedFile={null}
				selectedFilePath={null}
				isFilesLoading={false}
				isFileLoading={false}
				projectDiff={null}
				isDiffLoading={false}
				onToggleDirectory={async () => undefined}
				onOpenFile={() => undefined}
				onRefreshFiles={async () => undefined}
				onRefreshDiff={async () => undefined}
			/>,
		);

		expect(markup).not.toContain("todolist");
		expect(markup).not.toContain("Plan Mode Workspace");
		expect(markup.match(/Plan モードワークスペース/g)).toHaveLength(1);
		expect(markup).toContain("text-cyan-200");
	});
});
