import { describe, expect, it, vi } from "vitest";
import { buildInitialPlanModeRoutingEntries } from "../api/modules/agentsShare/plan-mode-routing-policy";
import { DEFAULT_GENERAL_SETTINGS } from "../api/services/settings/general-settings";
import type { DesignQuestionnaireSession } from "../shared/schemas/design-questionnaire.schema";

const callStructuredOutputWithRepair = vi.fn();

vi.mock(
	"../api/services/structured-generation/structured-output-repair.service",
	() => ({ callStructuredOutputWithRepair }),
);

const { selectQuestionnaireArtifacts } = await import(
	"../api/modules/missionPilot/planning/mission-pilot-questionnaire-artifact-selection.service"
);

describe("Mission Pilot Questionnaire artifact selection", () => {
	it("passes rendered Questionnaire answers to the semantic selector", async () => {
		callStructuredOutputWithRepair.mockResolvedValue({
			value: {
				decisions: [
					{
						view: "api_io_contract",
						decision: "include",
						reason:
							"HTTP request/responseの境界を確定回答に沿って定義するため。",
					},
					{
						view: "blueprint",
						decision: "omit",
						reason: "画面構成を変更する回答がなく、Feature Planで十分なため。",
					},
					{
						view: "data_model",
						decision: "omit",
						reason: "データ構造を変更する回答がないため。",
					},
					{
						view: "user_flow",
						decision: "omit",
						reason: "新しいユーザー操作フローを伴わないため。",
					},
					{
						view: "activity_flow",
						decision: "omit",
						reason: "複雑な状態遷移を追加しないため。",
					},
					{
						view: "sequence_flow",
						decision: "omit",
						reason: "複数サービス間の呼び出し順を変更しないため。",
					},
					{
						view: "zod_schema_design",
						decision: "omit",
						reason: "新しい入力検証スキーマを設計しないため。",
					},
				],
			},
		});

		const result = await selectQuestionnaireArtifacts({
			taskId: "task-1",
			sessionId: "session-1",
			task: {
				title: "API task",
				objective: "APIを追加する",
				acceptanceCriteria: "HTTP契約が定義されている",
			},
			questionnaire: {
				id: "questionnaire-1",
				status: "accepted",
				answers: [
					{
						questionId: "api-required",
						answer: {
							questionId: "api-required",
							selectedOptionIds: ["yes"],
							rankedOptionIds: [],
							deferred: false,
						},
					},
				],
				questionSets: [
					{
						sequence: 1,
						questionnaire: {
							questionSets: [
								{
									questions: [
										{
											id: "api-required",
											question: "HTTP APIを公開しますか？",
											why: "外部clientとの境界が必要なため。",
											options: [
												{ id: "yes", label: "公開する" },
												{ id: "no", label: "公開しない" },
											],
										},
									],
								},
							],
						},
					},
				],
			} as unknown as DesignQuestionnaireSession,
			routing: {
				revision: 0,
				entries: buildInitialPlanModeRoutingEntries(
					[],
					DEFAULT_GENERAL_SETTINGS.planMode.capabilities,
				),
			},
			capabilities: DEFAULT_GENERAL_SETTINGS.planMode.capabilities,
		});

		expect(result).toHaveLength(7);
		expect(result).toContainEqual({
			view: "api_io_contract",
			decision: "include",
			reason: "HTTP request/responseの境界を確定回答に沿って定義するため。",
		});
		expect(result).toContainEqual({
			view: "blueprint",
			decision: "omit",
			reason: "画面構成を変更する回答がなく、Feature Planで十分なため。",
		});
		expect(callStructuredOutputWithRepair).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining(
					"通常は任意Artifactを0〜1件だけincludeし",
				),
				userPrompt: expect.stringContaining("公開する"),
			}),
		);
	});
});
