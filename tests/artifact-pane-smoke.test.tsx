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
					name: "NightWorkers",
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

		expect(markup).toContain("Project tree");
		expect(markup).toContain("main.tsx");
	});
});
