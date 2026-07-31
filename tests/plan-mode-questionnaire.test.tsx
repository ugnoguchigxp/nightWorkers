import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionnaireForm } from "../src/modules/planMode/PlanModeQuestionnaire";

describe("Plan Mode Questionnaire", () => {
	it("renders the canonical selected answer without legacy draft evidence", () => {
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
			/>,
		);

		expect(markup).toContain('name="missing-thread" checked=""');
		expect(markup).not.toContain("nightworkers-questionnaire-evidence");
		expect(markup).not.toContain("data-answer-evidence");
	});
});
