import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionnaireForm } from "../src/modules/planMode/PlanModeQuestionnaire";

describe("Plan Mode Questionnaire", () => {
	it("uses a dedicated high-contrast treatment for AI answer evidence", () => {
		const markup = renderToStaticMarkup(
			<QuestionnaireForm
				questionGroups={[
					{
						id: "routing",
						title: "Routing",
						category: "Design",
						purpose: "Choose the missing-thread behavior.",
						questions: [
							{
								id: "missing-thread",
								topic: "Missing thread",
								question:
									"指定されたスレッドが存在しない場合、どう扱いますか？",
								why: "The route needs a defined fallback.",
								answerType: "single_choice",
								options: [
									{
										id: "show-not-found",
										label: "404相当のエラー画面またはメッセージを表示する",
										tradeoff: "Explicitly communicates the missing resource.",
									},
								],
								blocks: ["Routing decision"],
								outputSection: "routing",
							},
						],
					},
				]}
				answers={{
					"missing-thread": {
						questionId: "missing-thread",
						selectedOptionIds: ["show-not-found"],
						rankedOptionIds: [],
						deferred: false,
					},
				}}
				onChange={() => undefined}
				answerEvidence={{
					"missing-thread": {
						source: "mission_pilot",
						reason:
							"先頭の選択肢を採用しました。選択後に設計判断として整理します。",
						updatedAt: new Date("2026-07-11T00:00:00Z"),
					},
				}}
			/>,
		);

		expect(markup).toContain("nightworkers-questionnaire-evidence");
		expect(markup).toContain("nightworkers-questionnaire-evidence-label");
		expect(markup).toContain('data-answer-evidence="mission_pilot"');
		expect(markup).not.toContain("bg-slate-800/65");
	});
});
