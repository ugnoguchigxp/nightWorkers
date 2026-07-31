import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";
import {
	createE2eWorkspaceDirectory,
	initializeE2eGitRepository,
} from "./helpers";

const sameOriginHeaders = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
	"x-nightworkers-e2e": "1",
};

async function createDisposableGitWorkspace(): Promise<string> {
	const workspaceDir = await createE2eWorkspaceDirectory("coding-");
	await fs.mkdir(path.join(workspaceDir, "src"), { recursive: true });
	await fs.writeFile(
		path.join(workspaceDir, "README.md"),
		"# E2E coding fixture\n",
		"utf-8",
	);
	await fs.writeFile(
		path.join(workspaceDir, "src/greeting.txt"),
		"TODO\n",
		"utf-8",
	);
	initializeE2eGitRepository(workspaceDir);
	execFileSync("git", ["add", "."], { cwd: workspaceDir, stdio: "ignore" });
	execFileSync(
		"git",
		[
			"-c",
			"user.email=e2e@example.test",
			"-c",
			"user.name=NightWorkers E2E",
			"commit",
			"-m",
			"initial fixture",
		],
		{ cwd: workspaceDir, stdio: "ignore" },
	);
	return workspaceDir;
}

async function resolveLiveCanaryRepositoryRoot(): Promise<string> {
	const configured =
		process.env.NIGHTWORKERS_LIVE_CODING_AGENT_REPOSITORY_PATH?.trim();
	if (!configured)
		throw new Error(
			"NIGHTWORKERS_LIVE_CODING_AGENT_REPOSITORY_PATH must identify a dedicated real canary repository.",
		);
	const repositoryRoot = await fs.realpath(configured);
	const temporaryRoot = await fs.realpath(os.tmpdir());
	const temporaryRelative = path.relative(temporaryRoot, repositoryRoot);
	if (
		temporaryRelative === "" ||
		(!temporaryRelative.startsWith("..") && !path.isAbsolute(temporaryRelative))
	)
		throw new Error(
			"Coding Agent live canary repository must not be a temporary directory.",
		);
	const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
		cwd: repositoryRoot,
		encoding: "utf8",
	}).trim();
	if ((await fs.realpath(gitRoot)) !== repositoryRoot)
		throw new Error(
			"NIGHTWORKERS_LIVE_CODING_AGENT_REPOSITORY_PATH must be the Git repository root.",
		);
	const status = execFileSync("git", ["status", "--porcelain"], {
		cwd: repositoryRoot,
		encoding: "utf8",
	});
	if (status.trim())
		throw new Error(
			"Coding Agent live canary repository must be clean before the worker creates its isolated worktree.",
		);
	await Promise.all([
		fs.access(path.join(repositoryRoot, "package.json")),
		fs.access(path.join(repositoryRoot, "src/greeting.mjs")),
	]);
	return repositoryRoot;
}

async function waitForTerminalRun(request: APIRequestContext, taskId: string) {
	const startedAt = Date.now();
	const timeoutMs = 8 * 60 * 1000;
	let latestRuns: Array<{
		id: string;
		status: string;
		diffPatch?: string | null;
		finalReport?: string | null;
		worktreePath?: string | null;
	}> = [];
	while (Date.now() - startedAt < timeoutMs) {
		const runsRes = await request.get(`/api/tasks/${taskId}/runs`, {
			headers: sameOriginHeaders,
		});
		expect(runsRes.status(), await runsRes.text()).toBe(200);
		latestRuns = (await runsRes.json()) as Array<{
			id: string;
			status: string;
			diffPatch?: string | null;
			finalReport?: string | null;
			worktreePath?: string | null;
		}>;
		const latestRun = latestRuns[0];
		if (
			latestRun &&
			[
				"completed",
				"needs_review",
				"needs_human",
				"failed",
				"cancelled",
				"timed_out",
			].includes(latestRun.status)
		) {
			return latestRun;
		}
		await new Promise((resolve) => setTimeout(resolve, 2500));
	}
	throw new Error(
		`Timed out waiting for terminal run. taskId=${taskId} runs=${JSON.stringify(latestRuns)}`,
	);
}

function gitDiff(workspaceDir: string) {
	return execFileSync("git", ["diff", "--", "."], {
		cwd: workspaceDir,
		encoding: "utf-8",
	});
}

