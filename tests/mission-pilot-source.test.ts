import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client } from "../api/db/client";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import * as evaluationRepo from "../api/modules/project-evaluation/project-evaluation.repository";
import type { CreateMissionFromImprovementResponse } from "../shared/schemas/mission-pilot.schema";

const roots: string[] = [];

beforeAll(async () => ensureNightWorkersSchema());
afterAll(() => {
	for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-pilot-source-"));
	roots.push(root);
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: Mission Pilot source ${crypto.randomUUID()}`,
		localPath: root,
		branch: "main",
		queueEnabled: false,
	});
	const evaluation = await evaluationRepo.createRunningProjectEvaluationRun({
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
		evaluation.id,
		[
			{
				title: "Mission Pilotの入口を作る",
				summary: "改善案をMissionとして追跡する。",
				agentPrompt: "改善案を段階的に実装してください。",
				expectedOutcome: "Mission Controlで進捗を追跡できる。",
				implementationFocus: ["Project Evaluation source"],
				targetDimensions: ["architectureQuality"],
				scoreImpacts: [],
			},
		],
	);
	return { repository, evaluation, idea };
}

describe("Mission Pilot Project Evaluation source", () => {
	it("creates one source-linked Mission and returns it idempotently with audit rows", async () => {
		const { repository, evaluation, idea } = await fixture();
		const directTask = await nightworkersRepo.createTask({
			repositoryId: repository.id,
			title: "Direct task",
			description: "Existing direct Task",
			objective: "Plan first",
			acceptanceCriteria: "Verified",
			status: "draft",
			priority: 1,
			createdBy: "project-evaluation",
		});
		await evaluationRepo.createProjectEvaluationTaskLink({
			evaluationId: evaluation.id,
			ideaId: idea.id as string,
			taskId: directTask.id,
		});
		const request = {
			evaluationId: evaluation.id,
			improvementIdeaId: idea.id,
			idempotencyKey: crypto.randomUUID(),
		};

		const created = await app.request(
			`http://localhost/api/repositories/${repository.id}/missions/from-project-evaluation-improvement`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
			},
		);
		expect(created.status).toBe(201);
		const first =
			(await created.json()) as CreateMissionFromImprovementResponse;
		expect(first.created).toBe(true);
		expect(first.mission).toMatchObject({
			repositoryId: repository.id,
			source: "project_evaluation",
			sourceRefId: idea.id,
			sourceEvaluationId: evaluation.id,
		});
		expect(first.warnings).toHaveLength(1);

		const replay = await app.request(
			`http://localhost/api/repositories/${repository.id}/missions/from-project-evaluation-improvement`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
			},
		);
		expect(replay.status).toBe(200);
		const second =
			(await replay.json()) as CreateMissionFromImprovementResponse;
		expect(second.mission.id).toBe(first.mission.id);

		const counts = await client.execute({
			sql: `SELECT
        (SELECT count(*) FROM missions WHERE repository_id = ? AND source_ref_id = ?) AS missions,
        (SELECT count(*) FROM pilot_actions WHERE mission_id = ?) AS actions,
        (SELECT count(*) FROM mission_events WHERE mission_id = ?) AS events`,
			args: [
				repository.id,
				idea.id as string,
				first.mission.id,
				first.mission.id,
			],
		});
		expect(Number(counts.rows[0]?.missions)).toBe(1);
		expect(Number(counts.rows[0]?.actions)).toBe(1);
		expect(Number(counts.rows[0]?.events)).toBe(1);

		const conflict = await app.request(
			`http://localhost/api/repositories/${repository.id}/missions/from-project-evaluation-improvement`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...request, title: "Different request" }),
			},
		);
		expect(conflict.status).toBe(409);
	});

	it("rejects a repository that does not own the evaluation", async () => {
		const { evaluation, idea } = await fixture();
		const other = await fixture();
		const response = await app.request(
			`http://localhost/api/repositories/${other.repository.id}/missions/from-project-evaluation-improvement`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					evaluationId: evaluation.id,
					improvementIdeaId: idea.id,
					idempotencyKey: crypto.randomUUID(),
				}),
			},
		);
		expect(response.status).toBe(422);
	});

	it("converges concurrent source creation on one Mission", async () => {
		const { repository, evaluation, idea } = await fixture();
		const request = {
			evaluationId: evaluation.id,
			improvementIdeaId: idea.id,
			idempotencyKey: crypto.randomUUID(),
		};
		const send = () =>
			app.request(
				`http://localhost/api/repositories/${repository.id}/missions/from-project-evaluation-improvement`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(request),
				},
			);
		const responses = await Promise.all([send(), send()]);
		expect(responses.map((response) => response.status).sort()).toEqual([
			200, 201,
		]);
		const bodies = (await Promise.all(
			responses.map((response) => response.json()),
		)) as CreateMissionFromImprovementResponse[];
		expect(new Set(bodies.map((body) => body.mission.id)).size).toBe(1);
	});
});
