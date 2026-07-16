export const missionPilotActionUnavailableReasons = new Map<string, string>([
	[
		"questionnaire.submit",
		"回答案保存後の20秒のユーザー介入時間と自動確定を経由してください。",
	],
	[
		"plan.artifact.generate",
		"Artifact kindごとの明示actionを使用してください。",
	],
	[
		"plan.artifact.regenerate",
		"対象Artifactのsource revisionを含む再生成contractが必要です。",
	],
]);
