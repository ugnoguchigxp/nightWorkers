import { createHash } from "node:crypto";
import type {
	MissionPlanRevision,
	MissionReplanSuggestion,
	MissionTaskGraph,
	MissionTaskGraphDiffOperation,
} from "../../../shared/schemas/mission-pilot.schema";
import {
	missionTaskGraphDiffOperationSchema,
	missionTaskGraphSchema,
} from "../../../shared/schemas/mission-pilot.schema";
import type { MissionDecompositionPlanningResult } from "../../../shared/schemas/mission-planner.schema";
import { missionDecompositionPlanningResultSchema } from "../../../shared/schemas/mission-planner.schema";
import { db } from "../../db/client";
import { AppError, NotFoundError } from "../../lib/errors";
import * as missionPlannerRepo from "../mission-planner/mission-planner.repository";
import * as repo from "./mission-pilot.repository";
import { canonicalizeMissionSnapshot } from "./mission-pilot-approval";

function hash(value: unknown) {
	return createHash("sha256")
		.update(canonicalizeMissionSnapshot(value), "utf8")
		.digest("hex");
}

export function buildReplanApprovalSnapshot(
	suggestion: MissionReplanSuggestion,
) {
	const affectedIds = suggestion.taskGraphDiff
		.flatMap((operation) => {
			switch (operation.op) {
				case "add_candidate":
					return [operation.candidate.id];
				case "update_candidate":
				case "defer_candidate":
					return [operation.candidateId];
				case "add_dependency":
				case "remove_dependency":
					return [operation.candidateId, operation.dependsOnCandidateId];
				case "add_objective":
					return [operation.objective.id];
				case "defer_objective":
					return [operation.objectiveId];
			}
			return [];
		})
		.filter((id, index, all) => all.indexOf(id) === index)
		.sort();
	const snapshot = {
		schemaVersion: "nightworkers.mission-replan-approval/v1",
		suggestionId: suggestion.id,
		baseRevisionId: suggestion.baseRevisionId,
		diffHash: suggestion.diffHash,
		affectedIds,
	};
	return { snapshot, hash: hash(snapshot) };
}

async function taskGraphForPlanningResult(planningResultId: string) {
	const planningResult =
		await missionPlannerRepo.getPlanningResult(planningResultId);
	if (!planningResult)
		throw new NotFoundError("Mission planning result not found");
	const proposals =
		await missionPlannerRepo.listTaskProposals(planningResultId);
	return missionTaskGraphSchema.parse({
		schemaVersion: "nightworkers.mission-task-graph/v1",
		planningResultId,
		objectives: planningResult.planningResult.objectives.map((objective) => ({
			id: objective.id,
			title: objective.title,
		})),
		workPackages: planningResult.planningResult.workPackages.map((item) => ({
			id: item.id,
			title: item.title,
			relatedObjectiveIds: item.relatedObjectiveIds,
		})),
		taskCandidates: proposals.map((proposal) => ({
			id: proposal.decompositionTaskId,
			workPackageId: proposal.workPackageId,
			title: proposal.title,
			dependencies: proposal.dependencies,
			status: proposal.status,
		})),
	});
}

export async function ensureCurrentPlanRevision(missionId: string) {
	const mission = await missionPlannerRepo.getMission(missionId);
	if (!mission?.latestPlanningResultId)
		throw new AppError(
			409,
			"MISSION_PLAN_MISSING",
			"Mission has no current planning result",
		);
	const existing = await repo.findPlanRevisionByPlanningResult({
		missionId,
		planningResultId: mission.latestPlanningResultId,
	});
	if (existing) return existing;
	const latest = await repo.getLatestPlanRevision(missionId);
	const taskGraph = await taskGraphForPlanningResult(
		mission.latestPlanningResultId,
	);
	try {
		return await repo.createPlanRevision({
			missionId,
			repositoryId: mission.repositoryId,
			baseRevisionId: latest?.id ?? null,
			planningResultId: mission.latestPlanningResultId,
			revisionNumber: (latest?.revisionNumber ?? 0) + 1,
			summary: latest
				? "Replanned Mission TaskGraph"
				: "Initial Mission TaskGraph",
			taskGraphJson: taskGraph,
			appliedDiffJson: null,
			createdByActorJson: {
				type: "system",
				id: null,
				displayName: "Mission Planner",
			},
		});
	} catch (cause) {
		const concurrent = await repo.findPlanRevisionByPlanningResult({
			missionId,
			planningResultId: mission.latestPlanningResultId,
		});
		if (concurrent) return concurrent;
		throw cause;
	}
}

