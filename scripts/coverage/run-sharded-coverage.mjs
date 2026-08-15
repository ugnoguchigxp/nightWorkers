import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	findAddedGitEntries,
	findRemovedGitEntries,
	readGitWorktreePaths,
	readNightWorkersBranchRefs,
} from "../git-worktree-leak-guard.mjs";

const require = createRequire(import.meta.url);
const { createCoverageMap } = require("istanbul-lib-coverage");
const { createContext } = require("istanbul-lib-report");
const reports = require("istanbul-reports");

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const coverageRoot = path.join(repositoryRoot, "coverage");
const segmentConfigs = {
	backend: {
		config: "vitest.backend.config.ts",
		output: path.join(coverageRoot, "backend"),
	},
	frontend: {
		config: "vitest.frontend.config.ts",
		output: path.join(coverageRoot, "frontend"),
	},
};

export function resolveCoverageShardCount(
	value = process.env.NIGHTWORKERS_COVERAGE_SHARDS,
	parallelism = availableParallelism(),
) {
	if (value === undefined || value.trim() === "") {
		return Math.max(1, Math.min(3, parallelism));
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
		throw new Error(
			`NIGHTWORKERS_COVERAGE_SHARDS must be an integer from 1 to 8, received: ${value}`,
		);
	}
	return parsed;
}

export function mergeCoverageShardReports(input) {
	const { shardDirectories, outputDirectory } = input;
	if (!Array.isArray(shardDirectories) || shardDirectories.length === 0) {
		throw new Error("At least one coverage shard report is required.");
	}
	const coverageMap = createCoverageMap({});
	for (const directory of shardDirectories) {
		const reportPath = path.join(directory, "coverage-final.json");
		if (!fs.existsSync(reportPath)) {
			throw new Error(`Coverage shard report is missing: ${reportPath}`);
		}
		coverageMap.merge(JSON.parse(fs.readFileSync(reportPath, "utf8")));
	}
	fs.rmSync(outputDirectory, { recursive: true, force: true });
	fs.mkdirSync(outputDirectory, { recursive: true });
	const context = createContext({
		dir: outputDirectory,
		coverageMap,
		defaultSummarizer: "nested",
	});
	for (const reporter of [
		"json",
		"json-summary",
		"lcov",
		"html",
		"text-summary",
	]) {
		reports.create(reporter).execute(context);
	}
	return coverageMap.getCoverageSummary().toJSON();
}

async function runCoverageSegment(segment) {
	const config = segmentConfigs[segment];
	if (!config) {
		throw new Error(
			`Coverage segment must be one of: ${Object.keys(segmentConfigs).join(", ")}`,
		);
	}
	const shardCount = resolveCoverageShardCount();
	const timeoutMs = resolveCoverageShardTimeoutMs(
		process.env.NIGHTWORKERS_COVERAGE_SHARD_TIMEOUT_MS,
	);
	const shardRoot = path.join(coverageRoot, ".shards", segment);
	const shardDirectories = Array.from({ length: shardCount }, (_value, index) =>
		path.join(shardRoot, String(index + 1)),
	);
	fs.rmSync(shardRoot, { recursive: true, force: true });
	fs.mkdirSync(shardRoot, { recursive: true });

	const gitStateBefore = readGitState();
	process.stdout.write(
		`[coverage] ${segment}: starting ${shardCount} isolated shards\n`,
	);
	const results = await Promise.allSettled(
		shardDirectories.map((directory, index) =>
			runShard({
				segment,
				config: config.config,
				index: index + 1,
				count: shardCount,
				reportsDirectory: directory,
				timeoutMs,
			}),
		),
	);
	const gitLeakError = describeCoverageGitLeak(gitStateBefore, readGitState());
	const failures = results.flatMap((result) =>
		result.status === "rejected" ? [String(result.reason)] : [],
	);
	if (gitLeakError) failures.push(gitLeakError);
	if (failures.length > 0) {
		throw new Error(
			`${segment} coverage failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
		);
	}

	const summary = mergeCoverageShardReports({
		shardDirectories,
		outputDirectory: config.output,
	});
	fs.rmSync(shardRoot, { recursive: true, force: true });
	process.stdout.write(
		`[coverage] ${segment}: merged ${shardCount} shards (${JSON.stringify(summary)})\n`,
	);
}

function runShard(input) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[
				path.join(repositoryRoot, "scripts", "run-vitest.mjs"),
				"run",
				"--config",
				input.config,
				"--coverage",
				`--shard=${input.index}/${input.count}`,
			],
			{
				cwd: repositoryRoot,
				env: {
					...process.env,
					NIGHTWORKERS_COVERAGE_SHARD_REPORTS_DIR: input.reportsDirectory,
					NIGHTWORKERS_VITEST_GIT_GUARD_OWNER_PID: String(process.pid),
				},
				stdio: "inherit",
			},
		);
		let timedOut = false;
		let forceKillTimer = null;
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
			forceKillTimer.unref();
		}, input.timeoutMs);
		child.once("error", (error) => {
			clearTimeout(timeout);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			reject(error);
		});
		child.once("close", (code, signal) => {
			clearTimeout(timeout);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			if (timedOut) {
				reject(
					new Error(
						`${input.segment} shard ${input.index}/${input.count} exceeded ${input.timeoutMs}ms`,
					),
				);
				return;
			}
			if (code !== 0) {
				reject(
					new Error(
						`${input.segment} shard ${input.index}/${input.count} exited with ${code ?? signal ?? "unknown"}`,
					),
				);
				return;
			}
			resolve();
		});
	});
}

export function resolveCoverageShardTimeoutMs(value) {
	if (value === undefined || value.trim() === "") return 10 * 60 * 1_000;
	const parsed = Number(value);
	if (
		!Number.isInteger(parsed) ||
		parsed < 30_000 ||
		parsed > 60 * 60 * 1_000
	) {
		throw new Error(
			`NIGHTWORKERS_COVERAGE_SHARD_TIMEOUT_MS must be an integer from 30000 to 3600000, received: ${value}`,
		);
	}
	return parsed;
}

function readGitState() {
	return {
		worktrees: readGitWorktreePaths(repositoryRoot),
		branches: readNightWorkersBranchRefs(repositoryRoot),
	};
}

export function describeCoverageGitLeak(before, after) {
	const changes = {
		addedWorktrees: findAddedGitEntries(before.worktrees, after.worktrees),
		addedBranches: findAddedGitEntries(before.branches, after.branches),
		removedWorktrees: findRemovedGitEntries(before.worktrees, after.worktrees),
		removedBranches: findRemovedGitEntries(before.branches, after.branches),
	};
	if (Object.values(changes).every((entries) => entries.length === 0)) {
		return null;
	}
	return `Git leakage detected after coverage shards: ${JSON.stringify(changes)}`;
}

async function main() {
	const segment = process.argv[2];
	await runCoverageSegment(segment);
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	main().catch((error) => {
		console.error(
			error instanceof Error ? (error.stack ?? error.message) : error,
		);
		process.exitCode = 1;
	});
}
