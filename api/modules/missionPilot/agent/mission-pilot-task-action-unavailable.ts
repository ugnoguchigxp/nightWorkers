/**
 * Actions unavailable to Mission Pilot for structural reasons only.
 *
 * Questionnaire submission remains a user-facing operation. Questionnaire
 * creation, review, routing, and Artifact mutations belong to Mission Pilot.
 */
export const missionPilotActionUnavailableReasons = new Map<string, string>([
	[
		"questionnaire.submit",
		"Questionnaire submission remains on the existing user intervention and timeout application path.",
	],
]);
