import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ArtifactPane } from "../src/modules/nightworkers/components/ArtifactPane";
import type {
	Repository,
	WorkbenchArtifactRef,
} from "../src/modules/nightworkers/types";
import { buildTaskMessage } from "./helpers/nightworkers-fixtures";

const project: Repository = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "nightWorkers",
	localPath: "/Users/y.noguchi/Code/nightWorkers",
	branch: "main",
	allowed: true,
	queueEnabled: false,
	maxConcurrentSessions: 1,
	createdAt: "2026-07-08T00:00:00.000Z",
	updatedAt: "2026-07-08T00:00:00.000Z",
};

const testModeArtifact: WorkbenchArtifactRef = {
	id: "test-mode-task-1",
	taskId: "11111111-1111-4111-8111-111111111111",
	kind: "test_mode",
	title: "Test Mode",
	source: { type: "test_mode" },
	createdAt: "2026-07-08T00:00:00.000Z",
};

describe("Test Mode artifact pane", () => {
	it("shows checklist conditions derived from the latest implementation plan", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- API が成功する",
				"- [AC-010] UI が状態を表示する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
			},
		});

		const markup = renderToStaticMarkup(
			<ArtifactPane
				activeProject={project}
				activeSessionId="11111111-1111-4111-8111-111111111111"
				focusType="artifact"
				selectedArtifact={testModeArtifact}
				taskMessages={[implementationPlan]}
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
				onOpenFile={vi.fn()}
				onRefreshFiles={async () => undefined}
				onRefreshDiff={async () => undefined}
			/>,
		);

		expect(markup).toContain("Verification Checklist");
		expect(markup).toContain("Find related tests");
		expect(markup).toContain("Run unit tests");
		expect(markup).toContain("AC-001");
		expect(markup).toContain("API が成功する");
		expect(markup).toContain("AC-010");
		expect(markup).toContain("UI が状態を表示する");
	});

	it("shows Test Mode actions even when the task is archived", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});

		const activeMarkup = renderTestModePane({
			taskMessages: [implementationPlan],
			activeTaskStatus: "running",
		});
		const archivedMarkup = renderTestModePane({
			taskMessages: [implementationPlan],
			activeTaskStatus: "cancelled",
		});

		expect(activeMarkup).toContain("Find related tests");
		expect(activeMarkup).toContain("Run unit tests");
		expect(archivedMarkup).toContain("Verification Checklist");
		expect(archivedMarkup).toContain("Find related tests");
		expect(archivedMarkup).toContain("Run unit tests");
	});
});

function renderTestModePane(input: {
	taskMessages: Parameters<typeof ArtifactPane>[0]["taskMessages"];
	activeTaskStatus?: string | null;
}) {
	return renderToStaticMarkup(
		<ArtifactPane
			activeProject={project}
			activeSessionId="11111111-1111-4111-8111-111111111111"
			focusType="artifact"
			selectedArtifact={testModeArtifact}
			taskMessages={input.taskMessages}
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
			onOpenFile={vi.fn()}
			onRefreshFiles={async () => undefined}
			onRefreshDiff={async () => undefined}
			activeTaskStatus={input.activeTaskStatus}
		/>,
	);
}
