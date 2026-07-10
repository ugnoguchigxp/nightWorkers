import { describe, expect, it, vi } from "vitest";
import {
	executeVerificationPhases,
	formatVerificationSummary,
	taskSets,
} from "../scripts/verify.mjs";
import vitestConfig from "../vitest.config";

describe("release verification plan", () => {
	it("keeps the default verify gate free of expensive and live checks", () => {
		const taskIds = taskSets.verify.flatMap((phase) =>
			phase.tasks.map((task) => task.id),
		);

		expect(taskIds).toEqual([
			"tracked-artifacts",
			"typecheck",
			"lint",
			"supervisor-regression",
		]);
		expect(taskIds).not.toEqual(
			expect.arrayContaining([
				"all-tests",
				"e2e-smoke",
				"live-llm",
				"desktop-build",
				"desktop-sidecar-smoke",
				"desktop-packaged-smoke",
			]),
		);
	});

	it("keeps slow, smoke, and desktop checks deterministic in the full gate", () => {
		const taskIds = taskSets.full.flatMap((phase) =>
			phase.tasks.map((task) => task.id),
		);

		expect(taskIds).toEqual(
			expect.arrayContaining([
				"all-tests",
				"e2e-smoke",
				"e2e-accessibility",
				"demo-smoke",
				"dependency-audit",
				"desktop-runtime",
				"desktop-lint",
				"desktop-build",
				"desktop-sidecar-smoke",
				"desktop-packaged-smoke",
			]),
		);
		expect(taskIds).not.toEqual(
			expect.arrayContaining(["live-llm", "live-agent-e2e"]),
		);
	});

	it("isolates external LLM canaries to the live target", () => {
		const liveTaskIds = taskSets.live.flatMap((phase) =>
			phase.tasks.map((task) => task.id),
		);
		const nonLiveTaskIds = Object.entries(taskSets)
			.filter(([target]) => target !== "live")
			.flatMap(([, phases]) =>
				phases.flatMap((phase) => phase.tasks.map((task) => task.id)),
			);

		expect(liveTaskIds).toEqual(["live-llm", "live-agent-e2e"]);
		expect(nonLiveTaskIds).not.toEqual(expect.arrayContaining(liveTaskIds));
	});

	it("excludes live and E2E files from regular Vitest", () => {
		const config = vitestConfig as unknown as {
			test?: { exclude?: string[] };
		};
		expect(config.test?.exclude).toEqual(
			expect.arrayContaining(["tests/e2e/**", "tests/live/**"]),
		);
	});

	it("blocks external LLM fetches from regular Vitest", async () => {
		await expect(
			fetch("https://api.openai.com/v1/chat/completions", {
				method: "POST",
			}),
		).rejects.toThrow("Unexpected live LLM fetch in regular Vitest");
	});

	it("keeps full tests, E2E, audit, and desktop smoke in release order", () => {
		const taskIds = taskSets.release.flatMap((phase) =>
			phase.tasks.map((task) => task.id),
		);
		const requiredTaskIds = [
			"tracked-artifacts",
			"typecheck",
			"lint",
			"supervisor-regression",
			"all-tests",
			"e2e-smoke",
			"dependency-audit",
			"desktop-runtime",
			"desktop-lint",
			"desktop-build",
			"desktop-sidecar-smoke",
			"desktop-packaged-smoke",
		];

		expect(taskIds).toEqual(expect.arrayContaining(requiredTaskIds));
		expect(requiredTaskIds.map((taskId) => taskIds.indexOf(taskId))).toEqual(
			[...requiredTaskIds.keys()]
				.map((index) => taskIds.indexOf(requiredTaskIds[index] ?? ""))
				.sort((left, right) => left - right),
		);
	});

	it("stops after the first failed serial task and reports its phase", async () => {
		const runner = vi.fn(async (task: { id: string; label: string }) => ({
			task,
			code: task.id === "e2e-smoke" ? 1 : 0,
			duration: "0.1s",
			stdout: "",
			stderr: task.id === "e2e-smoke" ? "failed" : "",
		}));
		const phases = taskSets.release.filter((phase) =>
			["e2e-smoke", "dependency-audit", "desktop-build-smoke"].includes(
				phase.id,
			),
		);

		const result = await executeVerificationPhases(phases, runner);

		expect(result.failure?.phase.id).toBe("e2e-smoke");
		expect(runner).toHaveBeenCalledTimes(1);
		expect(formatVerificationSummary("release", result.results)).toContain(
			"FAIL",
		);
	});
});
