import { describe, expect, it, vi } from "vitest";
import {
	executeVerificationPhases,
	formatVerificationSummary,
	taskSets,
} from "../scripts/verify.mjs";

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

	it("keeps slow, smoke, desktop, and opt-in live checks in the full gate", () => {
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
				"live-llm",
				"live-agent-e2e",
			]),
		);
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
