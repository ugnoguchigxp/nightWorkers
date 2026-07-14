import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

async function repository(request: APIRequestContext, suffix: string) {
	const { workspace } = await createDisposableGitWorkspace({
		prefix: `queue-${suffix}-`,
	});
	const repository = await request.post("/api/repositories", {
		headers,
		data: {
			name: `Queue ${suffix}`,
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repository.status(), await repository.text()).toBe(201);
	return {
		workspace,
		repositoryId: ((await repository.json()) as { id: string }).id,
	};
}

async function task(
	request: APIRequestContext,
	suffix: string,
	fixture: Awaited<ReturnType<typeof repository>>,
	behavior = "hold_until_stopped",
) {
	const created = await request.post("/api/tasks", {
		headers,
		data: {
			repositoryId: fixture.repositoryId,
			title: `Queue ${suffix}`,
			description: `[fixture:${behavior}]`,
			objective: `[fixture:${behavior}]`,
			acceptanceCriteria: "Queue slot is observable.",
			timeoutSeconds: 60,
		},
	});
	const taskId = ((await created.json()) as { id: string }).id;
	await request.patch(`/api/tasks/${taskId}`, {
		headers,
		data: { status: "ready" },
	});
	return { ...fixture, taskId };
}

type QueueEntry = {
	id: string;
	priority: number;
	status: string;
	claimedAt?: number | null;
	activeRunId?: string | null;
};

async function enqueue(request: APIRequestContext, taskId: string) {
	const response = await request.post("/api/implementation-queue/entries", {
		headers,
		data: { taskId },
	});
	expect(response.status(), await response.text()).toBe(201);
	return (await response.json()) as QueueEntry;
}

async function queueRows(request: APIRequestContext, entryIds: string[]) {
	const response = await request.post("/api/e2e/fixtures/queue-entry", {
		headers: { ...headers, "x-nightworkers-e2e": "1" },
		data: { entryIds },
	});
	expect(response.status(), await response.text()).toBe(200);
	return ((await response.json()) as { entries: QueueEntry[] }).entries;
}

async function cleanup(
	request: APIRequestContext,
	values: Array<Awaited<ReturnType<typeof task>>>,
	entries: QueueEntry[] = [],
) {
	for (const entry of entries) {
		const row = (await queueRows(request, [entry.id]))[0];
		if (
			[
				"queued",
				"claimed",
				"processing",
				"needs_human",
				"awaiting_commit_decision",
			].includes(row?.status ?? "")
		) {
			await request.patch(`/api/implementation-queue/entries/${entry.id}`, {
				headers,
				data: { action: "cancel" },
			});
		}
	}
	for (const value of values) {
		const runs = await request.get(`/api/tasks/${value.taskId}/runs`, {
			headers,
		});
		for (const run of (await runs.json()) as Array<{
			id: string;
			status: string;
		}>) {
			if (run.status === "running") {
				await request.post(`/api/runs/${run.id}/stop`, { headers });
				await expect
					.poll(async () => {
						const detail = await request.get(`/api/runs/${run.id}`, {
							headers,
						});
						return ((await detail.json()) as { status: string }).status;
					})
					.toBe("cancelled");
			}
		}
		// The isolated E2E run root is removed by the runner. Keep queue records
		// until then so an asynchronous drain never observes deleted ownership rows.
	}
}

async function seedScheduling(
	request: APIRequestContext,
	taskId: string,
	scheduling: Record<string, unknown>,
) {
	const response = await request.post("/api/e2e/fixtures/task-scheduling", {
		headers: { ...headers, "x-nightworkers-e2e": "1" },
		data: { taskId, scheduling },
	});
	expect(response.status(), await response.text()).toBe(201);
}

test.describe("Implementation Queue scheduling @regression", () => {
	test.describe.configure({ mode: "serial", timeout: 60_000 });

	test("uses different slots for two normal tasks when processorCount is two", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-QUEUE-001"],
	}, async ({ request }) => {
		const settings = await request.patch("/api/implementation-queue/settings", {
			headers,
			data: { processorCount: 2 },
		});
		expect(settings.status(), await settings.text()).toBe(200);
		const values = [
			await task(request, "one", await repository(request, "one")),
			await task(request, "two", await repository(request, "two")),
		];
		const entries: QueueEntry[] = [];
		try {
			for (const value of values)
				entries.push(await enqueue(request, value.taskId));
			await expect
				.poll(
					async () => {
						const dashboard = await request.get("/api/implementation-queue", {
							headers,
						});
						const data = (await dashboard.json()) as {
							processors: Array<{
								entry: { taskId: string; processorSlot: number | null } | null;
							}>;
						};
						return data.processors
							.filter(
								(item) =>
									item.entry &&
									values.some((value) => value.taskId === item.entry?.taskId),
							)
							.map((item) => item.entry?.processorSlot);
					},
					{ timeout: 10_000 },
				)
				.toEqual(expect.arrayContaining([1, 2]));
		} finally {
			await cleanup(request, values, entries);
			await request.patch("/api/implementation-queue/settings", {
				headers,
				data: { processorCount: 1 },
			});
		}
	});

	test("exclusive task waits while a normal task is active", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-QUEUE-002"],
	}, async ({ request }) => {
		const fixture = await repository(request, "exclusive-lock");
		const values = [
			await task(request, "normal", fixture),
			await task(request, "exclusive", fixture),
		];
		const entries: QueueEntry[] = [];
		try {
			await seedScheduling(request, values[1].taskId, {
				executionType: "exclusive",
				reason: "E2E exclusive scheduling",
			});
			entries.push(await enqueue(request, values[0].taskId));
			await expect
				.poll(
					async () => (await queueRows(request, [entries[0].id]))[0]?.status,
				)
				.toBe("processing");
			entries.push(await enqueue(request, values[1].taskId));
			await expect
				.poll(
					async () => {
						const health = await request.get(
							"/api/implementation-queue/health",
							{
								headers,
							},
						);
						return JSON.stringify(await health.json());
					},
					{ timeout: 10_000 },
				)
				.toContain("exclusive_waiting_for_active_tasks");
		} finally {
			await cleanup(request, values, entries);
		}
	});

	test("runs sequence entries in order", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-QUEUE-003"],
	}, async ({ request }) => {
		const fixture = await repository(request, "sequence-order");
		const values = await Promise.all(
			["one", "two", "three"].map((suffix) =>
				task(request, suffix, fixture, "success"),
			),
		);
		const group = `e2e-sequence-${randomUUID()}`;
		for (const [index, value] of values.entries()) {
			await seedScheduling(request, value.taskId, {
				executionType: "sequence",
				sequenceGroupId: group,
				sequenceOrder: index + 1,
				reason: "E2E sequence order",
			});
		}
		const entries: QueueEntry[] = [];
		try {
			for (const value of values)
				entries.push(await enqueue(request, value.taskId));
			await expect
				.poll(
					async () => {
						await request.post("/api/implementation-queue/drain", { headers });
						return (
							await queueRows(
								request,
								entries.map((entry) => entry.id),
							)
						).map((row) => row.status);
					},
					{ timeout: 10_000 },
				)
				.toEqual([
					"execution_completed",
					"execution_completed",
					"execution_completed",
				]);
			const rows = await queueRows(
				request,
				entries.map((entry) => entry.id),
			);
			expect(rows.map((row) => row.claimedAt)).toEqual(
				[...rows]
					.sort((a, b) => (a.claimedAt ?? 0) - (b.claimedAt ?? 0))
					.map((row) => row.claimedAt),
			);
		} finally {
			await cleanup(request, values, entries);
		}
	});

	test("does not start sequence successors after a predecessor tool failure", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-QUEUE-004"],
	}, async ({ request }) => {
		const fixture = await repository(request, "sequence-failure");
		const values = [
			await task(request, "failed", fixture, "tool_failure"),
			await task(request, "blocked", fixture, "success"),
		];
		const group = `e2e-sequence-failure-${randomUUID()}`;
		for (const [index, value] of values.entries()) {
			await seedScheduling(request, value.taskId, {
				executionType: "sequence",
				sequenceGroupId: group,
				sequenceOrder: index + 1,
				reason: "E2E sequence failure",
			});
		}
		const entries: QueueEntry[] = [];
		try {
			for (const value of values)
				entries.push(await enqueue(request, value.taskId));
			await expect
				.poll(async () =>
					JSON.stringify(
						await (
							await request.get("/api/implementation-queue/health", { headers })
						).json(),
					),
				)
				.toContain("sequence_predecessor_failed");
			const rows = await queueRows(
				request,
				entries.map((entry) => entry.id),
			);
			expect(rows.find((row) => row.id === entries[0]?.id)?.status).toBe(
				"failed",
			);
			expect(rows.find((row) => row.id === entries[1]?.id)).toMatchObject({
				status: "queued",
				activeRunId: null,
			});
		} finally {
			await cleanup(request, values, entries);
		}
	});

	test("requeues needs_human entries with their priority preserved", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-QUEUE-005"],
	}, async ({ request }) => {
		const fixture = await repository(request, "needs-human");
		const value = await task(request, "needs-human", fixture, "policy-block");
		try {
			const entry = await enqueue(request, value.taskId);
			await expect
				.poll(async () => (await queueRows(request, [entry.id]))[0]?.status)
				.toBe("needs_human");
			const requeued = await request.post(
				`/api/implementation-queue/entries/${entry.id}/requeue`,
				{
					headers,
					data: { note: "E2E recovery" },
				},
			);
			expect(requeued.status(), await requeued.text()).toBe(201);
			const next = (await requeued.json()) as QueueEntry;
			expect(next.priority).toBe(entry.priority);
			expect((await queueRows(request, [entry.id]))[0]).toMatchObject({
				status: "execution_archived",
				priority: entry.priority,
			});
			await request.patch(`/api/implementation-queue/entries/${next.id}`, {
				headers,
				data: { action: "cancel" },
			});
		} finally {
			await cleanup(request, [value]);
		}
	});
});
