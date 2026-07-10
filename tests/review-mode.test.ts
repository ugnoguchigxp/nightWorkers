import crypto from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import * as reviewRepo from "../api/modules/review/review-mode.repository";

const sameOriginHeaders = { Origin: "http://localhost:39174" };
const originalSecurityPluginIntegration =
	process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION;
const originalActiveLlmProvider = process.env.ACTIVE_LLM_PROVIDER;

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

afterEach(() => {
	if (originalSecurityPluginIntegration === undefined) {
		delete process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION;
	} else {
		process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION =
			originalSecurityPluginIntegration;
	}
	if (originalActiveLlmProvider === undefined) {
		delete process.env.ACTIVE_LLM_PROVIDER;
	} else {
		process.env.ACTIVE_LLM_PROVIDER = originalActiveLlmProvider;
	}
});

describe("Review Mode", () => {
	it("refreshes an existing system finding with the latest diagnostic text", async () => {
		const { task } = await createTask();
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "completed",
			workerKind: "native-local",
			summary: "Security diagnostic fixture",
			finalReport: "Security diagnostic fixture",
			startedAt: new Date(),
			endedAt: new Date(),
			finishedAt: new Date(),
		});
		const session = await reviewRepo.createOrStartReviewSession({
			runId: run.id,
			taskId: task.id,
			repositoryId: task.repositoryId,
			recommendationId: null,
		});
		const title = `vulnWorkbench diagnostic ${crypto.randomUUID()}`;
		const [first] = await reviewRepo.createReviewFindings([
			{
				reviewSessionId: session.id,
				runId: run.id,
				taskId: task.id,
				severity: "warning",
				title,
				body: "findingCount: 6\nreportPath: old-report.md",
				evidenceRefsJson: [],
				sourceSection: "review_run",
			},
		]);
		const [refreshed] = await reviewRepo.createReviewFindings([
			{
				reviewSessionId: session.id,
				runId: run.id,
				taskId: task.id,
				severity: "blocking",
				title,
				body: "[high] Container runs as root\n場所: Dockerfile:18\n対応: USER を設定する",
				evidenceRefsJson: [
					{ kind: "artifact", artifactKind: "security_review" },
				],
				sourceSection: "review_run",
			},
		]);

		expect(refreshed.id).toBe(first.id);
		expect(refreshed.severity).toBe("blocking");
		expect(refreshed.body).toContain("Container runs as root");
		expect(refreshed.body).not.toContain("reportPath");
		expect(refreshed.evidenceRefsJson).toEqual([
			{ kind: "artifact", artifactKind: "security_review" },
		]);
	});

	it("creates a required recommendation for schema changes without mutating run status", async () => {
		const { task } = await createTask();
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "completed",
			workerKind: "native-local",
			summary: "Done",
			finalReport: "Done",
			startedAt: new Date(),
			endedAt: new Date(),
			finishedAt: new Date(),
		});
		await repo.updateTaskRun(run.id, {
			diffPatch:
				"diff --git a/drizzle/migrations/0001.sql b/drizzle/migrations/0001.sql\n",
		});

		const res = await app.request(
			`http://localhost/api/runs/${run.id}/review-recommendation`,
			{
				headers: sameOriginHeaders,
			},
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.level).toBe("required");
		expect(
			body.reasons.map((reason: { code: string }) => reason.code),
		).toContain("schema_or_migration_change");
		expect((await repo.getTaskRun(run.id))?.status).toBe("completed");
	});

	it("starts a review session without exposing old section or final-action APIs", async () => {
		const { task } = await createTask();
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "completed",
			workerKind: "native-local",
			summary: "Tests passed",
			finalReport: "Tests passed",
			startedAt: new Date(),
			endedAt: new Date(),
			finishedAt: new Date(),
		});
		await repo.updateTaskRun(run.id, {
			diffPatch:
				"diff --git a/shared/schemas/public.schema.ts b/shared/schemas/public.schema.ts\n",
		});

		const startRes = await app.request(
			`http://localhost/api/runs/${run.id}/review-sessions`,
			{
				method: "POST",
				headers: sameOriginHeaders,
			},
		);
		expect(startRes.status).toBe(201);
		const started = await startRes.json();
		expect(started.statusArtifact.finalActionGate.canApprove).toBe(true);
		expect(
			started.statusArtifact.finalActionGate.requiredSectionKindsRemaining,
		).toEqual([]);

		const sectionRes = await app.request(
			`http://localhost/api/review-sessions/${started.session.id}/sections/test_coverage/run`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({}),
			},
		);
		expect(sectionRes.status).toBe(404);

		const approveRes = await app.request(
			`http://localhost/api/review-sessions/${started.session.id}/final-action`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({ action: "approve" }),
			},
		);
		expect(approveRes.status).toBe(404);
		expect((await repo.getTaskRun(run.id))?.status).toBe("completed");
	});

	it("routes findings to review-owned prompt suggestions without creating draft tasks", async () => {
		const { sessionId, findingId } =
			await createSessionWithVerificationFinding();

		const dispositionRes = await app.request(
			`http://localhost/api/review-sessions/${sessionId}/findings/${findingId}/disposition`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					disposition: "prompt_suggestion",
					note: "Continue this session with verification evidence.",
				}),
			},
		);
		expect(dispositionRes.status).toBe(200);
		const routed = await dispositionRes.json();
		expect(routed.promptSuggestions).toHaveLength(1);
		expect(routed.promptSuggestions[0]).toMatchObject({
			findingId,
			status: "draft",
		});
		expect(routed.promptSuggestions[0].prompt).toContain(
			"次の受け入れ条件に対応するテスト証跡を確認できませんでした。",
		);
		expect(
			routed.findings.find(
				(finding: { id: string }) => finding.id === findingId,
			),
		).toMatchObject({
			disposition: "prompt_suggestion",
			dispositionStatus: "converted",
			createdGoalId: routed.promptSuggestions[0].id,
		});

		const useSuggestionRes = await app.request(
			`http://localhost/api/review-sessions/${sessionId}/prompt-suggestions/${routed.promptSuggestions[0].id}/use`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({}),
			},
		);
		expect(useSuggestionRes.status).toBe(200);
		const used = await useSuggestionRes.json();
		expect(used.promptSuggestions[0]).toMatchObject({
			status: "used",
			useCount: 1,
		});
	});

	it("does not persist prompt_suggestion disposition when evidence refs are missing", async () => {
		const { sessionId, findingId } = await createSessionWithManualFinding({
			evidenceRefs: [],
		});

		const dispositionRes = await app.request(
			`http://localhost/api/review-sessions/${sessionId}/findings/${findingId}/disposition`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					disposition: "prompt_suggestion",
					note: "This should not be persisted without evidence.",
				}),
			},
		);
		expect(dispositionRes.status).toBe(400);

		const detailRes = await app.request(
			`http://localhost/api/review-sessions/${sessionId}`,
			{
				headers: sameOriginHeaders,
			},
		);
		expect(detailRes.status).toBe(200);
		const detail = await detailRes.json();
		expect(detail.promptSuggestions).toHaveLength(0);
		expect(
			detail.findings.find(
				(finding: { id: string }) => finding.id === findingId,
			),
		).toMatchObject({
			disposition: null,
			dispositionStatus: "unresolved",
			createdGoalId: null,
		});
	});

	it("caps generated prompt suggestions to five active cards", async () => {
		const { sessionId } = await createSessionWithManualFindings(6);

		const syncRes = await app.request(
			`http://localhost/api/review-sessions/${sessionId}/prompt-suggestions`,
			{
				method: "POST",
				headers: sameOriginHeaders,
			},
		);
		expect(syncRes.status).toBe(200);
		const synced = await syncRes.json();
		expect(
			synced.promptSuggestions.filter(
				(item: { status: string }) => item.status === "draft",
			),
		).toHaveLength(5);
		expect(synced.statusArtifact.promptSuggestionCount).toBe(5);
	});

	it("does not start a runtime Review Run when target extraction is blocking", async () => {
		const { task } = await createTask();
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "completed",
			workerKind: "native-local",
			summary: "Large diff finished",
			finalReport: "Large diff finished.",
			startedAt: new Date(),
			endedAt: new Date(),
			finishedAt: new Date(),
		});
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId: task.id,
			timestamp: new Date().toISOString(),
			type: "git.diff_collected",
			severity: "checkpoint",
			actor: "worker",
			message: "Diff collected",
			data: {
				changedFiles: Array.from(
					{ length: 81 },
					(_, index) => `src/generated-${index}.ts`,
				),
			},
		});
		const startRes = await app.request(
			`http://localhost/api/runs/${run.id}/review-sessions`,
			{
				method: "POST",
				headers: sameOriginHeaders,
			},
		);
		expect(startRes.status).toBe(201);
		const started = await startRes.json();

		const reviewRunRes = await app.request(
			`http://localhost/api/review-sessions/${started.session.id}/run`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({ options: { codeReview: true } }),
			},
		);

		expect(reviewRunRes.status).toBe(200);
		const detail = await reviewRunRes.json();
		const reviewRunArtifact = detail.artifacts.find(
			(artifact: { kind: string }) => artifact.kind === "review_run",
		);
		expect(reviewRunArtifact).toMatchObject({ status: "needs_human" });
		expect(
			reviewRunArtifact.artifact.warnings.map(
				(warning: { code: string }) => warning.code,
			),
		).toContain("target_file_limit_exceeded");
		expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(1);
	});

	it("routes security plugin handoff findings into review-owned handoff artifacts", async () => {
		delete process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION;
		const { sessionId, findingId } = await createSessionWithSecurityFinding();

		const dispositionRes = await app.request(
			`http://localhost/api/review-sessions/${sessionId}/findings/${findingId}/disposition`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...sameOriginHeaders },
				body: JSON.stringify({
					disposition: "security_plugin_handoff",
					note: "External security evidence is needed.",
				}),
			},
		);

		expect(dispositionRes.status).toBe(200);
		const routed = await dispositionRes.json();
		expect(routed.securityHandoffs).toHaveLength(1);
		expect(routed.securityHandoffs[0]).toMatchObject({
			findingId,
			status: "needs_configuration",
			changedPaths: ["api/auth/token.ts"],
		});
		expect(
			routed.artifacts.find(
				(artifact: { kind: string }) => artifact.kind === "security_handoff",
			),
		).toMatchObject({
			status: "needs_human",
		});
	});
});

