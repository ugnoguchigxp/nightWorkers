import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "../src/i18n/setup";
import type { PlanModeWorkspace } from "../src/modules/nightworkers/types";
import { PlanModeWorkspaceViewer } from "../src/modules/planMode/PlanModeWorkspaceViewer";

function createDummyWorkspace(): PlanModeWorkspace {
	return {
		taskId: "task-1",
		repositoryId: "repo-1",
		generatedAt: "2026-07-08T00:00:00Z",
		featurePlanArtifacts: [
			{
				id: "fp-1",
				kind: "feature_plan",
				title: "Feature Plan Spec",
				sourceMessageId: "msg-1",
				createdAt: "2026-07-08T00:00:00Z",
			},
		],
		blueprintArtifacts: [],
		dataModelArtifacts: [],
		dedicatedViewArtifacts: [],
		questionnaireSessions: [],
		decisionReviews: [],
		implementationReferences: [],
	};
}

describe("PlanModeWorkspaceViewer", () => {
	it("renders Questionnaire generation immediately after Plan Mode starts", () => {
		const queryClient = new QueryClient();
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<PlanModeWorkspaceViewer
					sessionId="task-1"
					initialTab="questionnaire"
					taskMessages={[
						{
							id: "questionnaire-starting",
							taskId: "task-1",
							role: "system",
							content: "Questionnaireを生成しています。",
							messageType: "text",
							metadataJson: {
								intent: "design_questionnaire_starting",
								planModeGate: {
									dedicatedViews: [
										{ view: "questionnaire", decision: "include" },
									],
								},
							},
							createdAt: "2026-07-17T04:04:15.000Z",
						},
					]}
				/>
			</QueryClientProvider>,
		);

		expect(markup).toContain("Design Questionnaireを生成しています");
		expect(markup).not.toContain(">質問を作成</button>");
	});

	it("renders plan mode workspace state and tabs", () => {
		const workspace = createDummyWorkspace();
		workspace.questionnaireSessions = [
			{
				id: "questionnaire-1",
				status: "accepted",
				answeredCount: 1,
				totalQuestionCount: 1,
				unansweredCount: 0,
				blockingUnansweredCount: 0,
				nonBlockingUnansweredCount: 0,
			} as never,
		];
		const queryClient = new QueryClient();
		queryClient.setQueryData(["planModeWorkspace", "task-1"], workspace);
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<PlanModeWorkspaceViewer
					sessionId="task-1"
					taskMessages={[]}
					isImplementationLocked={false}
					onAddToQueue={async () => undefined}
					onQueueSession={async () => undefined}
				/>
			</QueryClientProvider>,
		);

		expect(markup).not.toContain("Plan Mode Workspace");
		expect(markup).toContain("Questionnaire");
	});

	it("renders persisted Mission Pilot completion consistently in Status and tabs", () => {
		const workspace = createDummyWorkspace();
		workspace.blueprintArtifacts = [
			{ id: "blueprint-1", kind: "blueprint", title: "Blueprint" } as never,
		];
		workspace.dataModelArtifacts = [
			{ id: "data-model-1", kind: "data_model", title: "Data Model" } as never,
		];
		workspace.dedicatedViewArtifacts = [
			...workspace.blueprintArtifacts,
			...workspace.dataModelArtifacts,
			{ id: "user-flow-1", kind: "user_flow", title: "User Flow" } as never,
			{
				id: "api-contract-1",
				kind: "api_io_contract",
				title: "API Contract",
			} as never,
		];
		workspace.viewDecisions = [
			{ view: "blueprint", decision: "include" },
			{ view: "data_model", decision: "include" },
			{ view: "user_flow", decision: "include" },
			{ view: "api_io_contract", decision: "include" },
		];
		const queryClient = new QueryClient();
		queryClient.setQueryData(["planModeWorkspace", "task-1"], workspace);
		queryClient.setQueryData(["missionPilotPlanProgress", "task-1"], {
			taskId: "11111111-1111-4111-8111-111111111111",
			sessionId: "22222222-2222-4222-8222-222222222222",
			phase: "attention",
			desiredState: "stopped",
			version: 8,
			contextRevision: 7,
			currentStepKey: null,
			steps: [
				["blueprint", "blueprint", "blueprint", 2],
				["data_model", "data_model", "data_model", 3],
				["view:user_flow", "dedicated_view", "user_flow", 4],
				["view:api_io_contract", "dedicated_view", "api_io_contract", 5],
				["feature_plan", "feature_plan", "feature_plan", 6],
			].map(([key, kind, view, ordinal]) => ({
				key,
				kind,
				view,
				ordinal,
				status: "completed",
				attempt: 1,
				artifactMessageId: null,
				lastError: null,
				startedAt: null,
				finishedAt: null,
			})),
			lastError: "Plan review did not pass within three attempts",
			updatedAt: "2026-07-11T13:48:35.000Z",
		});

		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<PlanModeWorkspaceViewer
					sessionId="task-1"
					taskMessages={[]}
					initialTab="status"
				/>
			</QueryClientProvider>,
		);

		expect(markup).toContain(">Data Model</button>");
		expect(markup).toContain(">User Flow</button>");
		expect(markup).toContain(">API Contract</button>");
		expect(markup).toContain("Data Modelを再生成");
		expect(markup).toContain("User Flowを再生成");
		expect(markup).toContain("API Contractを再生成");
		expect(markup).toContain("Plan review did not pass within three attempts");
	});
});
