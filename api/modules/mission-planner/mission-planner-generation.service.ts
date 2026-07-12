import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import {
	type Mission,
	type MissionDecompositionPlanningResult,
	type MissionTaskProposal,
	missionCandidateGenerationResultSchema,
	missionDecompositionPlanningResultSchema,
} from "../../../shared/schemas/mission-planner.schema";
import { db } from "../../db/client";
import { tasks } from "../../db/schema";
import { NotFoundError, ValidationError } from "../../lib/errors";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as taskGenerationRepo from "../taskGeneration/task-generation.repository";
import { buildProjectSignalSnapshot } from "../taskGeneration/task-generation-signal.service";
import {
	buildMissionCandidatesSystemPrompt,
	buildMissionCandidatesUserPrompt,
	buildMissionPlansSystemPrompt,
	buildMissionPlansUserPrompt,
} from "./mission-planner.prompts";
import * as repo from "./mission-planner.repository";
import { callMissionPlannerJson } from "./mission-planner-evaluation.service";
import { persistReviewPendingProposals } from "./mission-planner-persistence.service";
import { validateMissionPlanningResult } from "./mission-planner-validation";

export { createTasksFromMissionTaskProposals } from "./mission-planner-proposal-materialization.service";

export const missionDraftSchema = z.object({
	schemaVersion: z.literal("nightworkers.mission-draft/v1"),
	mission: z.object({
		title: z.string().min(1),
		goal: z.string().min(1),
		nonGoals: z.array(z.string()).default([]),
	}),
	blockingClarification: z.boolean().default(false),
	clarificationQuestions: z.array(z.string()).default([]),
	riskNotes: z.array(z.string()).default([]),
});

export const missionStructureSchema = z.object({
	schemaVersion: z.literal("nightworkers.mission-structure/v1"),
	objectives: missionDecompositionPlanningResultSchema.shape.objectives,
	workPackages: missionDecompositionPlanningResultSchema.shape.workPackages,
	replanningUnits:
		missionDecompositionPlanningResultSchema.shape.replanningUnits,
});

export const missionTaskProposalsStageSchema = z.object({
	schemaVersion: z.literal("nightworkers.mission-task-proposals/v1"),
	taskProposals: missionDecompositionPlanningResultSchema.shape.taskProposals,
});

export const missionPlansGenerationResultSchema = z.object({
	schemaVersion: z.literal("nightworkers.mission-plans/v1"),
	plans: z
		.array(
			z.object({
				sourceGoalIds: z.array(z.string().uuid()).min(1),
				rationale: z.string().min(1),
				mission: z.object({
					title: z.string().min(1),
					goal: z.string().min(1),
					nonGoals: z.array(z.string()),
				}),
				taskCandidates: z
					.array(
						z.object({
							id: z.string().min(1),
							title: z.string().min(1),
							summary: z.string().min(1),
							initialPrompt: z.string().min(1),
							expectedOutcome: z.string().min(1),
							implementationFocus: z.array(z.string().min(1)).min(1),
							acceptanceCriteria: z.array(z.string().min(1)).min(1),
							verificationGate: z.array(z.string().min(1)).min(1),
							targetFilesOrModules: z.array(z.string().min(1)),
							risk: z.enum(["low", "medium", "high"]),
							approvalRequired: z.boolean(),
							dependsOnCandidateIds: z.array(z.string().min(1)),
						}),
					)
					.min(1)
					.max(10),
			}),
		)
		.min(1)
		.max(8),
});

type GeneratedMissionPlan = z.infer<
	typeof missionPlansGenerationResultSchema
>["plans"][number];