async function createTask() {
	const project = await repo.createRepository({
		name: `TEST: Review Mode ${crypto.randomUUID()}`,
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
	});
	const task = await repo.createTask({
		repositoryId: project.id,
		title: "Review Mode task",
		objective: "Implement a risky change",
		acceptanceCriteria: "Evidence must be reviewed",
		status: "completed",
	});
	return { project, task };
}

async function createSessionWithVerificationFinding() {
	process.env.ACTIVE_LLM_PROVIDER = "bedrock";
	const { task } = await createTask();
	await repo.createTaskMessage({
		taskId: task.id,
		role: "assistant",
		messageType: "markdown_document",
		content:
			"# Feature Plan\n\n## 受け入れ条件\n- 虹色決済トークンが北極ログに転記される",
		payloadJson: {
			intent: "feature_plan",
			title: "Feature Plan",
			markdownDocumentData: {
				title: "Feature Plan",
				content:
					"# Feature Plan\n\n## 受け入れ条件\n- 虹色決済トークンが北極ログに転記される",
			},
		},
	});
	const run = await repo.createTaskRun({
		taskId: task.id,
		repositoryId: task.repositoryId,
		status: "completed",
		workerKind: "native-local",
		summary: "Implementation finished",
		finalReport: "Implementation finished without verification details.",
		startedAt: new Date(),
		endedAt: new Date(),
		finishedAt: new Date(),
	});
	await repo.updateTaskRun(run.id, {
		diffPatch: "diff --git a/src/app.ts b/src/app.ts\n",
	});
	const startRes = await app.request(
		`http://localhost/api/runs/${run.id}/review-sessions`,
		{
			method: "POST",
			headers: sameOriginHeaders,
		},
	);
	expect(startRes.status).toBe(201);
	const started = await startRes.json();
	const [finding] = await reviewRepo.createReviewFindings([
		{
			reviewSessionId: started.session.id,
			runId: run.id,
			taskId: task.id,
			severity: "warning",
			title: "Agentic test evidence review could not complete",
			body: "Agentic confirmation could not complete.",
			evidenceRefsJson: [{ kind: "changed_file", path: "src/app.ts" }],
			sourceSection: "review_run",
		},
	]);
	return {
		sessionId: started.session.id as string,
		findingId: finding.id as string,
	};
}