function cycleExists(graph: MissionTaskGraph) {
	const dependencies = new Map(
		graph.taskCandidates.map((item) => [item.id, item.dependencies]),
	);
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): boolean => {
		if (visiting.has(id)) return true;
		if (visited.has(id)) return false;
		visiting.add(id);
		for (const dependency of dependencies.get(id) ?? [])
			if (visit(dependency)) return true;
		visiting.delete(id);
		visited.add(id);
		return false;
	};
	return [...dependencies.keys()].some(visit);
}

function graphAfterOperations(
	base: MissionTaskGraph,
	operations: MissionTaskGraphDiffOperation[],
) {
	const graph = structuredClone(base);
	for (const operation of operations) {
		switch (operation.op) {
			case "add_candidate":
				graph.taskCandidates.push({
					id: operation.candidate.id,
					workPackageId: operation.candidate.workPackageId,
					title: operation.candidate.title,
					dependencies: operation.candidate.dependencies,
					status: "proposed",
				});
				break;
			case "update_candidate": {
				const candidate = graph.taskCandidates.find(
					(item) => item.id === operation.candidateId,
				);
				if (candidate) {
					if (operation.patch.title) candidate.title = operation.patch.title;
					if (operation.patch.dependencies)
						candidate.dependencies = operation.patch.dependencies;
				}
				break;
			}
			case "defer_candidate": {
				const candidate = graph.taskCandidates.find(
					(item) => item.id === operation.candidateId,
				);
				if (candidate) candidate.status = "dismissed";
				break;
			}
			case "add_dependency": {
				const candidate = graph.taskCandidates.find(
					(item) => item.id === operation.candidateId,
				);
				if (
					candidate &&
					!candidate.dependencies.includes(operation.dependsOnCandidateId)
				)
					candidate.dependencies.push(operation.dependsOnCandidateId);
				break;
			}
			case "remove_dependency": {
				const candidate = graph.taskCandidates.find(
					(item) => item.id === operation.candidateId,
				);
				if (candidate)
					candidate.dependencies = candidate.dependencies.filter(
						(id) => id !== operation.dependsOnCandidateId,
					);
				break;
			}
			case "add_objective":
				graph.objectives.push({
					id: operation.objective.id,
					title: operation.objective.title,
				});
				break;
			case "defer_objective":
				break;
		}
	}
	return graph;
}