export function planningResultFromGeneratedPlan(
	plan: GeneratedMissionPlan,
): MissionDecompositionPlanningResult {
	const objectiveId = "objective-1";
	const workPackageId = "work-package-1";
	const candidateIds = new Set(
		plan.taskCandidates.map((candidate) => candidate.id),
	);
	for (const candidate of plan.taskCandidates) {
		const unknownDependency = candidate.dependsOnCandidateIds.find(
			(dependencyId) => !candidateIds.has(dependencyId),
		);
		if (unknownDependency) {
			throw new ValidationError(
				"Generated Task Candidate references an unknown dependency",
				{ candidateId: candidate.id, dependencyId: unknownDependency },
			);
		}
	}
	const verificationGate = [
		...new Set(
			plan.taskCandidates.flatMap((candidate) => candidate.verificationGate),
		),
	];
	const completionCriteria = [
		...new Set(
			plan.taskCandidates.flatMap((candidate) => candidate.acceptanceCriteria),
		),
	];
	const workPackageRisk = plan.taskCandidates.some(
		(candidate) => candidate.risk === "high",
	)
		? "high"
		: plan.taskCandidates.some((candidate) => candidate.risk === "medium")
			? "medium"
			: "low";

	return missionDecompositionPlanningResultSchema.parse({
		schemaVersion: "nightworkers.mission-decomposition-result/v1",
		mission: plan.mission,
		objectives: [
			{
				id: objectiveId,
				title: plan.mission.title,
				completionCriteria,
				verificationGate,
			},
		],
		workPackages: [
			{
				id: workPackageId,
				title: plan.mission.title,
				purpose: plan.mission.goal,
				relatedObjectiveIds: [objectiveId],
				suggestedPlanMode: true,
				risk: workPackageRisk,
				approvalRequired: plan.taskCandidates.some(
					(candidate) => candidate.approvalRequired,
				),
				verificationGate,
			},
		],
		taskProposals: plan.taskCandidates.map((candidate, index) => {
			const sequenced = candidate.dependsOnCandidateIds.length > 0;
			const exclusive = candidate.risk === "high" || candidate.approvalRequired;
			return {
				id: candidate.id,
				title: candidate.title,
				summary: candidate.summary,
				purpose: candidate.summary,
				workPackageId,
				dependencies: candidate.dependsOnCandidateIds,
				targetFilesOrModules: candidate.targetFilesOrModules,
				initialPrompt: candidate.initialPrompt,
				expectedOutcome: candidate.expectedOutcome,
				implementationFocus: candidate.implementationFocus,
				acceptanceCriteria: candidate.acceptanceCriteria,
				verificationGate: candidate.verificationGate,
				risk: candidate.risk,
				approvalRequired: candidate.approvalRequired,
				scheduling: {
					executionType: exclusive
						? "exclusive"
						: sequenced
							? "sequence"
							: "normal",
					reason: exclusive
						? "高リスクまたは承認必須のため排他実行する。"
						: sequenced
							? "依存する Task Candidate の完了後に実行する。"
							: "独立して実行できる。",
					sequenceGroupId: sequenced ? `mission-${workPackageId}` : null,
					sequenceOrder: sequenced ? index : null,
					dependsOnTaskIds: candidate.dependsOnCandidateIds,
				},
			};
		}),
		replanningUnits: [],
	});
}

export async function requireRepository(repositoryId: string) {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	return repository;
}

