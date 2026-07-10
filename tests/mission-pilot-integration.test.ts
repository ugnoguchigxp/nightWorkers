import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as missionPilotRepo from "../api/modules/mission-pilot/mission-pilot.repository";
import * as missionPlannerRepo from "../api/modules/mission-planner/mission-planner.repository";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import * as evaluationRepo from "../api/modules/project-evaluation/project-evaluation.repository";
import * as queueRepo from "../api/modules/queue/queue.repository";
import type { CreateMissionFromImprovementResponse } from "../shared/schemas/mission-pilot.schema";
import { missionDecompositionPlanningResultSchema } from "../shared/schemas/mission-planner.schema";
import { postMissionPilot } from "./helpers/mission-pilot-fixture";

const roots: string[] = [];
beforeAll(async () => ensureNightWorkersSchema());
afterAll(() => {
	for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("Mission Pilot integrated MVP", () => {
	it("runs a Project Evaluation improvement through approval, Queue, evidence, and Mission completion", async () => {
		const root = fs.mkdtempSync(
			path.join(os.tmpdir(), "mission-pilot-integration-"),
		);
		roots.push(root);
		const repository = await nightworkersRepo.createRepository({
			name: `TEST: Mission Pilot integration ${crypto.randomUUID()}`,
			localPath: root,
			branch: "main",
			queueEnabled: false,
		});
		const projectEvaluation =
			await evaluationRepo.createRunningProjectEvaluationRun({
				repositoryId: repository.id,
				bundle: {
					schemaVersion: "nightworkers.project-evaluation-bundle/v1",
					repository: {
						id: repository.id,
						name: repository.name,
						localPath: repository.localPath,
						branch: repository.branch,
					},
					evidenceLevel: "repo-structure",
					inputs: {
						repoTree: [],
						scripts: {},
						recentTasks: [],
						recentRuns: [],
					},
					missingInputs: [],
					notVerified: [],
					createdAt: new Date().toISOString(),
				},
			});
		const [idea] = await evaluationRepo.createProjectImprovementIdeas(
			projectEvaluation.id,
			[
				{
					title: "Mission Pilot integration",
					summary: "Missionとして完了まで追跡する",
					agentPrompt: "承認済み作業を実装する",
					expectedOutcome: "検証証拠付きで完了する",
					implementationFocus: ["integration"],
					targetDimensions: ["architectureQuality"],
					scoreImpacts: [],
				},
			],
		);
		const createdResponse = await postMissionPilot(
			`/api/repositories/${repository.id}/missions/from-project-evaluation-improvement`,
			{
				evaluationId: projectEvaluation.id,
				improvementIdeaId: idea.id,
				idempotencyKey: crypto.randomUUID(),
			},
		);
		expect(createdResponse.status).toBe(201);
		const { mission } =
			(await createdResponse.json()) as CreateMissionFromImprovementResponse;

		const decompositionRun =
			await missionPlannerRepo.createRunningDecompositionRun({
				missionId: mission.id,
				repositoryId: repository.id,
				inputBundle: {},
			});
		const planning = missionDecompositionPlanningResultSchema.parse({
			schemaVersion: "nightworkers.mission-decomposition-result/v1",
			mission: { title: mission.title, goal: mission.goalText, nonGoals: [] },
			objectives: [
				{
					id: "objective-integrated",
					title: "統合フローを完了する",
					completionCriteria: ["verified"],
					verificationGate: ["integration passes"],
				},
			],
			workPackages: [
				{
					id: "wp-integrated",
					title: "Integrated",
					purpose: "MVP flow",
					relatedObjectiveIds: ["objective-integrated"],
					suggestedPlanMode: false,
					risk: "medium",
					approvalRequired: true,
					verificationGate: ["integration passes"],
				},
			],
			taskProposals: [
				{
					id: "task-integrated",
					title: "統合タスク",
					summary: "MVPを一周する",
					purpose: "integration",
					workPackageId: "wp-integrated",
					dependencies: [],
					targetFilesOrModules: ["api/modules/mission-pilot"],
					initialPrompt: "実装する",
					expectedOutcome: "verified",
					implementationFocus: ["integration"],
					acceptanceCriteria: ["integration passes"],
					verificationGate: ["integration passes"],
					risk: "medium",
					approvalRequired: true,
					scheduling: {
						executionType: "exclusive",
						reason: "controlled",
						sequenceGroupId: null,
						sequenceOrder: null,
						dependsOnTaskIds: [],
					},
				},
			],
			replanningUnits: [],
		});
		const planningResult = await missionPlannerRepo.createPlanningResult({
			missionId: mission.id,
			repositoryId: repository.id,
			decompositionRunId: decompositionRun.id,
			status: "review_pending",
			planningResult: planning,
		});
		await missionPlannerRepo.updateMission(mission.id, {
			status: "review_pending",
			latestPlanningResultId: planningResult.id,
		});
		const [proposal] = await missionPlannerRepo.createTaskProposals([
			{
				missionId: mission.id,
				repositoryId: repository.id,
				planningResultId: planningResult.id,
				workPackageId: "wp-integrated",
				decompositionTaskId: "task-integrated",
				status: "proposed",
				title: "統合タスク",
				summary: "MVPを一周する",
				initialPrompt: "実装する",
				expectedOutcome: "verified",
				implementationFocusJson: ["integration"],
				acceptanceCriteriaJson: ["integration passes"],
				verificationGateJson: ["integration passes"],
				dependenciesJson: [],
				targetFilesOrModulesJson: ["api/modules/mission-pilot"],
				risk: "medium",
				approvalRequired: true,
				schedulingJson: planning.taskProposals[0].scheduling,
			},
		]);
		await missionPilotRepo.upsertObjectivesFromPlanningResult({
			missionId: mission.id,
			repositoryId: repository.id,
			planningResult,
		});

		const requested = await postMissionPilot(
			`/api/missions/${mission.id}/approvals`,
			{
				targetType: "task_candidate",
				targetId: proposal.id,
				approvalType: "queue_admission",
				reason: "統合タスクを確認する",
				idempotencyKey: crypto.randomUUID(),
			},
		);
		const requestedBody = (await requested.json()) as {
			approval: { id: string };
		};
		await postMissionPilot(
			`/api/missions/${mission.id}/approvals/${requestedBody.approval.id}/approve`,
			{ reason: "実行を承認する", idempotencyKey: crypto.randomUUID() },
		);
		const materialized = await postMissionPilot(
			`/api/missions/${mission.id}/task-candidates/${proposal.id}/materialize`,
			{
				approvalId: requestedBody.approval.id,
				mode: "ready",
				idempotencyKey: crypto.randomUUID(),
			},
		);
		const materializedBody = (await materialized.json()) as {
			missionTask: { id: string };
			task: { id: string };
		};
		const queued = await postMissionPilot(
			`/api/missions/${mission.id}/tasks/${materializedBody.missionTask.id}/enqueue`,
			{ idempotencyKey: crypto.randomUUID() },
		);
		const queueEntry = ((await queued.json()) as { queueEntry: { id: string } })
			.queueEntry;

		const run = await nightworkersRepo.createTaskRun({
			taskId: materializedBody.task.id,
			repositoryId: repository.id,
			status: "completed",
			workerKind: "fixture",
			startedAt: new Date(),
			endedAt: new Date(),
			finishedAt: new Date(),
		});
		await queueRepo.updateImplementationQueueEntry(queueEntry.id, {
			status: "execution_completed",
			activeRunId: run.id,
		});
		await nightworkersRepo.createTaskEvent({
			taskRunId: run.id,
			type: "checkpoint",
			eventType: "checkpoint",
			message: "verification finished",
			payloadJson: {
				event: { type: "verification.finished", data: { passed: true } },
			},
		});
		const evaluated = await postMissionPilot(
			`/api/missions/${mission.id}/evaluate`,
			{ idempotencyKey: crypto.randomUUID() },
		);
		expect(evaluated.status).toBe(200);
		const result = (await evaluated.json()) as {
			evaluations: Array<{ result: string }>;
			mission: { status: string };
		};
		expect(result.evaluations[0].result).toBe("completed");
		expect(result.mission.status).toBe("completed");
		const detail = await (await import("../api/app")).default.request(
			`http://localhost/api/missions/${mission.id}/pilot-detail`,
		);
		const detailBody = (await detail.json()) as {
			source: { type: string };
			executionSummary: { satisfied: number };
			latestPlanRevision: unknown;
		};
		expect(detailBody.source.type).toBe("project_evaluation");
		expect(detailBody.executionSummary.satisfied).toBe(1);
	});
});
