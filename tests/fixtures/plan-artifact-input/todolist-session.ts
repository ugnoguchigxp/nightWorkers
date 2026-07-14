import type { PlanArtifactCanonicalInput } from "../../../api/modules/specification/plan-artifact-input.types";

export function createTodoListPlanArtifactCanonicalInput(
	overrides: Partial<PlanArtifactCanonicalInput> = {},
): PlanArtifactCanonicalInput {
	const initialPrompt = "Todo一覧に期限と完了状態を追加する";
	return {
		target: "api_io_contract",
		task: {
			id: "00000000-0000-4000-8000-000000000001",
			title: "Todo一覧",
			description: "Todoを一覧表示する機能",
			initialPrompt,
			acceptanceCriteria: "期限と完了状態をAPIで取得できる",
		},
		questionnaire: {
			sessionId: "00000000-0000-4000-8000-000000000002",
			digest: "sha256:questionnaire",
			status: "accepted",
			decisions: Array.from({ length: 10 }, (_, index) => ({
				questionId: `q${index + 1}`,
				question: `Question ${index + 1}`,
				answer: `Answer ${index + 1}`,
				why: `Why ${index + 1}`,
				outputSection: `section-${index + 1}`,
				deferred: false,
			})),
			unresolvedBlocking: [],
		},
		project: {
			repositoryId: "00000000-0000-4000-8000-000000000003",
			name: "empty-todo-repository",
			root: "/tmp/empty-todo-repository",
			materializationState: "empty",
			detectedStack: null,
			packageScripts: [],
		},
		routing: {
			revision: 4,
			includedViews: [
				"feature_plan",
				"blueprint",
				"data_model",
				"api_io_contract",
			],
			omittedViews: [{ view: "zod_schema_design", reason: "外部API変更なし" }],
		},
		sources: [
			{
				kind: "blueprint",
				messageId: "00000000-0000-4000-8000-000000000010",
				digest: "sha256:blueprint",
				routingRevision: 4,
				renderedContent: "Blueprint: Todo list interaction",
			},
			{
				kind: "data_model",
				messageId: "00000000-0000-4000-8000-000000000011",
				digest: "sha256:data-model",
				routingRevision: 4,
				renderedContent: "Data Model: todos(id, due_date, completed)",
			},
			{
				kind: "feature_plan",
				messageId: "00000000-0000-4000-8000-000000000012",
				digest: "sha256:feature-plan",
				routingRevision: 4,
				renderedContent: "Feature Plan: todo list API",
			},
		],
		regenerationRequest: null,
		provenance: {
			missionPilotSessionId: "00000000-0000-4000-8000-000000000004",
			contextRevision: 7,
			contextDigest: "sha256:context",
			routingRevision: 4,
		},
		...overrides,
	};
}
