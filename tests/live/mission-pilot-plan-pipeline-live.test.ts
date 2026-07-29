import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../../api/db/bootstrap";
import { db } from "../../api/db/client";
import {
	missionPilotSessions,
	missionPilotSteps,
} from "../../api/db/mission-pilot-schema";
import { repositories, tasks } from "../../api/db/schema";
import { createSession } from "../../api/modules/missionPilot/mission-pilot.repository";
import { runMissionPilotPlanPipeline } from "../../api/modules/missionPilot/mission-pilot-plan-coordinator.service";
import * as questionnaireRepo from "../../api/modules/questionnaire/questionnaire.repository";
import * as queueRepo from "../../api/modules/queue/queue.repository";
import { getPlanModeWorkspace } from "../../api/modules/specification/plan-mode-workspace.service";

const liveEnabled = process.env.NIGHTWORKERS_LIVE_MISSION_PILOT === "1";
const repositoryIds: string[] = [];
const workspacePaths: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
	for (const workspace of workspacePaths.splice(0)) {
		fs.rmSync(workspace, { recursive: true, force: true });
	}
});

describe("Mission Pilot live plan pipeline", () => {
	it.skipIf(!liveEnabled)(
		"uses configured plan and review providers before Queue admission",
		async () => {
			const repositoryId = crypto.randomUUID();
			const taskId = crypto.randomUUID();
			const sourceId = crypto.randomUUID();
			const workspace = fs.mkdtempSync(
				path.join(os.tmpdir(), "nightworkers-mission-pilot-live-"),
			);
			fs.writeFileSync(
				path.join(workspace, "package.json"),
				JSON.stringify({
					name: "mission-pilot-live",
					version: "1.2.3",
					type: "module",
					scripts: {
						dev: "bun src/server.ts",
						test: "vitest run",
						verify: "bun run test",
					},
				}),
			);
			fs.mkdirSync(path.join(workspace, "src"));
			fs.writeFileSync(
				path.join(workspace, "src/server.ts"),
				[
					'import { Hono } from "hono";',
					"const app = new Hono();",
					'app.get("/health", (c) => c.json({ status: "ok" }));',
					"export default app;",
				].join("\n"),
			);
			fs.writeFileSync(
				path.join(workspace, "README.md"),
				"# Mission Pilot Live\n\nA small TypeScript service fixture.\n",
			);
			repositoryIds.push(repositoryId);
			workspacePaths.push(workspace);

			const session = await db.transaction(async (tx) => {
				await tx.insert(repositories).values({
					id: repositoryId,
					name: "Mission Pilot live pipeline",
					localPath: workspace,
					branch: "main",
				});
				const [task] = await tx
					.insert(tasks)
					.values({
						id: taskId,
						repositoryId,
						title: "Add a health summary endpoint",
						objective:
							"TypeScript serviceにGET /health/summaryを追加し、statusとversionをJSONで返す実装計画を作成する。",
						description:
							"既存構成を維持し、API契約と検証方法をFeature Planへ含める。",
						acceptanceCriteria:
							"Feature Planに実装手順、GET /health/summaryのレスポンス契約、unit testとHTTP smoke testが記載されている。",
						status: "ready",
					})
					.returning();
				return createSession(
					{
						task,
						sourceKind: "mission_task_candidate",
						sourceId,
					},
					tx,
				);
			});
			await db
				.update(missionPilotSessions)
				.set({
					desiredState: "playing",
					phase: "initial_intake",
					authorizationVersion: 2,
					authorizationJson: {
						version: 2,
						sessionId: session.id,
						taskId,
						sourceRef: { source: "mission_task_candidate", id: sourceId },
						grantedByAction: "mission_pilot_play",
						grantedAt: new Date().toISOString(),
						scopes: {
							plan: true,
							queue: true,
							implementation: true,
							testMutation: true,
							review: true,
							localCommit: true,
							taskComplete: true,
							taskArchive: true,
							push: false,
						},
						pushPolicy: "never",
					},
				})
				.where(eq(missionPilotSessions.id, session.id));

			const questionnaire =
				await questionnaireRepo.createDesignQuestionnaireSession({
					taskId,
					repositoryId,
					status: "review_ready",
				});
			const questionnaireJson = {
				version: 1 as const,
				source: {
					taskId,
					repositoryId,
					sourceKind: "plan_mode_intake" as const,
				},
				title: "Health summary specification",
				summary: "Endpoint contract and verification choice",
				questionSets: [
					{
						id: "api-contract",
						title: "API contract",
						category: "api",
						purpose: "Fix the response contract",
						questions: [
							{
								id: "response-fields",
								topic: "Response fields",
								question: "Which response fields are required?",
								why: "Implementation and tests need a stable contract.",
								answerType: "single_choice" as const,
								recommendedAnswerId: "status-version",
								options: [
									{
										id: "status-version",
										label: "status and version",
										tradeoff: "Small stable response",
										recommended: true,
									},
									{
										id: "status-only",
										label: "status only",
										tradeoff: "No version visibility",
									},
								],
								blocks: ["feature_plan"],
								outputSection: "acceptance_criteria",
								blocking: true,
							},
						],
					},
				],
				openQuestions: [],
				dataModelHandoffNotes: [],
			};
			await questionnaireRepo.createDesignQuestionnaireQuestionSet({
				sessionId: questionnaire.id,
				sequence: 1,
				questionnaireJson,
				rawOutput: JSON.stringify(questionnaireJson),
				validationStatus: "valid",
			});
			await questionnaireRepo.upsertDesignQuestionnaireAnswer({
				sessionId: questionnaire.id,
				questionId: "response-fields",
				answerJson: {
					questionId: "response-fields",
					selectedOptionIds: ["status-version"],
					rankedOptionIds: [],
					deferred: false,
				},
			});

			try {
				await runMissionPilotPlanPipeline(taskId);
			} catch (error) {
				const reviews = await db.query.missionPilotPlanReviews.findMany({
					where: (row, { eq }) => eq(row.sessionId, session.id),
					orderBy: (row, { asc }) => [asc(row.attempt)],
				});
				console.error(
					"Mission Pilot live review evidence:",
					JSON.stringify(
						reviews.map((review) => ({
							attempt: review.attempt,
							verdict: review.verdict,
							review: review.reviewJson,
						})),
						null,
						2,
					),
				);
				throw error;
			}

			const [pilot, planWorkspace, review, hasQueueEntry] = await Promise.all([
				db.query.missionPilotSessions.findFirst({
					where: eq(missionPilotSessions.id, session.id),
				}),
				getPlanModeWorkspace(taskId),
				db.query.missionPilotPlanReviews.findFirst({
					where: (row, { eq }) => eq(row.sessionId, session.id),
					orderBy: (row, { desc }) => [desc(row.attempt)],
				}),
				queueRepo.hasActiveImplementationQueueEntry(taskId),
			]);
			expect(planWorkspace.featurePlanArtifacts.length).toBeGreaterThan(0);
			expect(review).toMatchObject({ verdict: "pass" });
			expect(hasQueueEntry).toBe(true);
			expect(pilot).toMatchObject({
				phase: "queued",
				desiredState: "playing",
			});

			await db
				.update(missionPilotSessions)
				.set({
					phase: "generating_artifacts",
					version: (pilot?.version ?? 0) + 1,
					updatedAt: new Date(),
				})
				.where(eq(missionPilotSessions.id, session.id));
			await db
				.update(missionPilotSteps)
				.set({
					status: "running",
					artifactMessageId: null,
					startedAt: new Date(),
					finishedAt: null,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(missionPilotSteps.sessionId, session.id),
						eq(missionPilotSteps.stepKey, "feature_plan"),
					),
				);
			await expectApiProcessRestartRecovery(session.id);
		},
		600_000,
	);
});

