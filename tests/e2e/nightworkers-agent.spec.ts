import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";
import {
	createE2eWorkspaceDirectory,
	initializeE2eGitRepository,
} from "./helpers";

const sameOriginHeaders = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
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

async function createDisposableLiveWorkspace(): Promise<string> {
	const workspaceDir = await createE2eWorkspaceDirectory("live-");
	await fs.mkdir(path.join(workspaceDir, "src"), { recursive: true });
	await fs.writeFile(
		path.join(workspaceDir, "README.md"),
		"# Live coding fixture\n",
		"utf-8",
	);
	await fs.writeFile(
		path.join(workspaceDir, "package.json"),
		JSON.stringify(
			{
				type: "module",
				scripts: {
					test: "node -e \"import('./src/greeting.mjs').then(m=>{if(m.greet('NightWorkers')!=='Hello, NightWorkers!') process.exit(1)})\"",
				},
			},
			null,
			2,
		),
		"utf-8",
	);
	await fs.writeFile(
		path.join(workspaceDir, "src/greeting.mjs"),
		"export function greet(name) {\n  return 'TODO';\n}\n",
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
			"initial live fixture",
		],
		{ cwd: workspaceDir, stdio: "ignore" },
	);
	return workspaceDir;
}

async function waitForTerminalRun(request: APIRequestContext, taskId: string) {
	const startedAt = Date.now();
	const timeoutMs = 8 * 60 * 1000;
	let latestRuns: Array<{
		id: string;
		status: string;
		diffPatch?: string | null;
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

		const workspaceDir = await createDisposableLiveWorkspace();
		let repositoryId: string | null = null;
		let taskId: string | null = null;

		try {
			const repositoryRes = await request.post("/api/repositories", {
				headers: sameOriginHeaders,
				data: {
					name: `E2E live fixture ${Date.now()}`,
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

			const diff = gitDiff(workspaceDir);
			expect(diff).toContain("src/greeting.mjs");
			expect(diff).toContain("Hello,");
			expect(diff).not.toContain("/tmp/");

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
			await fs.rm(workspaceDir, { recursive: true, force: true });
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
			expect(terminal.status).toBe("completed");
			expect(gitDiff(workspaceDir)).toContain("Hello from NightWorkers E2E");

			const detailRes = await request.get(`/api/runs/${run.id}`, {
				headers: sameOriginHeaders,
			});
			expect(detailRes.status(), await detailRes.text()).toBe(200);
			const detail = (await detailRes.json()) as {
				todos: Array<{ status: string }>;
				events: Array<{ type: string }>;
				testResults?: unknown;
			};
			expect(detail.todos.length).toBeGreaterThan(0);
			expect(detail.todos.every((todo) => todo.status === "passed")).toBe(true);
			expect(JSON.stringify(detail.events)).toContain("git.diff_collected");
			expect(JSON.stringify(detail.testResults)).toContain("fixture verify");

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
				page.getByText("Deterministic E2E implementation").first(),
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