export function defaultMissionTitle(goalText: string) {
	const normalized = goalText.trim().replace(/\s+/g, " ");
	return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

export function normalizeMissionTitle(title: string) {
	return title
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\s　"'`.,:;!?()[\]{}<>「」『』【】・_-]+/g, "");
}

export async function sourceGoalsForMission(mission: Mission) {
	const goals = await taskGenerationRepo.listMissionGoals(mission.repositoryId);
	const selected = mission.sourceGoalIds.length
		? goals.filter((goal) => mission.sourceGoalIds.includes(goal.id))
		: goals.filter((goal) => goal.active);
	return { allGoals: goals, sourceGoals: selected };
}

export async function existingTaskTitles(repositoryId: string) {
	const rows = await db
		.select({ title: tasks.title })
		.from(tasks)
		.where(eq(tasks.repositoryId, repositoryId));
	return rows.map((row) => row.title);
}

export async function createMission(input: {
	repositoryId: string;
	title?: string;
	goalText: string;
	nonGoals?: string[];
	sourceGoalIds?: string[];
	statusReason?: string | null;
}) {
	await requireRepository(input.repositoryId);
	const sourceGoalIds = [...new Set(input.sourceGoalIds ?? [])];
	if (sourceGoalIds.length) {
		const goals = await taskGenerationRepo.listMissionGoals(input.repositoryId);
		const goalIds = new Set(goals.map((goal) => goal.id));
		const missing = sourceGoalIds.filter((id) => !goalIds.has(id));
		if (missing.length)
			throw new ValidationError("Mission source goal not found", { missing });
	}
	return repo.createMission({
		repositoryId: input.repositoryId,
		title: input.title?.trim() || defaultMissionTitle(input.goalText),
		goalText: input.goalText.trim(),
		nonGoals: input.nonGoals ?? [],
		sourceGoalIds,
		statusReason: input.statusReason ?? null,
	});
}

export async function generateMissionCandidatesFromGoals(input: {
	repositoryId: string;
	goalIds?: string[];
	includeInactiveGoals?: boolean;
}) {
	const repository = await requireRepository(input.repositoryId);
	const allGoals = await taskGenerationRepo.listMissionGoals(repository.id);
	const sourceGoals = allGoals.filter((goal) => {
		if (input.goalIds?.length && !input.goalIds.includes(goal.id)) return false;
		return input.includeInactiveGoals || goal.active;
	});
	if (sourceGoals.length === 0) {
		throw new ValidationError("At least one mission goal is required");
	}

	const signal = await buildProjectSignalSnapshot({
		repository,
		goals: sourceGoals,
	});
	const inputBundle = {
		schemaVersion: "nightworkers.mission-candidate-input/v1",
		sourceGoals: sourceGoals.map((goal) => ({
			id: goal.id,
			title: goal.title,
			goalText: goal.goalText,
			active: goal.active,
		})),
		projectSignalSnapshot: signal,
		createdAt: new Date().toISOString(),
	};
	const existingMissions = await repo.listMissions(repository.id);
	const missionCandidatesCall = await (async () => {
		try {
			return await callMissionPlannerJson({
				stage: "mission_candidates",
				systemPrompt: buildMissionCandidatesSystemPrompt(),
				userPrompt: buildMissionCandidatesUserPrompt({
					inputBundle,
					existingMissions: existingMissions.map((mission) => ({
						id: mission.id,
						title: mission.title,
						status: mission.status,
					})),
				}),
				schemaName: "mission_candidates",
				schema: missionCandidateGenerationResultSchema,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ValidationError("Mission candidate generation failed", {
				message,
			});
		}
	})();

	const allowedGoalIds = new Set(sourceGoals.map((goal) => goal.id));
	const blockedTitleKeys = new Set(
		existingMissions.map((mission) => normalizeMissionTitle(mission.title)),
	);
	const seenTitleKeys = new Set<string>();
	const selectedCandidates = missionCandidatesCall.parsed.candidates.filter(
		(candidate) => {
			for (const goalId of candidate.sourceGoalIds) {
				if (!allowedGoalIds.has(goalId)) {
					throw new ValidationError(
						"Mission candidate generation returned an unknown goalId",
						{
							goalId,
						},
					);
				}
			}
			const key = normalizeMissionTitle(candidate.title);
			if (!key || blockedTitleKeys.has(key) || seenTitleKeys.has(key))
				return false;
			seenTitleKeys.add(key);
			return true;
		},
	);

	const missions = [];
	for (const candidate of selectedCandidates) {
		missions.push(
			await repo.createMission({
				repositoryId: repository.id,
				title: candidate.title,
				goalText: candidate.goalText,
				nonGoals: candidate.nonGoals,
				sourceGoalIds: candidate.sourceGoalIds,
				statusReason: candidate.rationale,
			}),
		);
	}
	return { status: "completed" as const, missions };
}

export async function generateMissionPlansFromGoals(input: {
	repositoryId: string;
	goalIds?: string[];
	includeInactiveGoals?: boolean;
}) {
	const repository = await requireRepository(input.repositoryId);
	const allGoals = await taskGenerationRepo.listMissionGoals(repository.id);
	const sourceGoals = allGoals.filter((goal) => {
		if (input.goalIds?.length && !input.goalIds.includes(goal.id)) return false;
		return input.includeInactiveGoals || goal.active;
	});
	if (sourceGoals.length === 0) {
		throw new ValidationError("At least one mission goal is required");
	}

	const signal = await buildProjectSignalSnapshot({
		repository,
		goals: sourceGoals,
	});
	const inputBundle = {
		schemaVersion: "nightworkers.mission-plan-generation-input/v1",
		sourceGoals: sourceGoals.map((goal) => ({
			id: goal.id,
			title: goal.title,
			goalText: goal.goalText,
			active: goal.active,
		})),
		projectSignalSnapshot: signal,
		createdAt: new Date().toISOString(),
	};
	const existingMissions = await repo.listMissions(repository.id);
	const existingMissionsWithCandidateState = await Promise.all(
		existingMissions.map(async (mission) => ({
			mission,
			hasTaskCandidates: await repo.hasOpenTaskProposalsForMission(mission.id),
		})),
	);
	const plansCall = await (async () => {
		try {
			return await callMissionPlannerJson({
				stage: "mission_candidates",
				systemPrompt: buildMissionPlansSystemPrompt(),
				userPrompt: buildMissionPlansUserPrompt({
					inputBundle,
					existingMissions: existingMissionsWithCandidateState.map(
						({ mission, hasTaskCandidates }) => ({
							id: mission.id,
							title: mission.title,
							status: mission.status,
							hasTaskCandidates,
						}),
					),
					existingTaskTitles: await existingTaskTitles(repository.id),
				}),
				schemaName: "mission_plans",
				schema: missionPlansGenerationResultSchema,
				thinkingDepthOverride: "low",
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ValidationError(message);
		}
	})();

	const allowedGoalIds = new Set(sourceGoals.map((goal) => goal.id));
	const reusableMissionsByTitle = new Map(
		existingMissionsWithCandidateState
			.filter(
				({ mission, hasTaskCandidates }) =>
					!hasTaskCandidates &&
					mission.latestPlanningResultId === null &&
					["draft", "needs_clarification", "blocked"].includes(mission.status),
			)
			.map(({ mission }) => [normalizeMissionTitle(mission.title), mission]),
	);
	const blockedTitleKeys = new Set(
		existingMissions
			.map((mission) => normalizeMissionTitle(mission.title))
			.filter((key) => !reusableMissionsByTitle.has(key)),
	);
	const seenTitleKeys = new Set<string>();
	const selectedPlans = plansCall.parsed.plans.filter((plan) => {
		for (const goalId of plan.sourceGoalIds) {
			if (!allowedGoalIds.has(goalId)) {
				throw new ValidationError(
					"Mission plan generation returned an unknown goalId",
					{ goalId },
				);
			}
		}
		const key = normalizeMissionTitle(plan.mission.title);
		if (!key || blockedTitleKeys.has(key) || seenTitleKeys.has(key))
			return false;
		seenTitleKeys.add(key);
		return true;
	});

	const checkedPlans = selectedPlans.map((plan) => {
		const planningResult = planningResultFromGeneratedPlan(plan);
		const deterministicChecks = validateMissionPlanningResult(planningResult);
		if (deterministicChecks.status === "fail") {
			throw new ValidationError(
				"Generated Mission task candidates failed deterministic validation",
				{ checks: deterministicChecks.checks },
			);
		}
		return {
			...plan,
			planningResult,
			deterministicChecks,
			reusableMission:
				reusableMissionsByTitle.get(
					normalizeMissionTitle(plan.mission.title),
				) ?? null,
		};
	});

	const missions: Mission[] = [];
	const proposals: MissionTaskProposal[] = [];
	for (const plan of checkedPlans) {
		await db.transaction(async (tx) => {
			const mission = plan.reusableMission
				? await repo.updateMission(
						plan.reusableMission.id,
						{
							title: plan.mission.title,
							goalText: plan.mission.goal,
							nonGoals: plan.mission.nonGoals,
							sourceGoalIds: plan.sourceGoalIds,
							statusReason: plan.rationale,
						},
						tx,
					)
				: await repo.createMission(
						{
							repositoryId: repository.id,
							title: plan.mission.title,
							goalText: plan.mission.goal,
							nonGoals: plan.mission.nonGoals,
							sourceGoalIds: plan.sourceGoalIds,
							statusReason: plan.rationale,
						},
						tx,
					);
			if (!mission) throw new NotFoundError("Mission not found");
			const run = await repo.createRunningDecompositionRun(
				{
					missionId: mission.id,
					repositoryId: repository.id,
					inputBundle,
				},
				tx,
			);
			const planningResult = await repo.createPlanningResult(
				{
					missionId: mission.id,
					repositoryId: repository.id,
					decompositionRunId: run.id,
					status: "review_pending",
					planningResult: plan.planningResult,
					deterministicChecks: plan.deterministicChecks,
					statusReason: "single_pass_review_ready",
				},
				tx,
			);
			await repo.updateDecompositionRun(
				run.id,
				{
					status: "completed",
					stageOutputs: {
						missionDraft: plan.planningResult.mission,
						structure: {
							objectives: plan.planningResult.objectives,
							workPackages: plan.planningResult.workPackages,
							replanningUnits: plan.planningResult.replanningUnits,
						},
						taskProposals: plan.planningResult.taskProposals,
						evaluation: null,
					},
					selectedModels: [plansCall.selectedModel],
					completedAt: new Date(),
				},
				tx,
			);
			const updatedMission = await repo.updateMission(
				mission.id,
				{
					status: "review_pending",
					latestPlanningResultId: planningResult.id,
					statusReason: "single_pass_review_ready",
				},
				tx,
			);
			if (!updatedMission) throw new NotFoundError("Mission not found");
			const createdProposals = await persistReviewPendingProposals(
				{ mission: updatedMission, planningResult },
				tx,
			);
			missions.push(updatedMission);
			proposals.push(...createdProposals);
		});
	}

	return { status: "completed" as const, missions, proposals };
}
