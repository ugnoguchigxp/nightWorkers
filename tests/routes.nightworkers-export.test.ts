import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../api/lib/types";

const serviceMocks = vi.hoisted(() => ({
	listRepositories: vi.fn(),
	createRepository: vi.fn(),
	getRepository: vi.fn(),
	deleteRepository: vi.fn(),
	listTasks: vi.fn(),
	createTask: vi.fn(),
	getTask: vi.fn(),
	deleteTask: vi.fn(),
	updateTask: vi.fn(),
	appendTaskMessage: vi.fn(),
	listTaskMessages: vi.fn(),
	startTaskRun: vi.fn(),
	getTaskRun: vi.fn(),
	getTaskRunsForTask: vi.fn(),
	browseLocalFolders: vi.fn(),
	createLocalFolder: vi.fn(),
	exportTaskRunJsonl: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/nightworkers.service", () => serviceMocks);

import { nightworkersRouter } from "../api/modules/nightworkers/nightworkers.routes";

const createApp = () => {
	const app = new OpenAPIHono<AppEnv>();
	app.route("/api", nightworkersRouter);
	return app;
};

describe("nightworkers export route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("GET /api/runs/:id/export.jsonl returns NDJSON with attachment header", async () => {
		const runId = "d9483774-5f2a-4730-af45-6c17cbd0b804";
		serviceMocks.exportTaskRunJsonl.mockResolvedValueOnce(
			'{"type":"nightworkers_run"}\n',
		);

		const app = createApp();
		const res = await app.request(`/api/runs/${runId}/export.jsonl`);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/x-ndjson");
		expect(res.headers.get("content-disposition")).toContain(
			`nightworkers-run-${runId}.jsonl`,
		);
		expect(await res.text()).toContain("nightworkers_run");
	});

	it("returns 404 when run does not exist", async () => {
		const runId = "d9483774-5f2a-4730-af45-6c17cbd0b804";
		serviceMocks.exportTaskRunJsonl.mockResolvedValueOnce(null);

		const app = createApp();
		const res = await app.request(`/api/runs/${runId}/export.jsonl`);

		expect(res.status).toBe(404);
	});
});

describe("nightworkers folder utility routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("POST /api/utils/create-folder creates a local folder", async () => {
		serviceMocks.createLocalFolder.mockResolvedValueOnce({
			name: "new-project",
			path: "/tmp/new-project",
		});

		const app = createApp();
		const res = await app.request("/api/utils/create-folder", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ parentPath: "/tmp", name: "new-project" }),
		});

		expect(res.status).toBe(201);
		await expect(res.json()).resolves.toEqual({
			name: "new-project",
			path: "/tmp/new-project",
		});
		expect(serviceMocks.createLocalFolder).toHaveBeenCalledWith({
			parentPath: "/tmp",
			name: "new-project",
		});
	});
});
