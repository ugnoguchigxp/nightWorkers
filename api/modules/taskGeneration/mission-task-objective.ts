import type { MissionTaskCandidate } from "../../../shared/schemas/task-generation.schema";

export function buildMissionCandidateTaskObjective(
	candidate: MissionTaskCandidate,
) {
	const sections = [
		"[Mission Goal]",
		candidate.goalTitle?.trim() || candidate.title,
		"",
		"[Task Candidate]",
		candidate.title,
		candidate.summary,
		candidate.taskPrompt,
	];
	if (candidate.planModeOpenQuestions.length > 0) {
		sections.push(
			"",
			"[Planで確認すること]",
			...candidate.planModeOpenQuestions.map((item) => `- ${item}`),
		);
	}
	sections.push(
		"",
		"[完了条件]",
		candidate.acceptanceCriteria,
		"",
		"[検証]",
		candidate.verificationPlan,
	);
	return sections.join("\n");
}