async function createSessionWithSecurityFinding() {
	const { task } = await createTask();
	const run = await repo.createTaskRun({
		taskId: task.id,
		repositoryId: task.repositoryId,
		status: "completed",
		workerKind: "native-local",
		summary: "Security-sensitive change finished",
		finalReport: "Security-sensitive change finished.",
		startedAt: new Date(),
		endedAt: new Date(),
		finishedAt: new Date(),
	});
	await repo.updateTaskRun(run.id, {
		diffPatch: "diff --git a/api/auth/token.ts b/api/auth/token.ts\n",
	});
	const startRes = await app.request(
		`http://localhost/api/runs/${run.id}/review-sessions`,
		{
			method: "POST",
			headers: sameOriginHeaders,
		},
	);
	expect(startRes.status).toBe(201);
	const started = await startRes.json();
	const [finding] = await reviewRepo.createReviewFindings([
		{
			reviewSessionId: started.session.id,
			runId: run.id,
			taskId: task.id,
			severity: "blocking",
			title: "Security-sensitive change needs external evidence",
			body: "Security-sensitive changes need scanner-backed evidence.",
			evidenceRefsJson: [{ kind: "changed_file", path: "api/auth/token.ts" }],
			sourceSection: "review_run",
		},
	]);
	return {
		sessionId: started.session.id as string,
		findingId: finding.id as string,
	};
}

