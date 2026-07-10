import { createHash } from "node:crypto";
import type { CreateMissionFromImprovementRequest } from "../../../shared/schemas/mission-pilot.schema";
import { db } from "../../db/client";
import { AppError, NotFoundError } from "../../lib/errors";
import * as missionPlannerRepo from "../mission-planner/mission-planner.repository";
import * as evaluationRepo from "../project-evaluation/project-evaluation.repository";
import * as repo from "./mission-pilot.repository";
import { canonicalizeMissionSnapshot } from "./mission-pilot-approval";

const actionType = "create_mission_from_project_evaluation_improvement";

function requestHash(input: CreateMissionFromImprovementRequest) {
	return createHash("sha256")
		.update(canonicalizeMissionSnapshot(input), "utf8")
		.digest("hex");
}

function defaultGoalText(input: {
	agentPrompt: string;
	expectedOutcome: string;
}) {
	return [input.agentPrompt, "", "期待する成果:", input.expectedOutcome].join(
		"\n",
	);
}

export async function createMissionFromProjectEvaluationImprovement(input: {
	repositoryId: string;
	request: CreateMissionFromImprovementRequest;
}) {
	const evaluation = await evaluationRepo.getProjectEvaluation(
		input.request.evaluationId,
	);
	if (!evaluation) throw new NotFoundError("Project Evaluation not found");
	if (evaluation.repositoryId !== input.repositoryId) {
		throw new AppError(
			422,
			"IMPROVEMENT_REPOSITORY_MISMATCH",
			"Project Evaluation does not belong to this repository",
		);
	}
	const [idea] = await evaluationRepo.getProjectImprovementIdeasByIds(
		evaluation.id,
		[input.request.improvementIdeaId],
	);
	if (!idea?.id) throw new NotFoundError("Project improvement idea not found");
	const hash = requestHash(input.request);
	const existing = await missionPlannerRepo.findMissionBySource({
		repositoryId: input.repositoryId,
		source: "project_evaluation",
		sourceRefId: idea.id,
	});
	const taskLinks = await evaluationRepo.existingTaskLinksForIdeas(
		evaluation.id,
		[idea.id],
	);
	const warnings =
		taskLinks.length > 0
			? ["この改善案からは既に直接Taskが作成されています。"]
			: [];
	if (existing) {
		const action = await repo.getPilotActionByKey({
			missionId: existing.id,
			type: actionType,
			idempotencyKey: input.request.idempotencyKey,
		});
		if (action && action.requestHash !== hash) {
			throw new AppError(
				409,
				"MISSION_COMMAND_IDEMPOTENCY_CONFLICT",
				"Idempotency key was already used with a different request",
			);
		}
		return { mission: existing, created: false, warnings };
	}

	try {
		return await db.transaction(async (tx) => {
			const mission = await missionPlannerRepo.createMission(
				{
					repositoryId: input.repositoryId,
					title: input.request.title ?? idea.title,
					goalText:
						input.request.goalText ??
						defaultGoalText({
							agentPrompt: idea.agentPrompt,
							expectedOutcome: idea.expectedOutcome,
						}),
					nonGoals: input.request.nonGoals ?? [],
					sourceGoalIds: [],
					source: "project_evaluation",
					sourceRefId: idea.id,
					sourceEvaluationId: evaluation.id,
					statusReason: "created_from_project_evaluation_improvement",
				},
				tx,
			);
			const action = await repo.createCompletedPilotAction(
				{
					missionId: mission.id,
					repositoryId: mission.repositoryId,
					targetType: "project_improvement_idea",
					targetId: idea.id,
					type: actionType,
					idempotencyKey: input.request.idempotencyKey,
					requestHash: hash,
					reason: "Project Evaluation improvementからMissionを作成する",
					actor: { type: "human", id: null, displayName: "User" },
					resultRef: { type: "mission", id: mission.id },
				},
				tx,
			);
			await repo.appendMissionEvent(
				{
					missionId: mission.id,
					repositoryId: mission.repositoryId,
					eventType: "mission_created",
					summary: "Project Evaluation improvementからMissionを作成しました。",
					actor: { type: "human", id: null, displayName: "User" },
					payload: {
						evaluationId: evaluation.id,
						improvementIdeaId: idea.id,
					},
					sourceKind: "mission_command",
					sourceId: action.id,
				},
				tx,
			);
			return { mission, created: true, warnings };
		});
	} catch (cause) {
		const concurrent = await missionPlannerRepo.findMissionBySource({
			repositoryId: input.repositoryId,
			source: "project_evaluation",
			sourceRefId: idea.id,
		});
		if (concurrent) {
			const action = await repo.getPilotActionByKey({
				missionId: concurrent.id,
				type: actionType,
				idempotencyKey: input.request.idempotencyKey,
			});
			if (action && action.requestHash !== hash) {
				throw new AppError(
					409,
					"MISSION_COMMAND_IDEMPOTENCY_CONFLICT",
					"Idempotency key was already used with a different request",
				);
			}
			return { mission: concurrent, created: false, warnings };
		}
		throw cause;
	}
}
