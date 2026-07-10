import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client } from "../api/db/client";
import {
	buildMissionTaskCandidateSnapshot,
	hashMissionTaskCandidateSnapshot,
} from "../api/modules/mission-pilot/mission-pilot-approval";
import { toMissionPilotTaskCandidate } from "../api/modules/mission-pilot/mission-pilot-task-candidate";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import * as queueService from "../api/modules/queue/queue-management.service";
import {
	missionEvidenceRefSchema,
	missionPilotTaskCandidateSchema,
} from "../shared/schemas/mission-pilot.schema";
import {
	type MissionTaskProposal,
	missionTaskProposalSchema,
} from "../shared/schemas/mission-planner.schema";
import type { MissionTaskCandidate } from "../shared/schemas/project-detail.schema";
import { buildUnifiedTaskCandidates } from "../src/modules/nightworkers/components/project-detail/mission-model";

const repoRoots: string[] = [];

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

afterAll(() => {
	for (const repoRoot of repoRoots) {
		fs.rmSync(repoRoot, { recursive: true, force: true });
	}
});

function createRepoRoot() {
	const repoRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "nightworkers-mission-pilot-"),
	);
	repoRoots.push(repoRoot);
	return repoRoot;
}

function taskProposalFixture(
	overrides: Partial<MissionTaskProposal> = {},
): MissionTaskProposal {
	return missionTaskProposalSchema.parse({
		id: crypto.randomUUID(),
		missionId: crypto.randomUUID(),
		planningResultId: crypto.randomUUID(),
		repositoryId: crypto.randomUUID(),
		workPackageId: "wp-baseline",
		decompositionTaskId: "task-baseline",
		status: "proposed",
		title: "Mission Pilot baseline",
		summary: "TaskCandidate source と approval snapshot を固定する。",
		initialPrompt: "Phase 0 の characterization test を追加する。",
		expectedOutcome: "Mission Pilot の既存境界が test で固定される。",
		implementationFocus: ["schema", "characterization test"],
		acceptanceCriteria: ["既存挙動を変更しない"],
		verificationGate: ["bun run test run tests/mission-pilot-baseline.test.ts"],
		dependencies: [],
		targetFilesOrModules: ["api/modules/mission-pilot"],
		risk: "medium",
		approvalRequired: true,
		scheduling: {
			executionType: "exclusive",
			reason: "Shared approval contract",
			sequenceGroupId: null,
			sequenceOrder: null,
			dependsOnTaskIds: [],
		},
		taskId: null,
		createdAt: new Date("2026-07-10T00:00:00.000Z"),
		updatedAt: new Date("2026-07-10T00:00:00.000Z"),
		...overrides,
	});
}

function goalCandidateFixture(): MissionTaskCandidate {
	return {
		id: crypto.randomUUID(),
		batchId: crypto.randomUUID(),
		repositoryId: crypto.randomUUID(),
		goalId: crypto.randomUUID(),
		goalTitle: "Goal-generated candidate",
		candidateKind: "feature_followup",
		moduleRouting: {
			primaryModule: "project-detail",
			secondaryModules: [],
			confidencePercent: 90,
			reason: "Goal generation fixture",
		},
		constraintGoalIds: [],
		planModeOpenQuestions: [],
		title: "Goal candidate",
		summary: "Mission に属さない既存 candidate。",
		rationale: "二系統を混同しないための fixture。",
		evidence: [],
		evaluationContribution: null,
		importancePercent: 50,
		confidencePercent: 90,
		tokenSize: "small",
		complexity: "low",
		taskPrompt: "Goal candidate task",
		acceptanceCriteria: "既存 direct task path を維持する。",
		verificationPlan: "focused test",
		status: "candidate",
		taskId: null,
		createdAt: new Date("2026-07-10T00:00:00.000Z"),
		updatedAt: new Date("2026-07-10T00:00:00.000Z"),
	};
}

