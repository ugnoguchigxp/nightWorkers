export const missionPilotActionUnavailableReasons = new Map<string, string>([
	[
		"questionnaire.create",
		"設計入力の要否とQuestionnaire作成はCoding Agentが判断します。",
	],
	[
		"questionnaire.draft.update",
		"Questionnaireへの回答はユーザーが行い、Coding Agentが回答後の設計を継続します。",
	],
	[
		"questionnaire.draft.save",
		"Questionnaireへの回答はユーザーが行い、Coding Agentが回答後の設計を継続します。",
	],
	[
		"questionnaire.submit",
		"Questionnaireの確定はユーザー操作として扱い、Mission Pilotから実行しません。",
	],
	[
		"questionnaire.follow_up.generate",
		"追加の設計入力が必要かはCoding Agentが判断します。",
	],
	[
		"questionnaire.additional.generate",
		"追加の設計入力が必要かはCoding Agentが判断します。",
	],
	[
		"questionnaire.review.generate",
		"Questionnaireの設計判断はCoding Agentとユーザーの領分です。",
	],
	[
		"questionnaire.review.accept",
		"Questionnaire reviewの採用はユーザー操作として扱います。",
	],
	[
		"questionnaire.review.leave_unadopted",
		"Questionnaire reviewの保留はユーザー操作として扱います。",
	],
	[
		"plan.routing.update",
		"必要なPlan Artifactの提案と選択はCoding Agentが行います。",
	],
	[
		"plan.artifact.generate",
		"Plan Artifactの生成対象とsourceはCoding Agentが判断します。",
	],
	[
		"plan.artifact.feature_plan.generate",
		"Feature Planの生成はCoding Agentが行います。",
	],
	[
		"plan.artifact.blueprint.generate",
		"Blueprintの生成要否はCoding Agentが判断します。",
	],
	[
		"plan.artifact.data_model.generate",
		"Data Modelの生成要否はCoding Agentが判断します。",
	],
	[
		"plan.artifact.view.generate",
		"Dedicated Viewの生成要否はCoding Agentが判断します。",
	],
	[
		"plan.artifact.regenerate",
		"Plan Artifactの再生成判断はCoding Agentが行います。",
	],
]);