async function createSessionWithManualFinding(input: {
	evidenceRefs: unknown[];
}) {
	const { task } = await createTask();
	const run = await repo.createTaskRun({
		taskId: task.id,
		repositoryId: task.repositoryId,
		status: "completed",
		workerKind: "native-local",
		summary: "Manual review fixture",
		finalReport: "Manual review fixture.",
		startedAt: new Date(),
		endedAt: new Date(),
		finishedAt: new Date(),
	});
	const startRes = await app.request(
		`http://localhost/api/runs/${run.id}/review-sessions`,
		{
			method: "POST",
			headers: sameOriginHeaders,
		},
	);
	expect(startRes.status).toBe(201);
	const started = await startRes.json();
	const [finding] = await reviewRepo.createReviewFindings([
		{
			reviewSessionId: started.session.id,
			runId: run.id,
			taskId: task.id,
			severity: "blocking",
			title: `Manual finding ${crypto.randomUUID()}`,
			body: "Manual finding for disposition routing.",
			evidenceRefsJson: input.evidenceRefs,
			sourceSection: "findings",
		},
	]);
	return {
		sessionId: started.session.id as string,
		findingId: finding.id as string,
	};
}

async function createSessionWithManualFindings(count: number) {
	const { task } = await createTask();
	const run = await repo.createTaskRun({
		taskId: task.id,
		repositoryId: task.repositoryId,
		status: "completed",
		workerKind: "native-local",
		summary: "Manual review fixture",
		finalReport: "Manual review fixture.",
		startedAt: new Date(),
		endedAt: new Date(),
		finishedAt: new Date(),
	});
	const startRes = await app.request(
		`http://localhost/api/runs/${run.id}/review-sessions`,
		{
			method: "POST",
			headers: sameOriginHeaders,
		},
	);
	expect(startRes.status).toBe(201);
	const started = await startRes.json();
	await reviewRepo.createReviewFindings(
		Array.from({ length: count }, (_, index) => ({
			reviewSessionId: started.session.id,
			runId: run.id,
			taskId: task.id,
			severity: "blocking",
			title: `Manual capped finding ${index} ${crypto.randomUUID()}`,
			body: "Manual finding for prompt suggestion caps.",
			evidenceRefsJson: [
				{ kind: "changed_file", path: `src/file-${index}.ts` },
			],
			sourceSection: "findings",
		})),
	);
	return { sessionId: started.session.id as string };
}