export async function validateMissionTaskGraphDiff(input: {
	missionId: string;
	baseRevision: MissionPlanRevision;
	operations: MissionTaskGraphDiffOperation[];
}) {
	const operations = input.operations.map((operation) =>
		missionTaskGraphDiffOperationSchema.parse(operation),
	);
	const candidateIds = new Set(
		input.baseRevision.taskGraph.taskCandidates.map((item) => item.id),
	);
	const workPackageIds = new Set(
		input.baseRevision.taskGraph.workPackages.map((item) => item.id),
	);
	const objectiveIds = new Set(
		input.baseRevision.taskGraph.objectives.map((item) => item.id),
	);
	const proposals = await missionPlannerRepo.listTaskProposals(
		input.baseRevision.planningResultId,
	);
	const proposalById = new Map(proposals.map((item) => [item.id, item]));
	const missionTasks = await repo.listMissionTasks(input.missionId);
	const protectedCandidateIds = new Set(
		missionTasks
			.filter((item) =>
				["queued", "running", "awaiting_evaluation", "satisfied"].includes(
					item.status,
				),
			)
			.map(
				(item) => proposalById.get(item.taskCandidateId)?.decompositionTaskId,
			)
			.filter((id): id is string => Boolean(id)),
	);
	for (const operation of operations) {
		if (operation.op === "add_candidate") {
			if (candidateIds.has(operation.candidate.id))
				throw new AppError(
					422,
					"MISSION_REPLAN_INVALID_DIFF",
					"Candidate ID already exists",
				);
			if (!workPackageIds.has(operation.candidate.workPackageId))
				throw new AppError(
					422,
					"MISSION_REPLAN_SCOPE_EXPANSION",
					"Unknown work package",
				);
			candidateIds.add(operation.candidate.id);
		}
		if ("candidateId" in operation) {
			if (!candidateIds.has(operation.candidateId))
				throw new AppError(
					422,
					"MISSION_REPLAN_INVALID_DIFF",
					"Unknown candidate ID",
				);
			if (protectedCandidateIds.has(operation.candidateId))
				throw new AppError(
					422,
					"MISSION_REPLAN_ACTIVE_TASK_MUTATION",
					"Active or satisfied MissionTask cannot be mutated",
				);
		}
		if (
			"dependsOnCandidateId" in operation &&
			!candidateIds.has(operation.dependsOnCandidateId)
		)
			throw new AppError(
				422,
				"MISSION_REPLAN_INVALID_DIFF",
				"Unknown dependency candidate ID",
			);
		if (operation.op === "add_objective") {
			if (objectiveIds.has(operation.objective.id))
				throw new AppError(
					422,
					"MISSION_REPLAN_INVALID_DIFF",
					"Objective ID already exists",
				);
			objectiveIds.add(operation.objective.id);
		}
		if (
			operation.op === "defer_objective" &&
			!objectiveIds.has(operation.objectiveId)
		)
			throw new AppError(
				422,
				"MISSION_REPLAN_INVALID_DIFF",
				"Unknown Objective ID",
			);
	}
	const next = graphAfterOperations(input.baseRevision.taskGraph, operations);
	if (cycleExists(next))
		throw new AppError(
			422,
			"MISSION_REPLAN_DEPENDENCY_CYCLE",
			"TaskGraph dependency cycle detected",
		);
	return next;
}

function followUpDiff(input: {
	evaluation: NonNullable<
		Awaited<ReturnType<typeof repo.getMissionEvaluation>>
	>;
	missionTask: NonNullable<Awaited<ReturnType<typeof repo.getMissionTask>>>;
	proposal: NonNullable<
		Awaited<ReturnType<typeof missionPlannerRepo.getTaskProposal>>
	>;
}): MissionTaskGraphDiffOperation[] {
	return [
		{
			op: "add_candidate",
			candidate: {
				id: `replan-${input.evaluation.id.slice(0, 12)}`,
				workPackageId: input.proposal.workPackageId,
				title: `${input.proposal.title} の失敗原因を修正する`,
				summary: input.evaluation.summary,
				purpose: "失敗証拠を解消し、同じObjectiveを再検証する",
				dependencies: [],
				targetFilesOrModules: input.proposal.targetFilesOrModules,
				initialPrompt: `MissionEvaluation ${input.evaluation.id} の証拠を確認し、失敗原因を修正してください。`,
				expectedOutcome: input.proposal.expectedOutcome,
				implementationFocus: [
					...input.proposal.implementationFocus,
					"失敗原因の修正",
				],
				acceptanceCriteria: input.proposal.acceptanceCriteria,
				verificationGate: input.proposal.verificationGate,
				risk: input.proposal.risk,
				approvalRequired: true,
				scheduling: input.proposal.scheduling,
			},
		},
	];
}

