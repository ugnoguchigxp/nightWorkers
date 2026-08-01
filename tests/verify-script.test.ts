import { describe, expect, it, vi } from "vitest";
import {
	executeVerificationPhases,
	formatVerificationSummary,
	taskSets,
} from "../scripts/verify.mjs";
import vitestConfig from "../vitest.config";

describe("release verification plan", () => {
	it("adds the weekly dependency audit without expensive and live checks", () => {
		const taskIds = taskSets.verify.flatMap((phase) =>
			phase.tasks.map((task) => task.id),
		);

		expect(taskIds).toEqual([
			"tracked-artifacts",
			"architecture",
			"llm-fixture-catalog",
			"typecheck",
			"lint",
			"supervisor-regression",
			"weekly-dependency-audit",
		]);
		expect(taskIds).not.toEqual(
			expect.arrayContaining([
				"all-tests",
				"unit-coverage",
				"e2e-coverage",
				"live-llm",
				"desktop-build",
				"desktop-sidecar-smoke",
				"desktop-packaged-smoke",
				"dependency-audit",
			]),
		);
	});

	it("keeps the weekly audit out of unconditional full and release gates", () => {
		for (const target of ["full", "release"] as const) {
			const taskIds = taskSets[target].flatMap((phase) =>
				phase.tasks.map((task) => task.id),
			);
			expect(taskIds).toContain("dependency-audit");
			expect(taskIds).not.toContain("weekly-dependency-audit");
		}
	});

	it("keeps E2E in the full deterministic gate", () => {
		const taskIds = taskSets.full.flatMap((phase) =>
			phase.tasks.map((task) => task.id),
		);

		expect(taskIds).toEqual(
			expect.arrayContaining([
				"all-tests",
				"unit-coverage",
				"e2e-coverage",
				"demo-smoke",
				"dependency-audit",
				"desktop-runtime",
				"desktop-lint",
				"desktop-backend-build",
				"desktop-build",
				"desktop-sidecar-smoke",
				"desktop-packaged-smoke",
			]),
		);
		expect(taskIds).not.toEqual(
			expect.arrayContaining(["live-llm", "live-agent-e2e"]),
		);
		expect(taskSets.full.map((phase) => phase.id)).toEqual(
			expect.arrayContaining(["unit-coverage", "e2e-coverage"]),
		);
		expect(taskIds.indexOf("unit-coverage")).toBeGreaterThan(
			taskIds.indexOf("all-tests"),
		);
		expect(taskIds.indexOf("unit-coverage")).toBeLessThan(
			taskIds.indexOf("e2e-coverage"),
		);
		expect(taskIds).not.toContain("e2e-accessibility");
	});

	it("runs the E2E target without an environment opt-in", () => {
		expect(taskSets.e2e).toHaveLength(1);
		expect(taskSets.e2e[0]?.tasks.map((task) => task.id)).toEqual([
			"e2e-coverage",
		]);
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
			"unit-coverage",
			"e2e-coverage",
			"dependency-audit",
			"desktop-runtime",
			"desktop-lint",
			"desktop-backend-build",
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
			code: task.id === "e2e-coverage" ? 1 : 0,
			duration: "0.1s",
			stdout: "",
			stderr: task.id === "e2e-coverage" ? "failed" : "",
		}));
		const phases = [
			...(taskSets.e2e ?? []),
			...taskSets.release.filter((phase) =>
				["dependency-audit", "desktop-build-smoke"].includes(phase.id),
			),
		];

		const result = await executeVerificationPhases(phases, runner);

		expect(result.failure?.phase.id).toBe("e2e-coverage");
		expect(runner).toHaveBeenCalledTimes(1);
		expect(formatVerificationSummary("release", result.results)).toContain(
			"FAIL",
		);
	});
});