test.describe("NightWorkers Agent Debug @regression", () => {
	test.describe.configure({ mode: "serial" });

	test("debug panel is available on a task detail page @smoke", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-UI-001"],
	}, async ({ page, request }) => {
		const workspaceDir = await createDisposableGitWorkspace();
		let repositoryId: string | null = null;
		let taskId: string | null = null;

		try {
			const repositoryRes = await request.post("/api/repositories", {
				headers: sameOriginHeaders,
				data: {
					name: `E2E debug fixture ${Date.now()}`,
					localPath: workspaceDir,
					branch: "main",
					allowed: true,
				},
			});
			expect(repositoryRes.status(), await repositoryRes.text()).toBe(201);
			const repository = (await repositoryRes.json()) as { id: string };
			repositoryId = repository.id;

			const taskRes = await request.post("/api/tasks", {
				headers: sameOriginHeaders,
				data: {
					repositoryId,
					title: "E2E debug fixture",
					description: "Open task detail debug panels.",
					objective: "Open task detail debug panels.",
					acceptanceCriteria: "Debug panels are visible.",
					timeoutSeconds: 60,
				},
			});
			expect(taskRes.status(), await taskRes.text()).toBe(201);
			const task = (await taskRes.json()) as { id: string };
			taskId = task.id;

			await page.goto(`/tasks/${taskId}`);

			await expect(
				page.getByRole("button", { name: "Agent Terminal Console" }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Review Diffs" }),
			).toBeVisible();
		} finally {
			if (taskId)
				await request.delete(`/api/tasks/${taskId}`, {
					headers: sameOriginHeaders,
				});
			if (repositoryId)
				await request.delete(`/api/repositories/${repositoryId}`, {
					headers: sameOriginHeaders,
				});
			await fs.rm(workspaceDir, { recursive: true, force: true });
		}
	});

	test("single prompt creates exactly one user message bubble @smoke", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-UI-002"],
	}, async ({ page, request }) => {
		const workspaceDir = await createDisposableGitWorkspace();
		let repositoryId: string | null = null;
		let taskId: string | null = null;

		try {
			const repositoryRes = await request.post("/api/repositories", {
				headers: sameOriginHeaders,
				data: {
					name: `E2E single submit fixture ${Date.now()}`,
					localPath: workspaceDir,
					branch: "main",
					allowed: true,
				},
			});
			expect(repositoryRes.status(), await repositoryRes.text()).toBe(201);
			const repository = (await repositoryRes.json()) as { id: string };
			repositoryId = repository.id;

			const taskRes = await request.post("/api/tasks", {
				headers: sameOriginHeaders,
				data: {
					repositoryId,
					title: "E2E single submit fixture",
					description: "Verify a single composer submit.",
					objective: "Verify a single composer submit.",
					acceptanceCriteria: "A single user bubble is created.",
					timeoutSeconds: 60,
				},
			});
			expect(taskRes.status(), await taskRes.text()).toBe(201);
			const task = (await taskRes.json()) as { id: string };
			taskId = task.id;

			await page.goto(`/sessions/${taskId}`);

			const prompt = `E2E single submit ${Date.now()}`;
			const input = page.getByPlaceholder(
				"指示を入力（送信: Cmd+Enter / Ctrl+Enter）",
			);
			await input.fill(prompt);
			await input.press("Meta+Enter");

			await expect
				.poll(async () => {
					const messagesRes = await request.get(
						`/api/tasks/${taskId}/messages`,
						{
							headers: sameOriginHeaders,
						},
					);
					const messages = (await messagesRes.json()) as Array<{
						role: string;
						content: string;
					}>;
					return messages.filter(
						(message) => message.role === "user" && message.content === prompt,
					).length;
				})
				.toBe(1);
		} finally {
			if (taskId)
				await request.delete(`/api/tasks/${taskId}`, {
					headers: sameOriginHeaders,
				});
			if (repositoryId)
				await request.delete(`/api/repositories/${repositoryId}`, {
					headers: sameOriginHeaders,
				});
			await fs.rm(workspaceDir, { recursive: true, force: true });
		}
	});
});

