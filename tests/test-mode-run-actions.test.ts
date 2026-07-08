import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTestModeInitialTodos } from "../api/modules/nightworkers/nightworkers.service";
import { startTestModeRun } from "../src/modules/nightworkers/nightWorkersCommands";

describe("Test Mode run actions", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("separates related test discovery from unit test execution", () => {
		const discoveryTodos = buildTestModeInitialTodos("discover_tests");
		const unitTodos = buildTestModeInitialTodos("run_unit_tests");

		expect(discoveryTodos.map((todo) => todo.title)).toContain(
			"関連 test file を検索する",
		);
		expect(discoveryTodos.map((todo) => todo.title)).not.toContain(
			"対象 unit test を実行する",
		);
		expect(unitTodos.map((todo) => todo.title)).toContain(
			"対象 unit test を実行する",
		);
	});

	it("sends the selected action to the Test Mode run endpoint", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 202 }));

		await startTestModeRun("task-1", {
			projectId: "project-1",
			specArtifactId: "spec-1",
			verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			mode: "test",
			action: "discover_tests",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tasks/task-1/test-mode-run",
			expect.objectContaining({ method: "POST" }),
		);
		expect(
			JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
		).toMatchObject({
			action: "discover_tests",
		});
	});

	it("can request Test Mode with a missing verification document", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 202 }));

		await startTestModeRun("task-1", {
			projectId: "project-1",
			specArtifactId: "implementation-plan-message-1",
			verificationDocumentId: null,
			mode: "test",
			action: "run_unit_tests",
		});

		expect(
			JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
		).toMatchObject({
			action: "run_unit_tests",
			verificationDocumentId: null,
		});
	});
});
