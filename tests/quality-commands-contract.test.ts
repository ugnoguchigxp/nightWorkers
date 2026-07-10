import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createCoverageImprovementTask,
	createProjectQualityRun,
	fetchProjectQuality,
} from "../src/modules/quality/api/qualityCommands";

describe("qualityCommands", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("routes overview, run, and coverage task requests", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response("{}")),
		);
		vi.stubGlobal("fetch", fetchMock);

		await fetchProjectQuality("repo-1");
		await createProjectQualityRun("repo-1", { runType: "unit" });
		await createCoverageImprovementTask("repo-1", "run-1", {
			fileKeys: ["src/example.ts"],
		});

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/repositories/repo-1/quality",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/repositories/repo-1/quality/runs",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"/api/repositories/repo-1/quality/runs/run-1/coverage-task",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ fileKeys: ["src/example.ts"] }),
			}),
		);
	});
});
