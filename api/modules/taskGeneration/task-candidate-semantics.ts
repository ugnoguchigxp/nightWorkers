import type {
	MissionGoal,
	MissionTaskCandidatesResult,
} from "../../../shared/schemas/task-generation.schema";
import { ValidationError } from "../../lib/errors";

export type QualitySetupCandidateLike = {
	title: string;
	summary: string;
	rationale: string;
	taskPrompt: string;
	acceptanceCriteria: string;
	verificationPlan: string;
	importancePercent: number;
	evidence: Array<{ source: string; label: string; value: string }>;
};

export function selectMissionGoalsForGeneration(
	allGoals: MissionGoal[],
	input: { goalIds?: string[]; includeInactiveGoals?: boolean },
) {
	const requestedGoalIds = [...new Set(input.goalIds ?? [])];
	const knownGoalIds = new Set(allGoals.map((goal) => goal.id));
	const unknownGoalIds = requestedGoalIds.filter(
		(goalId) => !knownGoalIds.has(goalId),
	);
	if (unknownGoalIds.length > 0) {
		throw new ValidationError("Mission goal not found", { unknownGoalIds });
	}
	return allGoals.filter((goal) => {
		if (requestedGoalIds.length && !requestedGoalIds.includes(goal.id)) {
			return false;
		}
		return input.includeInactiveGoals || goal.active;
	});
}

export function hasQualitySetupCandidate(
	candidates: QualitySetupCandidateLike[],
) {
	return candidates.some((candidate) => {
		const text = [
			candidate.title,
			candidate.summary,
			candidate.rationale,
			candidate.taskPrompt,
			candidate.acceptanceCriteria,
			candidate.verificationPlan,
			...candidate.evidence.map((item) => `${item.label} ${item.value}`),
		]
			.join("\n")
			.toLowerCase();
		return (
			candidate.importancePercent >= 95 &&
			candidate.evidence.some((item) => item.source === "quality") &&
			hasQualitySetupText(text)
		);
	});
}

export function hasQualitySetupText(text: string) {
	const normalized = text.toLowerCase();
	return (
		normalized.includes("package.json") ||
		normalized.includes("test:coverage") ||
		normalized.includes("test:e2e") ||
		/(^|\W)unit(\W|$)/.test(normalized) ||
		normalized.includes("coverage")
	);
}

function candidateKindPriority(
	candidate: MissionTaskCandidatesResult["candidates"][number],
) {
	switch (candidate.candidateKind) {
		case "feature_entrypoint":
			return 0;
		case "investigation":
			return 1;
		case "feature_followup":
			return 2;
		case "constraint_enablement":
			return 3;
		case "constraint_verification":
			return 4;
	}
}

function mergeUniqueStrings(values: string[]) {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const normalized = value.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

function candidateAsPlanModeQuestion(
	candidate: MissionTaskCandidatesResult["candidates"][number],
) {
	return `「${candidate.title}」は、本体実装方針の中で必要性と範囲を決める。`;
}

export function applyMissionTaskCandidateSemantics(
	candidates: MissionTaskCandidatesResult["candidates"],
	selectedGoals: MissionGoal[],
) {
	const projectWideGoalIds = selectedGoals
		.filter((goal) => goal.interpretation.scope === "project_wide")
		.map((goal) => goal.id);
	const projectWideGoalIdSet = new Set(projectWideGoalIds);
	const featureEntrypoints = candidates.filter(
		(candidate) => candidate.candidateKind === "feature_entrypoint",
	);
	const entrypointGoalIds = new Set(
		featureEntrypoints
			.map((candidate) => candidate.goalId)
			.filter((goalId): goalId is string => Boolean(goalId)),
	);
	const singleEntrypoint =
		featureEntrypoints.length === 1 ? featureEntrypoints[0] : null;
	const deferredByGoal = new Map<string, string[]>();
	const deferredToSingleEntrypoint: string[] = [];
	const deferredProjectWideDetails: string[] = [];
	const selected: MissionTaskCandidatesResult["candidates"] = [];

	for (const candidate of candidates) {
		const goalId = candidate.goalId;
		const isPlanModeDetail =
			candidate.candidateKind === "feature_followup" ||
			candidate.candidateKind === "constraint_verification";
		if (goalId && entrypointGoalIds.has(goalId) && isPlanModeDetail) {
			deferredByGoal.set(goalId, [
				...(deferredByGoal.get(goalId) ?? []),
				candidateAsPlanModeQuestion(candidate),
			]);
			continue;
		}
		if (!goalId && singleEntrypoint && isPlanModeDetail) {
			deferredToSingleEntrypoint.push(candidateAsPlanModeQuestion(candidate));
			continue;
		}
		if (
			goalId &&
			projectWideGoalIdSet.has(goalId) &&
			featureEntrypoints.length > 0 &&
			isPlanModeDetail
		) {
			deferredProjectWideDetails.push(candidateAsPlanModeQuestion(candidate));
			continue;
		}
		selected.push(candidate);
	}

	return selected
		.map((candidate) => {
			if (candidate.candidateKind !== "feature_entrypoint") return candidate;
			return {
				...candidate,
				constraintGoalIds: mergeUniqueStrings([
					...candidate.constraintGoalIds,
					...projectWideGoalIds,
				]),
				planModeOpenQuestions: mergeUniqueStrings([
					...candidate.planModeOpenQuestions,
					...(candidate.goalId
						? (deferredByGoal.get(candidate.goalId) ?? [])
						: []),
					...(candidate === singleEntrypoint ? deferredToSingleEntrypoint : []),
					...deferredProjectWideDetails,
				]),
			};
		})
		.sort((a, b) => {
			const priorityDelta = candidateKindPriority(a) - candidateKindPriority(b);
			if (priorityDelta !== 0) return priorityDelta;
			return b.importancePercent - a.importancePercent;
		});
}

export function normalizeMissionCandidateTitle(title: string) {
	return title
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\s　"'`.,:;!?()[\]{}<>「」『』【】・_-]+/g, "");
}

export function selectUniqueMissionTaskCandidates(
	candidates: MissionTaskCandidatesResult["candidates"],
	blockedTitleKeys: Set<string>,
) {
	const seen = new Set<string>();
	const selected: MissionTaskCandidatesResult["candidates"] = [];
	for (const candidate of candidates) {
		const key = normalizeMissionCandidateTitle(candidate.title);
		if (!key || seen.has(key) || blockedTitleKeys.has(key)) continue;
		seen.add(key);
		selected.push(candidate);
	}
	return selected;
}

export function validateGeneratedGoalIds(
	candidates: MissionTaskCandidatesResult["candidates"],
	allowedGoals: MissionGoal[],
) {
	const allowedGoalIds = new Set(allowedGoals.map((goal) => goal.id));
	for (const candidate of candidates) {
		if (candidate.goalId && !allowedGoalIds.has(candidate.goalId)) {
			throw new ValidationError(
				"Mission task generation returned an unknown goalId",
				{ goalId: candidate.goalId },
			);
		}
		for (const goalId of candidate.constraintGoalIds) {
			if (!allowedGoalIds.has(goalId)) {
				throw new ValidationError(
					"Mission task generation returned an unknown constraintGoalId",
					{ goalId },
				);
			}
		}
	}
}
