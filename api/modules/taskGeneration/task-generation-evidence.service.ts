import fs from "node:fs/promises";
import path from "node:path";
import type {
	MissionGoal,
	MissionTaskCandidate,
} from "../../../shared/schemas/task-generation.schema";
import { NotFoundError } from "../../lib/errors";
import * as missionPlannerRepo from "../mission-planner/mission-planner.repository";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as repo from "./task-generation.repository";

export type TaskGenerationEvidence = {
	source: "nightworkers_project_detail";
	repositoryId: string;
	missionId: string | null;
	taskCandidateId: string | null;
	selectedGoalIds: string[];
	goals: Array<{
		id: string;
		title: string;
		scope: MissionGoal["interpretation"]["scope"];
		intent: MissionGoal["interpretation"]["intent"];
		confidencePercent: number;
		reason: string | null;
	}>;
	taskCandidate: {
		id: string;
		title: string;
		kind: MissionTaskCandidate["candidateKind"];
		primaryModule: string | null;
		secondaryModules: string[];
		routingConfidencePercent: number;
		routingReason: string | null;
		planModeOpenQuestions: string[];
	} | null;
	projectWideConstraints: Array<{
		goalId: string;
		title: string;
		intent: MissionGoal["interpretation"]["intent"];
		reason: string | null;
	}>;
	acceptanceCriteria: string[];
	verificationHints: string[];
	warnings: string[];
};

export async function buildTaskGenerationEvidence(input: {
	repoPath?: string | null;
	repositoryId?: string | null;
	missionId?: string | null;
	taskCandidateId?: string | null;
	taskId?: string | null;
}): Promise<TaskGenerationEvidence | null> {
	const evidenceWarnings: string[] = [];
	const candidate = await resolveCandidate(input);
	if (input.taskCandidateId && !candidate) {
		evidenceWarnings.push(
			`mission task candidate not found: ${input.taskCandidateId}`,
		);
	}
	if (
		!input.taskCandidateId &&
		input.taskId &&
		!candidate &&
		!input.repositoryId &&
		!input.missionId
	) {
		return null;
	}
	const mission = input.missionId
		? await missionPlannerRepo.getMission(input.missionId)
		: null;
	if (input.missionId && !mission) {
		evidenceWarnings.push(`mission not found: ${input.missionId}`);
	}

	const repositoryId =
		input.repositoryId ||
		candidate?.repositoryId ||
		mission?.repositoryId ||
		(await resolveRepositoryIdByPath(input.repoPath));
	if (!repositoryId) return null;
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	const usableCandidate =
		candidate && candidate.repositoryId === repository.id ? candidate : null;
	if (candidate && !usableCandidate) {
		evidenceWarnings.push(
			`mission task candidate belongs to another repository: ${candidate.id}`,
		);
	}
	const usableMission =
		mission && mission.repositoryId === repository.id ? mission : null;
	if (mission && !usableMission) {
		evidenceWarnings.push(
			`mission belongs to another repository: ${mission.id}`,
		);
	}

	const allGoals = await repo.listMissionGoals(repository.id);
	const selectedGoalIds = collectSelectedGoalIds({
		candidate: usableCandidate,
		missionSourceGoalIds: usableMission?.sourceGoalIds ?? [],
	});
	const selectedGoalSet = new Set(selectedGoalIds);
	const selectedGoals =
		selectedGoalIds.length > 0
			? allGoals.filter((goal) => selectedGoalSet.has(goal.id))
			: allGoals.filter((goal) => goal.active);
	const projectWideConstraints = selectedGoals
		.filter((goal) => goal.interpretation.scope === "project_wide")
		.map((goal) => ({
			goalId: goal.id,
			title: goal.title,
			intent: goal.interpretation.intent,
			reason: goal.interpretation.reason,
		}));

	return {
		source: "nightworkers_project_detail",
		repositoryId: repository.id,
		missionId: usableMission?.id ?? input.missionId ?? null,
		taskCandidateId: usableCandidate?.id ?? input.taskCandidateId ?? null,
		selectedGoalIds,
		goals: selectedGoals.map((goal) => ({
			id: goal.id,
			title: goal.title,
			scope: goal.interpretation.scope,
			intent: goal.interpretation.intent,
			confidencePercent: goal.interpretation.confidencePercent,
			reason: goal.interpretation.reason,
		})),
		taskCandidate: usableCandidate
			? {
					id: usableCandidate.id,
					title: usableCandidate.title,
					kind: usableCandidate.candidateKind,
					primaryModule: usableCandidate.moduleRouting.primaryModule,
					secondaryModules: usableCandidate.moduleRouting.secondaryModules,
					routingConfidencePercent:
						usableCandidate.moduleRouting.confidencePercent,
					routingReason: usableCandidate.moduleRouting.reason,
					planModeOpenQuestions: usableCandidate.planModeOpenQuestions,
				}
			: null,
		projectWideConstraints,
		acceptanceCriteria: usableCandidate
			? [usableCandidate.acceptanceCriteria]
			: [],
		verificationHints: usableCandidate
			? [usableCandidate.verificationPlan]
			: [],
		warnings: buildEvidenceWarnings({
			candidate: usableCandidate,
			selectedGoalIds,
			selectedGoals,
			evidenceWarnings,
		}),
	};
}

async function resolveRepositoryIdByPath(repoPath?: string | null) {
	if (!repoPath?.trim()) return null;
	const resolvedPath = path.resolve(repoPath);
	const targetPath = await fs.realpath(resolvedPath).catch(() => resolvedPath);
	const repositories = await nightworkersRepo.listRepositories();
	return (
		repositories.find(
			(repository) => path.resolve(repository.localPath) === targetPath,
		)?.id ?? null
	);
}

async function resolveCandidate(input: {
	taskCandidateId?: string | null;
	taskId?: string | null;
}) {
	if (input.taskCandidateId)
		return repo.getMissionCandidate(input.taskCandidateId);
	if (input.taskId) return repo.getMissionCandidateByTaskId(input.taskId);
	return null;
}

function collectSelectedGoalIds(input: {
	candidate: MissionTaskCandidate | null;
	missionSourceGoalIds: string[];
}) {
	const candidate = input.candidate;
	return [
		...input.missionSourceGoalIds,
		...(candidate?.goalId ? [candidate.goalId] : []),
		...(candidate?.constraintGoalIds ?? []),
	].filter((goalId, index, all) => all.indexOf(goalId) === index);
}

function buildEvidenceWarnings(input: {
	candidate: MissionTaskCandidate | null;
	selectedGoalIds: string[];
	selectedGoals: MissionGoal[];
	evidenceWarnings: string[];
}) {
	const warnings = [...input.evidenceWarnings];
	const foundGoalIds = new Set(input.selectedGoals.map((goal) => goal.id));
	const missingGoalIds = input.selectedGoalIds.filter(
		(goalId) => !foundGoalIds.has(goalId),
	);
	if (missingGoalIds.length > 0) {
		warnings.push(`missing mission goals: ${missingGoalIds.join(", ")}`);
	}
	if (!input.candidate) return warnings;
	if (!input.candidate.moduleRouting.primaryModule) {
		warnings.push("task candidate has no primary module routing");
	}
	if (input.candidate.moduleRouting.confidencePercent < 50) {
		warnings.push("task candidate module routing confidence is low");
	}
	return warnings;
}