test.describe("NightWorkers Agent Live @agent-live", () => {
	test.describe.configure({ mode: "serial" });

	test("agent live run produces run, workspace, Todo, and verification evidence", {
		tag: ["@live", "@p1", "@scenario:NW-E2E-LIVE-001"],
	}, async ({ request }) => {
		test.skip(
			process.env.NIGHTWORKERS_LIVE_LLM_E2E !== "1",
			"Set NIGHTWORKERS_LIVE_LLM_E2E=1 to run live LLM evidence E2E.",
		);
		test.skip(
			!process.env.OPENAI_API_KEY &&
				!process.env.AZURE_OPENAI_API_KEY &&
				!process.env.CODEX_ACCESS_TOKEN,
			"Provider credentials are not configured in this environment.",
		);

		const repositoryRoot = await resolveLiveCanaryRepositoryRoot();
		let repositoryId: string | null = null;
		let taskId: string | null = null;

		try {
			const branch = execFileSync("git", ["branch", "--show-current"], {
				cwd: repositoryRoot,
				encoding: "utf8",
			}).trim();
			const repositoryRes = await request.post("/api/repositories", {
				headers: sameOriginHeaders,
				data: {
					name: `E2E live fixture ${Date.now()}`,
					localPath: repositoryRoot,
					branch,
					allowed: true,
				},
			});
			expect(repositoryRes.status(), await repositoryRes.text()).toBe(201);
			repositoryId = ((await repositoryRes.json()) as { id: string }).id;

			const taskRes = await request.post("/api/tasks", {
				headers: sameOriginHeaders,
				data: {
					repositoryId,
					title: "Live LLM greeting implementation",
					description:
						"src/greeting.mjs の greet(name) を実装し、npm test が通るようにしてください。既存の export 名は変えないでください。完了前に npm test を実行してください。",
					objective: "Implement greet(name) in the registered repository root.",
					acceptanceCriteria:
						"src/greeting.mjs returns Hello, <name>! and npm test succeeds before closeout.",
					timeoutSeconds: 480,
				},
			});
			expect(taskRes.status(), await taskRes.text()).toBe(201);
			taskId = ((await taskRes.json()) as { id: string }).id;
			const readyRes = await request.patch(`/api/tasks/${taskId}`, {
				headers: sameOriginHeaders,
				data: { status: "ready" },
			});
			expect(readyRes.status(), await readyRes.text()).toBe(200);

			const queueRes = await request.post(
				`/api/workbench/sessions/${taskId}/queue`,
				{ headers: sameOriginHeaders },
			);
			expect(queueRes.status(), await queueRes.text()).toBe(200);
			const runRes = await request.post(
				`/api/workbench/sessions/${taskId}/run`,
				{
					headers: sameOriginHeaders,
				},
			);
			expect(runRes.status(), await runRes.text()).toBe(201);
			const startedRun = (await runRes.json()) as { id: string };
			const terminalRun = await waitForTerminalRun(request, taskId);

			expect(terminalRun.id).toBe(startedRun.id);
			expect(["completed", "needs_review"]).toContain(terminalRun.status);

			expect(terminalRun.worktreePath).toBeTruthy();
			const diff = gitDiff(terminalRun.worktreePath ?? "");
			expect(diff).toContain("src/greeting.mjs");
			expect(diff).toContain("Hello,");
			expect(diff).not.toContain("/tmp/");
			expect(gitDiff(repositoryRoot)).toBe("");

			const eventsRes = await request.get(
				`/api/runs/${terminalRun.id}/events`,
				{
					headers: sameOriginHeaders,
				},
			);
			expect(eventsRes.status(), await eventsRes.text()).toBe(200);
			const events = (await eventsRes.json()) as Array<{
				type?: string;
				eventType?: string;
				message?: string;
				payloadJson?: Record<string, unknown>;
			}>;
			const eventText = JSON.stringify(events);
			expect(eventText).toContain("todo_list");
			expect(eventText).toContain("command_execution");
			expect(eventText).toContain("npm test");
			expect(events.some((event) => event.type === "run.created")).toBe(true);
		} finally {
			if (taskId)
				await request.delete(`/api/tasks/${taskId}`, {
					headers: sameOriginHeaders,
				});
			if (repositoryId)
				await request.delete(`/api/repositories/${repositoryId}`, {
					headers: sameOriginHeaders,
				});
		}
	});

	test("standalone live Plan Mode creates a Questionnaire without Mission Pilot", {
		tag: ["@live", "@p1", "@scenario:NW-E2E-LIVE-PLAN-MODE-001"],
	}, async ({ request }) => {
		test.setTimeout(8 * 60_000);
		test.skip(
			process.env.NIGHTWORKERS_LIVE_LLM_E2E !== "1",
			"Set NIGHTWORKERS_LIVE_LLM_E2E=1 to run live LLM evidence E2E.",
		);
		test.skip(
			!process.env.OPENAI_API_KEY &&
				!process.env.AZURE_OPENAI_API_KEY &&
				!process.env.CODEX_ACCESS_TOKEN,
			"Provider credentials are not configured in this environment.",
		);

		const repositoryRoot = await resolveLiveCanaryRepositoryRoot();
		let repositoryId: string | null = null;
		let taskId: string | null = null;
		try {
			const branch = execFileSync("git", ["branch", "--show-current"], {
				cwd: repositoryRoot,
				encoding: "utf8",
			}).trim();
			const repositoryRes = await request.post("/api/repositories", {
				headers: sameOriginHeaders,
				data: {
					name: `E2E standalone live Plan Mode ${Date.now()}`,
					localPath: repositoryRoot,
					branch,
					allowed: true,
				},
			});
			expect(repositoryRes.status(), await repositoryRes.text()).toBe(201);
			repositoryId = ((await repositoryRes.json()) as { id: string }).id;
			const taskRes = await request.post("/api/tasks", {
				headers: sameOriginHeaders,
				data: {
					repositoryId,
					title: "Standalone live Plan Mode",
					description:
						"Mission Pilotを起動せず、通常のPlan Modeでgreet(name)変更の実装計画を作成してください。最初にQuestionnaireを作成してください。",
					objective:
						"Create a normal Plan Mode Questionnaire without Mission Pilot.",
					acceptanceCriteria:
						"A Questionnaire is available and no Coding Agent implementation Run starts.",
					timeoutSeconds: 480,
				},
			});
			expect(taskRes.status(), await taskRes.text()).toBe(201);
			const task = (await taskRes.json()) as {
				id: string;
				missionPilot?: unknown;
			};
			taskId = task.id;
			expect(task).not.toHaveProperty("missionPilot");

			const intakeResponse = await request.post(
				`/api/workbench/sessions/${taskId}/messages`,
				{
					headers: sameOriginHeaders,
					data: {
						prompt:
							"通常のPlan Modeでgreet(name)変更の実装計画を作成してください。最初にQuestionnaireを作成してください。",
						waitForIntake: true,
					},
					timeout: 7 * 60_000,
				},
			);
			expect(intakeResponse.status(), await intakeResponse.text()).toBe(200);
			const intake = (await intakeResponse.json()) as {
				run: unknown;
				messages: Array<{ metadataJson?: { intent?: string } }>;
			};
			expect(intake.run).toBeNull();
			expect(
				intake.messages.some(
					(message) =>
						message.metadataJson?.intent === "design_questionnaire_ready",
				),
			).toBe(true);
			const runsResponse = await request.get(`/api/tasks/${taskId}/runs`, {
				headers: sameOriginHeaders,
			});
			expect(runsResponse.status(), await runsResponse.text()).toBe(200);
			expect(await runsResponse.json()).toEqual([]);
		} finally {
			if (taskId)
				await request.delete(`/api/tasks/${taskId}`, {
					headers: sameOriginHeaders,
				});
			if (repositoryId)
				await request.delete(`/api/repositories/${repositoryId}`, {
					headers: sameOriginHeaders,
				});
		}
	});
});

