import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";
import {
	createE2eWorkspaceDirectory,
	initializeE2eGitRepository,
} from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
	"x-nightworkers-e2e": "1",
};
type Fixture = { workspace: string; repositoryId: string; taskId: string };

async function fixture(
	request: APIRequestContext,
	prompt: string,
): Promise<Fixture> {
	const workspace = await createE2eWorkspaceDirectory("test-mode-");
	await fs.mkdir(path.join(workspace, "src"), { recursive: true });
	await fs.writeFile(path.join(workspace, "src", "greeting.txt"), "TODO\n");
	initializeE2eGitRepository(workspace);
	execFileSync("git", ["add", "."], { cwd: workspace, stdio: "ignore" });
	execFileSync(
		"git",
		[
			"-c",
			"user.email=e2e@example.test",
			"-c",
			"user.name=NightWorkers E2E",
			"commit",
			"-m",
			"initial",
		],
		{ cwd: workspace, stdio: "ignore" },
	);
	const repository = await request.post("/api/repositories", {
		headers,
		data: {
			name: `Test mode ${Date.now()}`,
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repository.status(), await repository.text()).toBe(201);
	const repositoryId = ((await repository.json()) as { id: string }).id;
	const task = await request.post("/api/tasks", {
		headers,
		data: {
			repositoryId,
			title: "Test mode fixture",
			description: prompt,
			objective: prompt,
			acceptanceCriteria: "Verification evidence exists.",
			timeoutSeconds: 60,
		},
	});
	expect(task.status(), await task.text()).toBe(201);
	return {
		workspace,
		repositoryId,
		taskId: ((await task.json()) as { id: string }).id,
	};
}

async function seedSpec(request: APIRequestContext, taskId: string) {
	const response = await request.post("/api/e2e/fixtures/task-markdown", {
		headers,
		data: {
			taskId,
			content:
				"# E2E verification plan\n\n## Completion Conditions\n\n- fixture verify",
			intent: "implementation_plan",
		},
	});
	expect(response.status(), await response.text()).toBe(201);
	return ((await response.json()) as { specArtifactId: string }).specArtifactId;
}

async function waitFor(
	request: APIRequestContext,
	runId: string,
	statuses: string[],
) {
	for (let index = 0; index < 200; index += 1) {
		const response = await request.get(`/api/runs/${runId}`, { headers });
		expect(response.status(), await response.text()).toBe(200);
		const run = (await response.json()) as {
			status: string;
			todos?: unknown[];
			events?: unknown[];
		};
		if (statuses.includes(run.status)) return run;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Run ${runId} did not reach ${statuses.join(", ")}`);
}

async function cleanup(request: APIRequestContext, value: Fixture) {
	await Promise.allSettled([
		request.delete(`/api/tasks/${value.taskId}`, { headers }),
		request.delete(`/api/repositories/${value.repositoryId}`, { headers }),
	]);
	await fs.rm(value.workspace, { recursive: true, force: true });
}

async function startImplementation(request: APIRequestContext, taskId: string) {
	const ready = await request.patch(`/api/tasks/${taskId}`, {
		headers: headers,
		data: { status: "ready" },
	});
	expect(ready.status(), await ready.text()).toBe(200);
	const started = await request.post(`/api/workbench/sessions/${taskId}/run`, {
		headers: headers,
	});
	expect(started.status(), await started.text()).toBe(201);
	return (await started.json()) as { id: string };
}

async function prepareTestModeReviewArtifact(request: APIRequestContext) {
	const value = await fixture(request, "[fixture:success]");
	const specArtifactId = await seedSpec(request, value.taskId);
	const testMode = await request.post(
		`/api/tasks/${value.taskId}/test-mode-run`,
		{
			headers,
			data: { projectId: value.repositoryId, specArtifactId, mode: "test" },
		},
	);
	expect(testMode.status(), await testMode.text()).toBe(201);
	const testRun = (await testMode.json()) as { id: string };
	await waitFor(request, testRun.id, ["completed"]);
	const created = await request.post(
		`/api/runs/${testRun.id}/review-sessions`,
		{ headers },
	);
	expect(created.status(), await created.text()).toBe(201);
	return value;
}

test.describe("Test Mode boundaries @regression", () => {
	test.describe.configure({ mode: "serial", timeout: 60_000 });

	test("Test Mode creates a separate run without runtime Todos", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-TEST-001"],
	}, async ({ request }) => {
		const value = await fixture(request, "[fixture:success]");
		try {
			const specArtifactId = await seedSpec(request, value.taskId);
			const response = await request.post(
				`/api/tasks/${value.taskId}/test-mode-run`,
				{
					headers,
					data: { projectId: value.repositoryId, specArtifactId, mode: "test" },
				},
			);
			expect(response.status(), await response.text()).toBe(201);
			const started = (await response.json()) as { id: string };
			const run = await waitFor(request, started.id, ["completed"]);
			expect(run.todos).toEqual([]);
			expect(JSON.stringify(run.events)).toContain(
				"Test Mode fixture managed verification finished",
			);
		} finally {
			await cleanup(request, value);
		}
	});

	test("Test Mode rejects a missing spec artifact without creating a run", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-TEST-002"],
	}, async ({ request }) => {
		const value = await fixture(request, "[fixture:success]");
		try {
			const response = await request.post(
				`/api/tasks/${value.taskId}/test-mode-run`,
				{
					headers,
					data: {
						projectId: value.repositoryId,
						specArtifactId: "implementation-plan-missing",
						mode: "test",
					},
				},
			);
			expect(response.status()).toBe(404);
			const runs = await request.get(`/api/tasks/${value.taskId}/runs`, {
				headers,
			});
			expect(await runs.json()).toEqual([]);
		} finally {
			await cleanup(request, value);
		}
	});

	test("failed required verification does not complete Test Mode", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-TEST-003"],
	}, async ({ request }) => {
		const value = await fixture(request, "[fixture:verification_failure]");
		try {
			const specArtifactId = await seedSpec(request, value.taskId);
			const response = await request.post(
				`/api/tasks/${value.taskId}/test-mode-run`,
				{
					headers,
					data: { projectId: value.repositoryId, specArtifactId, mode: "test" },
				},
			);
			const started = (await response.json()) as { id: string };
			const run = await waitFor(request, started.id, ["needs_human"]);
			expect(JSON.stringify(run.events)).toContain(
				"Deterministic verification failed",
			);
		} finally {
			await cleanup(request, value);
		}
	});
});

test.describe("Review Mode boundaries @regression", () => {
	test.describe.configure({ mode: "serial", timeout: 60_000 });

	test("Review Run completes its status artifact and preserves its evidence", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-REVIEW-001"],
	}, async ({ request }) => {
		const value = await fixture(request, "[fixture:success]");
		try {
			const implementation = await startImplementation(request, value.taskId);
			await waitFor(request, implementation.id, ["completed"]);
			const created = await request.post(
				`/api/runs/${implementation.id}/review-sessions`,
				{ headers },
			);
			expect(created.status(), await created.text()).toBe(201);
			const session = (await created.json()) as { session: { id: string } };
			const review = await request.post(
				`/api/review-sessions/${session.session.id}/run`,
				{ headers },
			);
			expect(review.status(), await review.text()).toBe(200);
			const detail = await request.get(
				`/api/review-sessions/${session.session.id}`,
				{ headers },
			);
			expect(detail.status(), await detail.text()).toBe(200);
			const reviewDetail = (await detail.json()) as {
				statusArtifact: unknown;
				artifacts: Array<{ kind: string; status: string }>;
			};
			expect(reviewDetail.statusArtifact).toBeTruthy();
			expect(reviewDetail.artifacts).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ kind: "review_status", status: "done" }),
				]),
			);
		} finally {
			await cleanup(request, value);
		}
	});

	test("Test Mode result opens the persisted Review artifact route", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-REVIEW-002"],
	}, async ({ page, request }) => {
		const value = await prepareTestModeReviewArtifact(request);
		try {
			await page.goto(`/sessions/${value.taskId}?artifact=review_status`);
			await expect(page.locator(".nightworkers-shell")).toBeVisible();
			await expect(page).toHaveURL(/artifact=review_status.*$/);
		} finally {
			await cleanup(request, value);
		}
	});

	test("Review artifact deep link survives reload and browser history", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-NAV-001"],
	}, async ({ page, request }) => {
		const value = await prepareTestModeReviewArtifact(request);
		try {
			await page.goto(`/sessions/${value.taskId}?artifact=review_status`);
			await page.reload();
			await expect(page).toHaveURL(/artifact=review_status.*$/);
			await page.goto("/overview");
			await page.goBack();
			await expect(page).toHaveURL(/artifact=review_status.*$/);
			await page.goForward();
			await expect(page).toHaveURL(/overview$/);
		} finally {
			await cleanup(request, value);
		}
	});

	test("Review disposition and prompt suggestion persist after reload", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-REVIEW-003"],
	}, async ({ request }) => {
		const value = await fixture(request, "[fixture:success]");
		try {
			const implementation = await startImplementation(request, value.taskId);
			await waitFor(request, implementation.id, ["completed"]);
			const created = await request.post(
				`/api/runs/${implementation.id}/review-sessions`,
				{ headers },
			);
			const session = (await created.json()) as { session: { id: string } };
			await request.post(`/api/review-sessions/${session.session.id}/run`, {
				headers,
			});
			const detail = await request.get(
				`/api/review-sessions/${session.session.id}`,
				{ headers },
			);
			const initial = (await detail.json()) as {
				findings: Array<{ id: string }>;
			};
			expect(initial.findings.length).toBeGreaterThan(0);
			const findingId = initial.findings[0]?.id;
			if (!findingId) throw new Error("Review finding was not created");
			const events = await request.get(
				`/api/runs/${implementation.id}/events`,
				{
					headers,
				},
			);
			const eventId = ((await events.json()) as Array<{ id: string }>)[0]?.id;
			if (!eventId) throw new Error("Run evidence event was not created");
			const disposition = await request.post(
				`/api/review-sessions/${session.session.id}/findings/${findingId}/disposition`,
				{
					headers,
					data: {
						disposition: "prompt_suggestion",
						note: "Convert finding.",
						evidenceRefs: [{ kind: "run_event", eventId }],
					},
				},
			);
			expect(disposition.status(), await disposition.text()).toBe(200);
			const converted = (await disposition.json()) as {
				promptSuggestions: Array<{ id: string }>;
			};
			const suggestionId = converted.promptSuggestions[0]?.id;
			if (!suggestionId) throw new Error("Prompt suggestion was not created");
			const used = await request.post(
				`/api/review-sessions/${session.session.id}/prompt-suggestions/${suggestionId}/use`,
				{ headers },
			);
			expect(used.status(), await used.text()).toBe(200);
			const reloaded = await request.get(
				`/api/review-sessions/${session.session.id}`,
				{ headers },
			);
			const persisted = (await reloaded.json()) as {
				findings: Array<{ id: string; dispositionStatus: string }>;
				promptSuggestions: Array<{ id: string; status: string }>;
			};
			expect(
				persisted.findings.find((finding) => finding.id === findingId)
					?.dispositionStatus,
			).toBe("converted");
			expect(
				persisted.promptSuggestions.find((item) => item.id === suggestionId)
					?.status,
			).toBe("used");
		} finally {
			await cleanup(request, value);
		}
	});
});
