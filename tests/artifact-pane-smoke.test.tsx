import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { ArtifactPane } from "../src/modules/nightworkers/components/ArtifactPane";
import {
	buildTaskEvent,
	buildTaskMessage,
	buildTaskRun,
} from "./helpers/nightworkers-fixtures";

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

	it("passes live latest run events into the Plan Mode test panel", () => {
		const featurePlan = buildTaskMessage({
			id: "feature-plan-message",
			content:
				"# Feature Plan\n\n## 完了条件\n- [AC-005] `verify` によって build / typecheck / lint / test が通る",
			messageType: "markdown_document",
			metadataJson: {
				intent: "feature_plan",
				title: "Feature Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
				verificationSidecarMessageId: "verification-message",
			},
		});
		const verificationSidecar = buildTaskMessage({
			id: "verification-message",
			messageType: "verification_json",
			metadataJson: {
				intent: "feature_plan_verification",
				verificationDocument: {
					conditions: [
						{
							id: "AC-005",
							text: "`verify` によって build / typecheck / lint / test が通る",
							status: "pending",
							required: true,
						},
					],
				},
			},
		});
		const latestRun = buildTaskRun({
			status: "completed",
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [],
		});
		const latestRunEvents = [
			buildTaskEvent({
				id: "verify-passed",
				payloadJson: {
					runEvent: {
						type: "tool.call_finished",
						data: {
							toolName: "command_execution",
							commandClass: "broad_verification",
							command: "/bin/zsh -lc 'bun run verify'",
							status: "completed",
							exitCode: 0,
							aggregatedOutput: "OK verify complete",
						},
					},
				},
			}),
		];

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
					source: { type: "task_message", messageId: "feature-plan-message" },
					createdAt: "2026-07-08T00:00:00Z",
					metadata: { initialTab: "feature-plan" },
				}}
				latestRun={latestRun}
				latestRunEvents={latestRunEvents}
				taskMessages={[featurePlan, verificationSidecar]}
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
		const unitStepStart = markup.indexOf("ユニットテスト実行");
		const evidenceStepStart = markup.indexOf("証跡テストチェック");

		expect(markup.slice(unitStepStart, evidenceStepStart)).toContain("完了");
		expect(markup).toContain("ゲート確認済み");
	});
});