test.describe("NightWorkers deterministic core workflow @regression", () => {
	test.describe.configure({ mode: "serial" });

	test("project to run, review, and archive works without provider credentials", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-RUN-001"],
	}, async ({ page, request }) => {
		const workspaceDir = await createDisposableGitWorkspace();
		let repositoryId: string | null = null;
		let taskId: string | null = null;
		try {
			const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const repositoryRes = await request.post("/api/repositories", {
				headers: sameOriginHeaders,
				data: {
					name: `E2E deterministic ${suffix}`,
					localPath: workspaceDir,
					branch: "main",
					allowed: true,
				},
			});
			expect(repositoryRes.status(), await repositoryRes.text()).toBe(201);
			repositoryId = ((await repositoryRes.json()) as { id: string }).id;

			const taskRes = await request.post("/api/tasks", {
				headers: sameOriginHeaders,
				data: {
					repositoryId,
					title: `Deterministic workflow ${suffix}`,
					description:
						"Implement the deterministic E2E greeting and verify it.",
					objective: "Exercise the core workflow without external credentials.",
					acceptanceCriteria:
						"Diff, Todo, verification, review and archive evidence exist.",
					timeoutSeconds: 60,
				},
			});
			expect(taskRes.status(), await taskRes.text()).toBe(201);
			taskId = ((await taskRes.json()) as { id: string }).id;
			const codingFixtureRes = await request.post(
				"/api/e2e/fixtures/coding-agent-scenario",
				{
					headers: sameOriginHeaders,
					data: { taskId, scenario: "direct-run" },
				},
			);
			expect(codingFixtureRes.status(), await codingFixtureRes.text()).toBe(
				201,
			);
			const readyRes = await request.patch(`/api/tasks/${taskId}`, {
				headers: sameOriginHeaders,
				data: { status: "ready" },
			});
			expect(readyRes.status(), await readyRes.text()).toBe(200);

			const queueRes = await request.post(
				`/api/workbench/sessions/${taskId}/queue`,
				{ headers: sameOriginHeaders },
			);
			expect(queueRes.status(), await queueRes.text()).toBe(200);
			const terminal = await waitForTerminalRun(request, taskId);
			const run = terminal;
			const detailRes = await request.get(`/api/runs/${run.id}`, {
				headers: sameOriginHeaders,
			});
			expect(detailRes.status(), await detailRes.text()).toBe(200);
			const detail = (await detailRes.json()) as {
				todos: Array<{ status: string }>;
				events: unknown[];
			};
			const evidenceJson = JSON.stringify(detail.events);
			expect(terminal.status).toBe("completed");
			expect(terminal.worktreePath).toBeTruthy();
			expect(gitDiff(terminal.worktreePath ?? "")).toContain(
				"Hello from NightWorkers E2E",
			);
			expect(gitDiff(workspaceDir)).toBe("");
			expect(detail.todos.length).toBeGreaterThan(0);
			expect(detail.todos.every((todo) => todo.status === "passed")).toBe(true);
			expect(evidenceJson).toContain('"toolName":"git_diff"');
			expect(evidenceJson).toContain("Hello from NightWorkers E2E");
			expect(evidenceJson).toContain('"toolName":"run_verification"');
			expect(evidenceJson).toContain('"verified":true');

			const reviewRes = await request.post(`/api/runs/${run.id}/reviews`, {
				headers: sameOriginHeaders,
				data: { action: "complete", note: "Deterministic review accepted." },
			});
			expect(reviewRes.status(), await reviewRes.text()).toBe(200);
			expect((await reviewRes.json()) as { status: string }).toMatchObject({
				status: "completed",
			});

			await page.goto(`/sessions/${taskId}`);
			await expect(
				page
					.getByText(terminal.finalReport ?? "実装と検証を完了しました。")
					.first(),
			).toBeVisible();

			const archiveRes = await request.patch(
				`/api/workbench/sessions/${taskId}/archive`,
				{ headers: sameOriginHeaders },
			);
			expect(archiveRes.status(), await archiveRes.text()).toBe(200);
			expect(["archived", "completed", "cancelled"]).toContain(
				((await archiveRes.json()) as { status: string }).status,
			);
		} finally {
			if (taskId)
				await request.delete(`/api/tasks/${taskId}`, {
					headers: sameOriginHeaders,
				});
			if (repositoryId)
				await request.delete(`/api/repositories/${repositoryId}`, {
					headers: sameOriginHeaders,
				});
			await fs.rm(workspaceDir, { recursive: true, force: true });
		}
	});

	test("policy block persists needs_human evidence for retry", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-RUN-002"],
	}, async ({ request }) => {
		const workspaceDir = await createDisposableGitWorkspace();
		let repositoryId: string | null = null;
		let taskId: string | null = null;
		try {
			const repositoryRes = await request.post("/api/repositories", {
				headers: sameOriginHeaders,
				data: {
					name: `E2E blocked ${Date.now()}`,
					localPath: workspaceDir,
					branch: "main",
					allowed: true,
				},
			});
			repositoryId = ((await repositoryRes.json()) as { id: string }).id;
			const taskRes = await request.post("/api/tasks", {
				headers: sameOriginHeaders,
				data: {
					repositoryId,
					title: "Deterministic policy block",
					description:
						"[fixture:policy-block] Persist a retryable policy failure.",
					objective: "[fixture:policy-block]",
					acceptanceCriteria: "needs_human evidence is persisted.",
					timeoutSeconds: 60,
				},
			});
			taskId = ((await taskRes.json()) as { id: string }).id;
			await request.patch(`/api/tasks/${taskId}`, {
				headers: sameOriginHeaders,
				data: { status: "ready" },
			});
			const runRes = await request.post(
				`/api/workbench/sessions/${taskId}/run`,
				{
					headers: sameOriginHeaders,
				},
			);
			expect(runRes.status(), await runRes.text()).toBe(201);
			const terminal = await waitForTerminalRun(request, taskId);
			expect(terminal.status).toBe("needs_human");
			const eventsRes = await request.get(`/api/runs/${terminal.id}/events`, {
				headers: sameOriginHeaders,
			});
			expect(await eventsRes.text()).toContain("e2e_fixture_policy_block");
			expect(gitDiff(workspaceDir)).toBe("");
		} finally {
			if (taskId)
				await request.delete(`/api/tasks/${taskId}`, {
					headers: sameOriginHeaders,
				});
			if (repositoryId)
				await request.delete(`/api/repositories/${repositoryId}`, {
					headers: sameOriginHeaders,
				});
			await fs.rm(workspaceDir, { recursive: true, force: true });
		}
	});
});