export async function createMissionReplanSuggestion(input: {
	missionId: string;
	evaluationId?: string;
	idempotencyKey: string;
}) {
	const mission = await missionPlannerRepo.getMission(input.missionId);
	if (!mission) throw new NotFoundError("Mission not found");
	const evaluation = input.evaluationId
		? await repo.getMissionEvaluation(input.evaluationId)
		: await repo.getLatestMissionEvaluation(mission.id);
	if (
		!evaluation ||
		evaluation.missionId !== mission.id ||
		!["failed", "blocked"].includes(evaluation.result)
	)
		throw new AppError(
			409,
			"MISSION_REPLAN_EVALUATION_REQUIRED",
			"A failed or blocked MissionEvaluation is required",
		);
	if (!evaluation.missionTaskId)
		throw new AppError(
			422,
			"MISSION_REPLAN_SCOPE_MISSING",
			"Evaluation has no MissionTask scope",
		);
	const missionTask = await repo.getMissionTask(evaluation.missionTaskId);
	const proposal = missionTask
		? await missionPlannerRepo.getTaskProposal(missionTask.taskCandidateId)
		: null;
	if (!missionTask || !proposal)
		throw new NotFoundError("Replan source task not found");
	const revision = await ensureCurrentPlanRevision(mission.id);
	const operations = followUpDiff({ evaluation, missionTask, proposal });
	await validateMissionTaskGraphDiff({
		missionId: mission.id,
		baseRevision: revision,
		operations,
	});
	const diffHash = hash(operations);
	const existing = await repo.findReplanSuggestionByDiff({
		missionId: mission.id,
		sourceEvaluationId: evaluation.id,
		diffHash,
	});
	if (existing) return { suggestion: existing, revision };
	const requestHash = hash(input);
	const suggestion = await db.transaction(async (tx) => {
		const created = await repo.createReplanSuggestion(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				baseRevisionId: revision.id,
				sourceEvaluationId: evaluation.id,
				status: "awaiting_approval",
				reason: evaluation.summary,
				taskGraphDiffJson: operations,
				diffHash,
				approvalId: null,
			},
			tx,
		);
		await repo.createAttention(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				targetType: "replan_suggestion",
				targetId: created.id,
				type: "replan_approval_required",
				severity: "blocking",
				title: "再計画差分の確認",
				summary: created.reason,
				actionSchema: { actions: ["request_approval", "cancel"] },
				sourceRef: { type: "mission_evaluation", id: evaluation.id },
			},
			tx,
		);
		const action = await repo.createCompletedPilotAction(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				targetType: "replan_suggestion",
				targetId: created.id,
				type: "create_replan_suggestion",
				idempotencyKey: input.idempotencyKey,
				requestHash,
				reason: evaluation.summary,
				actor: { type: "system", id: null, displayName: "Mission Replanner" },
				resultRef: { type: "replan_suggestion", id: created.id },
			},
			tx,
		);
		await repo.appendMissionEvent(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				eventType: "replan_suggested",
				summary: "失敗証拠から再計画差分を作成しました。",
				actor: { type: "system", id: null, displayName: "Mission Replanner" },
				payload: { suggestionId: created.id, diffHash },
				sourceKind: "mission_command",
				sourceId: action.id,
			},
			tx,
		);
		return created;
	});
	return { suggestion, revision };
}

function applyDiffToPlanning(
	base: MissionDecompositionPlanningResult,
	operations: MissionTaskGraphDiffOperation[],
) {
	const next = structuredClone(base);
	for (const operation of operations) {
		switch (operation.op) {
			case "add_candidate":
				next.taskProposals.push(operation.candidate);
				break;
			case "update_candidate": {
				const candidate = next.taskProposals.find(
					(item) => item.id === operation.candidateId,
				);
				if (candidate) Object.assign(candidate, operation.patch);
				break;
			}
			case "defer_candidate":
				next.taskProposals = next.taskProposals.filter(
					(item) => item.id !== operation.candidateId,
				);
				break;
			case "add_dependency": {
				const candidate = next.taskProposals.find(
					(item) => item.id === operation.candidateId,
				);
				if (
					candidate &&
					!candidate.dependencies.includes(operation.dependsOnCandidateId)
				)
					candidate.dependencies.push(operation.dependsOnCandidateId);
				break;
			}
			case "remove_dependency": {
				const candidate = next.taskProposals.find(
					(item) => item.id === operation.candidateId,
				);
				if (candidate)
					candidate.dependencies = candidate.dependencies.filter(
						(id) => id !== operation.dependsOnCandidateId,
					);
				break;
			}
			case "add_objective":
				next.objectives.push(operation.objective);
				break;
			case "defer_objective":
				break;
		}
	}
	return missionDecompositionPlanningResultSchema.parse(next);
}

