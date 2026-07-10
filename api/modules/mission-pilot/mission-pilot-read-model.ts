import { desc, eq } from "drizzle-orm";
import {
	type MissionPilotDetail,
	missionPilotDetailSchema,
} from "../../../shared/schemas/mission-pilot.schema";
import { db } from "../../db/client";
import { implementationQueueEntries, taskRuns } from "../../db/schema";
import { NotFoundError } from "../../lib/errors";
import * as missionPlannerRepo from "../mission-planner/mission-planner.repository";
import * as repo from "./mission-pilot.repository";
import { toMissionPilotTaskCandidate } from "./mission-pilot-task-candidate";

async function executionSummary(taskIds: string[]) {
	const summary = {
		approved: 0,
		queued: 0,
		running: 0,
		awaitingEvaluation: 0,
		satisfied: 0,
		blocked: 0,
		failed: 0,
	};
	for (const taskId of taskIds) {
		const [entry] = await db
			.select()
			.from(implementationQueueEntries)
			.where(eq(implementationQueueEntries.taskId, taskId))
			.orderBy(desc(implementationQueueEntries.createdAt))
			.limit(1);
		if (!entry) continue;
		if (entry.status === "queued" || entry.status === "claimed")
			summary.queued++;
		if (entry.status === "processing") summary.running++;
		if (entry.status === "needs_human") summary.blocked++;
		if (entry.status === "failed" || entry.status === "cancelled")
			summary.failed++;
		if (entry.activeRunId) {
			const [run] = await db
				.select()
				.from(taskRuns)
				.where(eq(taskRuns.id, entry.activeRunId))
				.limit(1);
			if (run?.status === "completed") summary.awaitingEvaluation++;
		}
	}
	return summary;
}

export async function getMissionPilotDetail(
	missionId: string,
): Promise<MissionPilotDetail> {
	const mission = await missionPlannerRepo.getMission(missionId);
	if (!mission) throw new NotFoundError("Mission not found");
	const latestPlanningResult = mission.latestPlanningResultId
		? await missionPlannerRepo.getPlanningResult(mission.latestPlanningResultId)
		: null;
	const proposals =
		await missionPlannerRepo.listTaskProposalsForMission(missionId);
	const objectives = await repo.listObjectives(
		missionId,
		latestPlanningResult?.id,
	);
	const events = await repo.listMissionEvents(missionId);
	const approvals = await repo.listApprovals(missionId);
	const persistedAttentionItems = await repo.listAttentionItems(missionId);
	const missionTasks = await repo.listMissionTasks(missionId);
	const activeAutopilotGrant = await repo.getActiveAutopilotGrant(missionId);
	const latestAutopilotGrant = await repo.getLatestAutopilotGrant(missionId);
	const latestEvaluation = await repo.getLatestMissionEvaluation(missionId);
	const latestPlanRevision = await repo.getLatestPlanRevision(missionId);
	const replanSuggestions = await repo.listReplanSuggestions(missionId);
	const taskCandidates = proposals.map(toMissionPilotTaskCandidate);
	const attentionItems = taskCandidates
		.filter(
			(candidate) =>
				candidate.approvalRequired &&
				candidate.status === "proposed" &&
				!approvals.some(
					(approval) =>
						approval.targetType === "task_candidate" &&
						approval.targetId === candidate.taskCandidateId,
				),
		)
		.map((candidate) => ({
			id: `derived:approval:${candidate.taskCandidateId}`,
			type: "approval_required" as const,
			severity: "blocking" as const,
			title: candidate.title,
			summary: "Queue投入前に人間の承認が必要です。",
			targetId: candidate.taskCandidateId,
			persisted: false as const,
		}));
	const summary = await executionSummary(
		proposals
			.map((proposal) => proposal.taskId)
			.filter((taskId): taskId is string => Boolean(taskId)),
	);
	summary.approved = approvals.filter(
		(approval) => approval.status === "approved",
	).length;
	summary.satisfied = missionTasks.filter(
		(task) => task.status === "satisfied",
	).length;
	summary.blocked = Math.max(
		summary.blocked,
		missionTasks.filter((task) => task.status === "blocked").length,
	);
	summary.failed = Math.max(
		summary.failed,
		missionTasks.filter((task) => task.status === "failed").length,
	);

	return missionPilotDetailSchema.parse({
		mission,
		source: {
			type: mission.source,
			refId: mission.sourceRefId,
			evaluationId: mission.sourceEvaluationId,
			label:
				mission.source === "project_evaluation"
					? "Project Evaluation improvement"
					: null,
		},
		objectives,
		taskCandidates,
		legacyTaskProposals: proposals,
		approvals,
		missionTasks,
		activeAutopilotGrant,
		latestAutopilotGrant,
		latestEvaluation,
		latestPlanRevision,
		replanSuggestions,
		attentionItems: [...persistedAttentionItems, ...attentionItems],
		events,
		executionSummary: summary,
		nextRecommendedAction:
			attentionItems.length > 0
				? {
						type: "review_task_candidates",
						reason: "承認が必要なTaskCandidateがあります。",
						requiresHuman: true,
					}
				: taskCandidates.length === 0
					? {
							type: "decompose_mission",
							reason: "TaskCandidateがまだ生成されていません。",
							requiresHuman: false,
						}
					: {
							type: "observe_execution",
							reason: "現在のMission実行状態を確認してください。",
							requiresHuman: false,
						},
	});
}
