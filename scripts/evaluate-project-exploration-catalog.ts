import { parseArgs } from "node:util";
import {
	measureProjectExplorationRun,
	summarizeProjectExplorationPair,
} from "../api/modules/ontology/exploration/project-exploration-measurement";

async function main(): Promise<number> {
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2).filter((arg) => arg !== "--"),
			options: {
				help: { type: "boolean" },
				"baseline-run-id": { type: "string" },
				"catalog-run-id": { type: "string" },
			},
			strict: true,
			allowPositionals: false,
		});
		if (parsed.values.help) {
			writeJson({
				ok: true,
				usage:
					"bun run scripts/evaluate-project-exploration-catalog.ts -- --baseline-run-id <id> --catalog-run-id <id>",
			});
			return 0;
		}
		const baselineRunId = parsed.values["baseline-run-id"];
		const catalogRunId = parsed.values["catalog-run-id"];
		if (!baselineRunId || !catalogRunId) {
			return fail(
				"invalid_args",
				"--baseline-run-id and --catalog-run-id are required.",
			);
		}
		if (baselineRunId === catalogRunId) {
			return fail("same_run", "Baseline and catalog run IDs must differ.");
		}
		const [repo, eventsRepo, usageRepo] = await Promise.all([
			import("../api/modules/nightworkers/nightworkers.repository"),
			import("../api/modules/nightworkers/nightworkers.runs-event.repository"),
			import("../api/services/llm-usage/repository"),
		]);
		const [baselineRun, catalogRun] = await Promise.all([
			repo.getTaskRun(baselineRunId),
			repo.getTaskRun(catalogRunId),
		]);
		if (!baselineRun || !catalogRun) {
			return fail("run_missing", "One or both run IDs were not found.");
		}
		if (
			!baselineRun.repositoryId ||
			baselineRun.repositoryId !== catalogRun.repositoryId
		) {
			return fail(
				"repository_mismatch",
				"Baseline and catalog runs must use the same repository.",
			);
		}
		const baselineLane = runtimeLane(baselineRun.contextSnapshot);
		const catalogLane = runtimeLane(catalogRun.contextSnapshot);
		if (
			baselineLane !== "native-api-runner" ||
			catalogLane !== "native-api-runner"
		) {
			return fail(
				"runtime_lane_mismatch",
				"Both runs must use the native-api-runner lane.",
			);
		}
		const [baselineEvents, catalogEvents, baselineUsage, catalogUsage] =
			await Promise.all([
				eventsRepo.listTaskEventsForRun(baselineRunId),
				eventsRepo.listTaskEventsForRun(catalogRunId),
				usageRepo.listLlmUsageRecordsForRun(baselineRunId),
				usageRepo.listLlmUsageRecordsForRun(catalogRunId),
			]);
		const baseline = measureProjectExplorationRun({
			run: baselineRun,
			events: baselineEvents,
			usageRecords: baselineUsage,
		});
		const catalog = measureProjectExplorationRun({
			run: catalogRun,
			events: catalogEvents,
			usageRecords: catalogUsage,
		});
		if (baseline.mode !== "baseline" || catalog.mode !== "catalog") {
			return fail(
				"pilot_mode_mismatch",
				"Expected a disabled baseline pin and an available catalog pin.",
			);
		}
		writeJson({
			ok: true,
			baseline,
			catalog,
			comparison: summarizeProjectExplorationPair({ baseline, catalog }),
		});
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.stack ?? error.message : error);
		return fail(
			"evaluation_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}

function runtimeLane(contextSnapshot: unknown): string | null {
	if (
		!contextSnapshot ||
		typeof contextSnapshot !== "object" ||
		Array.isArray(contextSnapshot)
	) {
		return null;
	}
	const value = (contextSnapshot as Record<string, unknown>).runtimeLane;
	return typeof value === "string" ? value : null;
}

function fail(reasonCode: string, message: string): number {
	writeJson({ ok: false, reasonCode, message });
	return 1;
}

function writeJson(payload: unknown) {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
}

process.exitCode = await main();