async function expectApiProcessRestartRecovery(sessionId: string) {
	const port = await reservePort();
	const output: string[] = [];
	const child = spawn("bun", ["api/index.ts"], {
		cwd: process.cwd(),
		env: {
			...process.env,
			PORT: String(port),
			HOST: "127.0.0.1",
			CORS_ORIGIN: `http://127.0.0.1:${port}`,
			NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN: "true",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout?.on("data", (chunk) => output.push(String(chunk)));
	child.stderr?.on("data", (chunk) => output.push(String(chunk)));
	try {
		await waitFor(async () => {
			const response = await fetch(
				`http://127.0.0.1:${port}/api/health/ready`,
				{
					signal: AbortSignal.timeout(1_000),
				},
			);
			return response.ok;
		}, 30_000);
		await waitFor(async () => {
			const session = await db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, sessionId),
			});
			return session?.phase === "queued";
		}, 30_000);
	} catch (error) {
		throw new Error(
			`API process restart recovery failed: ${error instanceof Error ? error.message : String(error)}\n${output.join("").slice(-4000)}`,
		);
	} finally {
		child.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				if (child.exitCode === null) child.kill("SIGKILL");
				resolve();
			}, 5_000);
			child.once("close", () => {
				clearTimeout(timeout);
				resolve();
			});
		});
	}
}

async function reservePort() {
	return new Promise<number>((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : null;
			server.close((error) => {
				if (error) reject(error);
				else if (port) resolve(port);
				else reject(new Error("Unable to reserve restart test port"));
			});
		});
	});
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown = null;
	while (Date.now() < deadline) {
		try {
			if (await check()) return;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(
		lastError instanceof Error
			? lastError.message
			: `Condition was not met within ${timeoutMs}ms`,
	);
}