export async function applyMissionReplan(input: {
	missionId: string;
	suggestionId: string;
	approvalId: string;
	idempotencyKey: string;
}) {
	const requestHash = hash(input);
	const replay = await repo.getPilotActionByKey({
		missionId: input.missionId,
		type: "apply_replan",
		idempotencyKey: input.idempotencyKey,
	});
	if (replay) {
		if (replay.requestHash !== requestHash)
			throw new AppError(
				409,
				"MISSION_COMMAND_IDEMPOTENCY_CONFLICT",
				"Idempotency key conflict",
			);
		const suggestion = await repo.getReplanSuggestion(input.suggestionId);
		const revision = await repo.getLatestPlanRevision(input.missionId);
		if (!suggestion || !revision)
			throw new NotFoundError("Applied replan result not found");
		return {
			suggestion,
			revision,
			planningResult: await missionPlannerRepo.getPlanningResult(
				revision.planningResultId,
			),
		};
	}
	const mission = await missionPlannerRepo.getMission(input.missionId);
	const suggestion = await repo.getReplanSuggestion(input.suggestionId);
	const approval = await repo.getApproval(input.approvalId);
	if (!mission || !suggestion || !approval)
		throw new NotFoundError("Mission replan input not found");
	if (
		suggestion.missionId !== mission.id ||
		approval.targetId !== suggestion.id ||
		approval.approvalType !== "replan" ||
		approval.status !== "approved"
	)
		throw new AppError(
			409,
			"MISSION_REPLAN_APPROVAL_REQUIRED",
			"Approved matching replan approval is required",
		);
	const approvalSnapshot = buildReplanApprovalSnapshot(suggestion);
	if (approval.snapshotHash !== approvalSnapshot.hash)
		throw new AppError(
			409,
			"MISSION_APPROVAL_STALE",
			"Replan approval snapshot is stale",
		);
	const currentRevision = await ensureCurrentPlanRevision(mission.id);
	if (currentRevision.id !== suggestion.baseRevisionId) {
		await repo.updateReplanSuggestion(suggestion.id, { status: "stale" });
		throw new AppError(
			409,
			"MISSION_REPLAN_STALE_BASE",
			"Replan base revision is no longer current",
		);
	}
	if (suggestion.status !== "approved")
		throw new AppError(
			409,
			"MISSION_REPLAN_APPROVAL_REQUIRED",
			"Replan suggestion is not approved",
		);
	await validateMissionTaskGraphDiff({
		missionId: mission.id,
		baseRevision: currentRevision,
		operations: suggestion.taskGraphDiff,
	});
	const basePlanning = await missionPlannerRepo.getPlanningResult(
		currentRevision.planningResultId,
	);
	if (!basePlanning) throw new NotFoundError("Base planning result not found");
	const nextPlanning = applyDiffToPlanning(
		basePlanning.planningResult,
		suggestion.taskGraphDiff,
	);
	return db.transaction(async (tx) => {
		const planningResult = await missionPlannerRepo.createPlanningResult(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				decompositionRunId: basePlanning.decompositionRunId,
				status: "review_pending",
				planningResult: nextPlanning,
				statusReason: "approved_replan_applied",
			},
			tx,
		);
		await missionPlannerRepo.createTaskProposals(
			nextPlanning.taskProposals.map((candidate) => ({
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				planningResultId: planningResult.id,
				workPackageId: candidate.workPackageId,
				decompositionTaskId: candidate.id,
				status: "proposed",
				title: candidate.title,
				summary: candidate.summary,
				initialPrompt: candidate.initialPrompt,
				expectedOutcome: candidate.expectedOutcome,
				implementationFocusJson: candidate.implementationFocus,
				acceptanceCriteriaJson: candidate.acceptanceCriteria,
				verificationGateJson: candidate.verificationGate,
				dependenciesJson: candidate.dependencies,
				targetFilesOrModulesJson: candidate.targetFilesOrModules,
				risk: candidate.risk,
				approvalRequired: candidate.approvalRequired,
				schedulingJson: candidate.scheduling,
			})),
			tx,
		);
		await repo.upsertObjectivesFromPlanningResult(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				planningResult,
			},
			tx,
		);
		await missionPlannerRepo.updateMission(
			mission.id,
			{
				latestPlanningResultId: planningResult.id,
				status: "review_pending",
				statusReason: "approved_replan_applied",
			},
			tx,
		);
		const graph = await taskGraphForPlanningResultWithDb(planningResult.id, tx);
		const revision = await repo.createPlanRevision(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				baseRevisionId: currentRevision.id,
				planningResultId: planningResult.id,
				revisionNumber: currentRevision.revisionNumber + 1,
				summary: suggestion.reason,
				taskGraphJson: graph,
				appliedDiffJson: suggestion.taskGraphDiff,
				createdByActorJson: { type: "human", id: null, displayName: "User" },
			},
			tx,
		);
		const applied = await repo.updateReplanSuggestion(
			suggestion.id,
			{ status: "applied", approvalId: approval.id },
			tx,
		);
		if (!applied) throw new NotFoundError("Replan suggestion not found");
		await repo.resolveAttentionForTarget(
			{
				missionId: mission.id,
				type: "replan_approval_required",
				targetType: "replan_suggestion",
				targetId: suggestion.id,
				actor: { type: "human", id: null, displayName: "User" },
			},
			tx,
		);
		const action = await repo.createCompletedPilotAction(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				targetType: "replan_suggestion",
				targetId: suggestion.id,
				type: "apply_replan",
				idempotencyKey: input.idempotencyKey,
				requestHash,
				reason: suggestion.reason,
				actor: { type: "human", id: null, displayName: "User" },
				resultRef: { type: "plan_revision", id: revision.id },
			},
			tx,
		);
		await repo.appendMissionEvent(
			{
				missionId: mission.id,
				repositoryId: mission.repositoryId,
				eventType: "replan_applied",
				summary: `再計画 revision ${revision.revisionNumber} を適用しました。`,
				actor: { type: "human", id: null, displayName: "User" },
				payload: { suggestionId: suggestion.id, revisionId: revision.id },
				sourceKind: "mission_command",
				sourceId: action.id,
			},
			tx,
		);
		return { suggestion: applied, revision, planningResult };
	});
}

async function taskGraphForPlanningResultWithDb(
	planningResultId: string,
	database: Parameters<typeof missionPlannerRepo.getPlanningResult>[1],
) {
	const planningResult = await missionPlannerRepo.getPlanningResult(
		planningResultId,
		database,
	);
	if (!planningResult)
		throw new NotFoundError("Mission planning result not found");
	const proposals = await missionPlannerRepo.listTaskProposals(
		planningResultId,
		database,
	);
	return missionTaskGraphSchema.parse({
		schemaVersion: "nightworkers.mission-task-graph/v1",
		planningResultId,
		objectives: planningResult.planningResult.objectives.map((item) => ({
			id: item.id,
			title: item.title,
		})),
		workPackages: planningResult.planningResult.workPackages.map((item) => ({
			id: item.id,
			title: item.title,
			relatedObjectiveIds: item.relatedObjectiveIds,
		})),
		taskCandidates: proposals.map((item) => ({
			id: item.decompositionTaskId,
			workPackageId: item.workPackageId,
			title: item.title,
			dependencies: item.dependencies,
			status: item.status,
		})),
	});
}
