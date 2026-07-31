import { describe, expect, it, vi } from "vitest";
import { buildInitialPlanModeRoutingEntries } from "../api/modules/agentsShare/plan-mode-routing-policy";
import { DEFAULT_GENERAL_SETTINGS } from "../api/services/settings/general-settings";
import type { DesignQuestionnaireSession } from "../shared/schemas/design-questionnaire.schema";

const callStructuredOutputWithRepair = vi.fn();

vi.mock(
	"../api/services/structured-generation/structured-output-repair.service",
	() => ({ callStructuredOutputWithRepair }),
);

const { selectQuestionnaireArtifactRouting } = await import(
	"../api/modules/questionnaire/questionnaire-artifact-selection.service"
);

describe("Mission Pilot Questionnaire artifact selection", () => {
	it("uses the plan role without Mission Pilot authorization for direct selection", async () => {
		callStructuredOutputWithRepair.mockResolvedValueOnce({
			value: {
				decisions: [
					{
						view: "api_io_contract",
						decision: "include",
						depth: "focused",
						reason: "外部API境界だけをFeature Plan前に確定するため。",
					},
				],
			},
		});

		await selectQuestionnaireArtifactRouting({
			taskId: "task-direct",
			task: {
				title: "API task",
				objective: "APIを追加する",
				acceptanceCriteria: "HTTP契約が定義されている",
			},
			questionnaire: {
				answers: [],
				questionSets: [],
			} as unknown as DesignQuestionnaireSession,
			routing: {
				revision: 0,
				entries: [
					{
						view: "api_io_contract",
						decision: "omit",
						required: false,
						capabilityEnabled: true,
					},
				],
			},
			capabilities: { api_io_contract: true },
		});

		expect(callStructuredOutputWithRepair).toHaveBeenLastCalledWith(
			expect.objectContaining({
				options: expect.objectContaining({
					role: "plan",
					executionPolicy: undefined,
				}),
			}),
		);
	});

	it("passes rendered Questionnaire answers to the shared semantic selector", async () => {
		callStructuredOutputWithRepair.mockResolvedValue({
			value: {
				decisions: [
					{
						view: "api_io_contract",
						decision: "include",
						depth: "standard",
						reason:
							"HTTP request/responseの境界を確定回答に沿って定義するため。",
					},
					{
						view: "blueprint",
						decision: "omit",
						depth: "none",
						reason: "画面構成を変更する回答がなく、Feature Planで十分なため。",
					},
					{
						view: "data_model",
						decision: "omit",
						depth: "none",
						reason: "データ構造を変更する回答がないため。",
					},
					{
						view: "user_flow",
						decision: "omit",
						depth: "none",
						reason: "新しいユーザー操作フローを伴わないため。",
					},
					{
						view: "activity_flow",
						decision: "omit",
						depth: "none",
						reason: "複雑な状態遷移を追加しないため。",
					},
					{
						view: "sequence_flow",
						decision: "omit",
						depth: "none",
						reason: "複数サービス間の呼び出し順を変更しないため。",
					},
					{
						view: "zod_schema_design",
						decision: "omit",
						depth: "none",
						reason: "新しい入力検証スキーマを設計しないため。",
					},
				],
			},
		});

		const result = await selectQuestionnaireArtifactRouting({
			taskId: "task-1",
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
			reason:
				"HTTP request/responseの境界を確定回答に沿って定義するため。（推奨粒度: 標準）",
		});
		expect(result).toContainEqual({
			view: "blueprint",
			decision: "omit",
			reason:
				"画面構成を変更する回答がなく、Feature Planで十分なため。（推奨粒度: 個別設計書なし）",
		});
		expect(callStructuredOutputWithRepair).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("通常は0〜2件"),
				userPrompt: expect.stringContaining("公開する"),
				options: expect.objectContaining({ role: "plan" }),
			}),
		);
	});
});
