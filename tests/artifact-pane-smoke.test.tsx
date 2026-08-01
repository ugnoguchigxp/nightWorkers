import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { EvidenceCheckArtifactViewer } from "../src/modules/codingAgent";
import { ArtifactPane } from "../src/modules/nightworkers/components/ArtifactPane";
import { buildTaskMessage } from "./helpers/nightworkers-fixtures";

describe("ArtifactPane", () => {
	it("shows whether the adopted implementation plan matches the Run Todos", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<EvidenceCheckArtifactViewer
					model={{
						taskId: "11111111-1111-4111-8111-111111111111",
						specArtifactId: "feature-plan-message-1",
						specMessageId: "22222222-2222-4222-8222-222222222222",
						verificationDocumentId: "33333333-3333-4333-8333-333333333333",
						verificationSidecarMessageId:
							"44444444-4444-4444-8444-444444444444",
						conditions: [],
					}}
					snapshot={{
						taskId: "11111111-1111-4111-8111-111111111111",
						verificationDocumentId: "33333333-3333-4333-8333-333333333333",
						specMessageId: "22222222-2222-4222-8222-222222222222",
						specArtifactId: "feature-plan-message-1",
						generatedAt: "2026-07-31T00:00:00.000Z",
						evaluatedAt: "2026-07-31T00:01:00.000Z",
						sourceStateHash: null,
						implementationPlanTraceability: {
							sourceMessageId: "22222222-2222-4222-8222-222222222222",
							digest: `sha256:${"a".repeat(64)}`,
							runId: "55555555-5555-4555-8555-555555555555",
							runStatus: "needs_review",
							provenanceStatus: "matched",
							exactTodoMatch: true,
							steps: [
								{
									seq: 1,
									title: "APIを実装する",
									systemContext: "確定済みAPI契約に従う。",
									todoId: "66666666-6666-4666-8666-666666666666",
									todoStatus: "passed",
									aligned: true,
									evidenceIds: [],
									completionGateRecorded: false,
								},
							],
							summary: {
								total: 1,
								passed: 1,
								incomplete: 0,
								unaligned: 0,
								extraTodos: 0,
								evidenceLinked: 0,
							},
						},
						conditions: [],
						summary: { total: 0, confirmed: 0, failed: 0, pending: 0 },
						assuranceSummary: {
							automated: 0,
							safePass: 0,
							failed: 0,
							attention: 0,
							fullVerifyStatus: "unknown",
						},
					}}
				/>
			</QueryClientProvider>,
		);

		expect(markup).toContain("data-evidence-plan-traceability");
		expect(markup).toContain('data-plan-aligned="true"');
		expect(markup).toContain("実装計画トレーサビリティ");
		expect(markup).toContain("APIを実装する");
		expect(markup).toContain(
			"確定済み実装計画と Run Todo は完全一致しています。",
		);
	});

	it("renders files outline tree when project tree focus is selected", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
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
				/>
			</QueryClientProvider>,
		);

		expect(markup).toContain("プロジェクトツリー");
		expect(markup).not.toContain("todolist");
		expect(markup).toContain("main.tsx");
	});

	it("renders artifact focus with only the artifact title in the shared header", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
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
				/>
			</QueryClientProvider>,
		);

		expect(markup).not.toContain("todolist");
		expect(markup).not.toContain("Plan Mode Workspace");
		expect(markup.match(/Plan モードワークスペース/g)).toHaveLength(1);
		expect(markup).toContain("text-cyan-200");
		expect(markup).toContain('aria-label="アーティファクトをダウンロード"');
		expect(markup).not.toContain('aria-label="表示中の版をコピー"');
		expect(markup).not.toContain('aria-label="表示中の版を保存"');
	});

	it("renders only Spec completion conditions in Evidence Check", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
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
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
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
						kind: "evidence_check",
						title: "証跡チェック",
						source: {
							type: "verification_document",
							verificationDocumentId: "55555555-5555-4555-8555-555555555555",
						},
						createdAt: "2026-07-08T00:00:00Z",
						metadata: {
							specMessageId: "feature-plan-message",
							verificationDocumentId: "55555555-5555-4555-8555-555555555555",
							verificationSidecarMessageId: "verification-message",
							specArtifactId: "feature-plan-feature-plan-message",
						},
					}}
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
				/>
			</QueryClientProvider>,
		);
		expect(markup).toContain("証跡チェック");
		expect(markup).toContain("AC-005");
		expect(markup).toContain("未確認");
		expect(markup).not.toContain("ユニットテスト実行");
		expect(markup).not.toContain("ワークフロー");
	});
});
