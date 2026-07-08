import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { ArtifactPane } from "../src/modules/nightworkers/components/ArtifactPane";
import type {
	Repository,
	TaskRun,
	TaskRunTodo,
	WorkbenchArtifactRef,
} from "../src/modules/nightworkers/types";
import {
	buildTaskMessage,
	buildTaskRun,
} from "./helpers/nightworkers-fixtures";

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
				"- API が成功し、長い完了条件の説明も省略されずに一覧内で全文読める",
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

		expect(markup).toContain("検証チェックリスト");
		expect(markup).toContain("テスト実装ワークフロー開始");
		expect(markup).toContain("実装開始");
		expect(markup).toContain("実装完了");
		expect(markup).toContain("証跡テストチェック");
		expect(markup).toContain("ユニットテスト実行");
		expect(markup).toContain("待機中");
		expect(markup).toContain("AC-001");
		expect(markup).toContain(
			"API が成功し、長い完了条件の説明も省略されずに一覧内で全文読める",
		);
		expect(markup).toContain("whitespace-normal break-words");
		expect(markup).not.toContain("truncate text-slate-200");
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

		expect(activeMarkup).toContain("テスト実装ワークフロー開始");
		expect(activeMarkup).toContain("実装開始");
		expect(archivedMarkup).toContain("検証チェックリスト");
		expect(archivedMarkup).toContain("テスト実装ワークフロー開始");
		expect(archivedMarkup).toContain("ユニットテスト実行");
	});

	it("shows workflow progress from the latest Test Mode run", () => {
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
		const latestRun = buildTaskRun({
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			todos: [
				workflowTodo(1, "テスト実装を開始する", "passed"),
				workflowTodo(2, "テスト実装を完了する", "running"),
				workflowTodo(3, "証跡テストチェックを行う", "pending"),
				workflowTodo(4, "ユニットテストを実行する", "pending"),
			],
		});

		const markup = renderTestModePane({
			taskMessages: [implementationPlan],
			latestRun,
		});

		expect(markup).toContain("実装開始");
		expect(markup).toContain("完了");
		expect(markup).toContain("実装完了");
		expect(markup).toContain("実行中");
		expect(markup).toContain("証跡テストチェック");
		expect(markup).toContain("待機中");
	});
});

function renderTestModePane(input: {
	taskMessages: Parameters<typeof ArtifactPane>[0]["taskMessages"];
	activeTaskStatus?: string | null;
	latestRun?: TaskRun;
}) {
	return renderToStaticMarkup(
		<ArtifactPane
			activeProject={project}
			activeSessionId="11111111-1111-4111-8111-111111111111"
			focusType="artifact"
			selectedArtifact={testModeArtifact}
			latestRun={input.latestRun}
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

function workflowTodo(
	seq: number,
	title: string,
	status: TaskRunTodo["status"],
): TaskRunTodo {
	const now = "2026-07-08T00:00:00.000Z";
	return {
		id: `todo-${seq}`,
		runId: "33333333-3333-4333-8333-333333333333",
		seq,
		title,
		description: null,
		taskType: "verification",
		status,
		procedureId: null,
		procedureSnapshot: null,
		contextSnapshot: null,
		completionGateResult: null,
		dependsOn: null,
		statusReason: null,
		startedAt: status === "pending" ? null : now,
		completedAt: status === "passed" ? now : null,
		createdAt: now,
		updatedAt: now,
	};
}