describe("Mission Pilot Phase 0 contracts", () => {
	it("keeps goal candidates and Mission task proposals as distinct UI sources", () => {
		const proposal = taskProposalFixture();
		const rows = buildUnifiedTaskCandidates(
			[goalCandidateFixture()],
			[proposal],
		);

		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.sourceRef.source)).toEqual([
			"mission_task_candidate",
			"mission_task_proposal",
		]);
		expect(rows[0]).toMatchObject({
			origin: "goal_generation",
			missionId: null,
		});
		expect(rows[1]).toMatchObject({
			origin: "mission_decomposition",
			missionId: proposal.missionId,
		});
	});

	it("adapts only Mission task proposals to the Mission Pilot TaskCandidate contract", () => {
		const proposal = taskProposalFixture();
		const candidate = toMissionPilotTaskCandidate(proposal);

		expect(candidate).toMatchObject({
			source: "mission_task_proposal",
			taskCandidateId: proposal.id,
			missionId: proposal.missionId,
			risk: "medium",
			approvalRequired: true,
		});
		expect(
			missionPilotTaskCandidateSchema.safeParse({
				...candidate,
				source: "mission_task_candidate",
			}).success,
		).toBe(false);
	});

	it("builds deterministic snapshot hashes while preserving meaningful array order", () => {
		const proposal = taskProposalFixture();
		const first = buildMissionTaskCandidateSnapshot(proposal);
		const second = buildMissionTaskCandidateSnapshot(
			missionTaskProposalSchema.parse({
				updatedAt: proposal.updatedAt,
				createdAt: proposal.createdAt,
				...proposal,
			}),
		);

		expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
		expect(second).toEqual(first);
		expect(hashMissionTaskCandidateSnapshot(first.snapshot)).toBe(first.hash);

		const reordered = buildMissionTaskCandidateSnapshot(
			taskProposalFixture({
				id: proposal.id,
				missionId: proposal.missionId,
				planningResultId: proposal.planningResultId,
				implementationFocus: [...proposal.implementationFocus].reverse(),
			}),
		);
		expect(reordered.hash).not.toBe(first.hash);
	});

	it("changes the snapshot hash when approval-relevant content changes", () => {
		const proposal = taskProposalFixture();
		const baseline = buildMissionTaskCandidateSnapshot(proposal);
		const changed = buildMissionTaskCandidateSnapshot(
			taskProposalFixture({
				id: proposal.id,
				missionId: proposal.missionId,
				planningResultId: proposal.planningResultId,
				verificationGate: ["bun run verify"],
			}),
		);

		expect(changed.hash).not.toBe(baseline.hash);
	});

	it("accepts only the typed Mission evidence reference contract", () => {
		expect(
			missionEvidenceRefSchema.parse({
				type: "verification_evidence_run",
				id: crypto.randomUUID(),
				label: "focused tests",
			}),
		).toMatchObject({ type: "verification_evidence_run" });
		expect(
			missionEvidenceRefSchema.safeParse({
				type: "test_evidence",
				id: crypto.randomUUID(),
			}).success,
		).toBe(false);
		expect(
			missionEvidenceRefSchema.safeParse({
				type: "run",
				id: crypto.randomUUID(),
				untracked: true,
			}).success,
		).toBe(false);
	});

	it("keeps the current bootstrap path idempotent for Mission-related tables", async () => {
		await ensureNightWorkersSchema();
		await ensureNightWorkersSchema();
		const result = await client.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('missions', 'mission_task_proposals', 'mission_task_candidates', 'implementation_queue_entries', 'task_runs', 'task_events') ORDER BY name",
		);

		expect(result.rows.map((row) => row.name)).toEqual([
			"implementation_queue_entries",
			"mission_task_candidates",
			"mission_task_proposals",
			"missions",
			"task_events",
			"task_runs",
		]);
	});

	it("characterizes the legacy Queue approval handoff without changing it", async () => {
		const repository = await nightworkersRepo.createRepository({
			name: `TEST: Mission Pilot baseline ${crypto.randomUUID()}`,
			localPath: createRepoRoot(),
			branch: "main",
			queueEnabled: true,
		});
		const proposalId = crypto.randomUUID();
		const task = await nightworkersRepo.createTask({
			repositoryId: repository.id,
			title: `TEST: Mission Pilot legacy approval ${crypto.randomUUID()}`,
			description: "Characterize legacy Queue approval",
			objective: "Preserve the current Queue approval behavior",
			acceptanceCriteria: "Approval metadata gates Queue admission",
			status: "ready",
			createdBy: "mission-task-proposal",
		});
		await nightworkersRepo.createTaskMessage({
			taskId: task.id,
			role: "system",
			content: "Mission task proposal metadata attached.",
			messageType: "text",
			payloadJson: {
				source: "mission_task_proposal",
				missionProposal: {
					source: "mission_task_proposal",
					missionId: crypto.randomUUID(),
					planningResultId: crypto.randomUUID(),
					proposalId,
					workPackageId: "wp-legacy",
					decompositionTaskId: "task-legacy",
					dependencies: [],
					risk: "high",
					approvalRequired: true,
					scheduling: {
						executionType: "exclusive",
						reason: "Legacy Mission approval",
						sequenceGroupId: null,
						sequenceOrder: null,
						dependsOnTaskIds: [],
					},
				},
			},
		});

		await expect(
			queueService.createImplementationQueueEntry(task.id, {
				autoDrain: false,
			}),
		).rejects.toMatchObject({
			code: "MISSION_PROPOSAL_APPROVAL_REQUIRED",
			statusCode: 409,
		});

		const entry = await queueService.createImplementationQueueEntry(task.id, {
			autoDrain: false,
			approveMissionProposal: true,
		});
		expect(entry).toMatchObject({
			executionType: "exclusive",
			schedulingReason: "Legacy Mission approval",
		});
		const messages = await nightworkersRepo.listTaskMessages(task.id);
		expect(messages.at(-2)?.metadataJson).toMatchObject({
			source: "mission_proposal_approval",
			missionProposalApproval: { proposalId, approved: true },
		});
	});
});
