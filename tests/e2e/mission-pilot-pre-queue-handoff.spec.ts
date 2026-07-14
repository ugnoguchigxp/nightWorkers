import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
	"x-nightworkers-e2e": "1",
};

test("real Play persists an immutable reviewed handoff before post-Queue progression", {
	tag: ["@deterministic", "@p0", "@scenario:NW-E2E-MISSION-PILOT-002"],
}, async ({ page, request }) => {
	const settingsPath = process.env.NIGHTWORKERS_GENERAL_SETTINGS_PATH;
	if (!settingsPath) {
		throw new Error("Isolated E2E settings path is required");
	}
	const previousSettings = await fs
		.readFile(settingsPath, "utf8")
		.catch(() => null);
	await fs.writeFile(
		settingsPath,
		JSON.stringify({
			planMode: {
				capabilities: {
					feature_plan: true,
					questionnaire: true,
					user_flow: false,
					blueprint: false,
					data_model: false,
					api_io_contract: false,
					activity_flow: false,
					sequence_flow: false,
					zod_schema_design: false,
				},
			},
		}),
	);
	const { workspace } = await createDisposableGitWorkspace({
		prefix: "mission-pilot-handoff-",
	});
	const repositoryResponse = await request.post("/api/repositories", {
		headers,
		data: {
			name: "Mission Pilot pre-Queue handoff",
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repositoryResponse.status(), await repositoryResponse.text()).toBe(
		201,
	);
	const repositoryId = ((await repositoryResponse.json()) as { id: string }).id;
	try {
		const goalResponse = await request.post(
			`/api/repositories/${repositoryId}/mission-goals`,
			{
				headers,
				data: {
					title: "Mission Pilot handoff goal",
					goalText: "Queue a reviewed Mission Pilot plan exactly once",
					active: true,
				},
			},
		);
		expect(goalResponse.status(), await goalResponse.text()).toBe(201);
		const goalId = ((await goalResponse.json()) as { id: string }).id;
		const candidates = await request.post(
			"/api/e2e/fixtures/mission-candidates",
			{
				headers: { ...headers, "x-nightworkers-e2e": "1" },
				data: {
					repositoryId,
					goalId,
					candidates: [
						{
							title: "Mission Pilot reviewed handoff",
							summary: "Queue the reviewed plan without running implementation",
							rationale: "The pre-Queue contract must be deterministic",
							taskPrompt: "Prepare the reviewed plan and hand it to the Queue",
							acceptanceCriteria:
								"Exactly one unclaimed Queue entry exists and no TaskRun exists",
							verificationPlan:
								"Inspect Session, Context, Queue, and TaskRun rows",
							status: "candidate",
						},
					],
				},
			},
		);
		expect(candidates.status(), await candidates.text()).toBe(201);
		const candidateId = (
			(await candidates.json()) as { candidateIds: string[] }
		).candidateIds[0];

		const createResponse = await request.post(
			`/api/repositories/${repositoryId}/mission-task-candidates/create-tasks`,
			{
				headers,
				data: { candidateIds: [candidateId], mode: "draft" },
			},
		);
		expect(createResponse.status(), await createResponse.text()).toBe(201);
		const created = (await createResponse.json()) as {
			tasks: Array<{ id: string; missionPilot: { version: number } }>;
		};
		const taskId = created.tasks[0].id;
		const prepared = await request.post("/api/e2e/fixtures/pre-queue-handoff", {
			headers: { ...headers, "x-nightworkers-e2e": "1" },
			data: { taskId, repositoryId },
		});
		expect(prepared.status(), await prepared.text()).toBe(201);
		const fixture = (await prepared.json()) as {
			sessionId: string;
			activationContextRevision: number;
			contextDigest: string;
			planReviewId: string;
			verificationDocumentId: string;
		};
		const {
			activationContextRevision,
			contextDigest,
			planReviewId,
			verificationDocumentId,
		} = fixture;

		const playResponse = await request.post(
			`/api/mission-pilot/tasks/${taskId}/play`,
			{
				headers,
				data: { expectedVersion: created.tasks[0].missionPilot.version },
			},
		);
		expect(playResponse.status(), await playResponse.text()).toBe(200);
		let result: {
			phase: string;
			contextRevision: number;
			contextDigest: string;
			queueHandoffJson: Record<string, unknown>;
			queueCount: number;
		} | null = null;
		await expect
			.poll(
				async () => {
					const response = await request.post(
						"/api/e2e/fixtures/pre-queue-state",
						{
							headers,
							data: { taskId },
						},
					);
					expect(response.status(), await response.text()).toBe(200);
					const state = ((await response.json()) as { state: typeof result })
						.state;
					if (!state.queueHandoffJson) return null;
					result = state;
					return state;
				},
				{ timeout: 15_000 },
			)
			.toMatchObject({ queueHandoffJson: expect.anything() });
		expect(result).toMatchObject({
			contextRevision: activationContextRevision,
			contextDigest,
			queueCount: 1,
		});
		if (!result) throw new Error("Pre-Queue handoff state was not captured");
		const handoff = result.queueHandoffJson as {
			queueEntryId: string;
			reviewedContextDigest: string;
			planReviewId: string;
			verificationDocumentId: string;
		};
		expect(handoff).toMatchObject({
			reviewedContextDigest: contextDigest,
			planReviewId,
			verificationDocumentId,
			queueClaimReady: false,
		});

		const diagnosticRunId = randomUUID();
		const diagnosticResponse = await request.post(
			"/api/e2e/fixtures/pre-queue-diagnostic",
			{
				headers,
				data: {
					taskId,
					queueEntryId: handoff.queueEntryId,
					diagnosticRunId,
					contextRevision: activationContextRevision,
					contextDigest,
				},
			},
		);
		expect(diagnosticResponse.status(), await diagnosticResponse.text()).toBe(
			200,
		);
		await page.goto(`/sessions/${taskId}`);
		await page.getByRole("button", { name: "Pilot thought" }).click();
		const diagnostic = page
			.locator(".nightworkers-pilot-thought-event")
			.filter({ hasText: "MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN" });
		await expect(
			diagnostic.getByText(/Mission Pilotを停止しました/),
		).toBeVisible();
		await diagnostic.locator("summary").click();
		await expect(diagnostic.getByText(diagnosticRunId)).toBeVisible();
	} finally {
		await Promise.allSettled([
			request.delete(`/api/repositories/${repositoryId}`, { headers }),
			fs.rm(workspace, { recursive: true, force: true }),
			previousSettings === null
				? fs.rm(settingsPath, { force: true })
				: fs.writeFile(settingsPath, previousSettings),
		]);
	}
});
