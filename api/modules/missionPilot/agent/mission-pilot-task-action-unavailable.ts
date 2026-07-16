/**
 * Actions unavailable to Mission Pilot for structural reasons only.
 *
 * Questionnaire submission remains a user-facing operation. Questionnaire
 * creation, review, routing, and Artifact mutations belong to Mission Pilot.
 */
export const missionPilotActionUnavailableReasons = new Map<string, string>([
	[
		"questionnaire.submit",
		"Questionnaireの確定はユーザー操作として扱い、Mission Pilotから実行しません。",
	],
]);
