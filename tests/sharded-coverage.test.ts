import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertCoverageScope,
	coverageSegmentFor,
	coverageSourceRoots,
} from "../scripts/coverage/coverage-scope.mjs";
import {
	describeCoverageGitLeak,
	mergeCoverageShardReports,
	resolveCoverageShardCount,
	resolveCoverageShardTimeoutMs,
} from "../scripts/coverage/run-sharded-coverage.mjs";
import { resolveCoverageRuntime } from "../vitest.coverage";

let temporaryRoot: string | null = null;
const originalShardDirectory =
	process.env.NIGHTWORKERS_COVERAGE_SHARD_REPORTS_DIR;

afterEach(() => {
	if (temporaryRoot) {
		fs.rmSync(temporaryRoot, { recursive: true, force: true });
		temporaryRoot = null;
	}
	if (originalShardDirectory === undefined) {
		delete process.env.NIGHTWORKERS_COVERAGE_SHARD_REPORTS_DIR;
	} else {
		process.env.NIGHTWORKERS_COVERAGE_SHARD_REPORTS_DIR =
			originalShardDirectory;
	}
});

describe("sharded coverage execution", () => {
	it("partitions one run without dropping Mission Pilot or double counting sources", () => {
		const root = path.resolve("/workspace/nightworkers");
		const files = Object.values(coverageSourceRoots)
			.flat()
			.map((directory) => path.join(root, directory, "feature.ts"));
		for (const segment of ["backend", "frontend"]) {
			const selected = files.filter(
				(file) => coverageSegmentFor(file, root) === segment,
			);
			expect(() => assertCoverageScope(selected, root, segment)).not.toThrow();
			expect(() =>
				assertCoverageScope(
					selected.filter((file) => !file.includes("mission-pilot")),
					root,
					segment,
				),
			).toThrow("Coverage is missing production roots");
		}
		expect(
			coverageSegmentFor(path.join(root, "api-extra", "file.ts"), root),
		).toBeNull();
		expect(
			coverageSegmentFor(path.join(root, "..", "api", "file.ts"), root),
		).toBeNull();
	});

	it("writes disjoint reports from the same shard input", () => {
		temporaryRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-coverage-partition-"),
		);
		const shard = path.join(temporaryRoot, "shard");
		fs.mkdirSync(shard);
		const entries = Object.entries(coverageSourceRoots).flatMap(
			([segment, roots]) =>
				roots.map((directory) => ({
					segment,
					file: path.join(shard, "..", directory, "feature.ts"),
				})),
		);
		fs.writeFileSync(
			path.join(shard, "coverage-final.json"),
			JSON.stringify(
				Object.assign({}, ...entries.map(({ file }) => fileCoverage(file, 1))),
			),
		);
		for (const segment of ["backend", "frontend"]) {
			const outputDirectory = path.join(temporaryRoot, segment);
			mergeCoverageShardReports({
				shardDirectories: [shard],
				outputDirectory,
				segment,
				repositoryRoot: temporaryRoot,
			});
			const report = JSON.parse(
				fs.readFileSync(
					path.join(outputDirectory, "coverage-final.json"),
					"utf8",
				),
			);
			expect(Object.keys(report).sort()).toEqual(
				entries
					.filter((entry) => entry.segment === segment)
					.map((entry) => entry.file)
					.sort(),
			);
		}
	});
	it("uses a bounded default and validates explicit shard counts", () => {
		expect(resolveCoverageShardCount(undefined, 1)).toBe(1);
		expect(resolveCoverageShardCount(undefined, 16)).toBe(3);
		expect(resolveCoverageShardCount("4", 1)).toBe(4);
		expect(() => resolveCoverageShardCount("0", 8)).toThrow(
			"must be an integer from 1 to 8",
		);
		expect(() => resolveCoverageShardCount("9", 8)).toThrow(
			"must be an integer from 1 to 8",
		);
	});

	it("keeps every shard timeout finite and rejects invalid values", () => {
		expect(resolveCoverageShardTimeoutMs(undefined)).toBe(600_000);
		expect(resolveCoverageShardTimeoutMs("30000")).toBe(30_000);
		expect(() => resolveCoverageShardTimeoutMs("29999")).toThrow(
			"must be an integer from 30000 to 3600000",
		);
		expect(() => resolveCoverageShardTimeoutMs("not-a-number")).toThrow(
			"must be an integer from 30000 to 3600000",
		);
		expect(() => resolveCoverageShardTimeoutMs("3600001")).toThrow(
			"must be an integer from 30000 to 3600000",
		);
	});

	it("reports added and removed worktrees and NightWorkers branches", () => {
		const before = {
			worktrees: ["/workspace/main", "/workspace/removed"],
			branches: ["refs/heads/nightworkers/existing"],
		};
		expect(describeCoverageGitLeak(before, before)).toBeNull();

		const leak = describeCoverageGitLeak(before, {
			worktrees: ["/workspace/main", "/workspace/added"],
			branches: ["refs/heads/nightworkers/added"],
		});

		expect(leak).toContain('"addedWorktrees":["/workspace/added"]');
		expect(leak).toContain('"addedBranches":["refs/heads/nightworkers/added"]');
		expect(leak).toContain('"removedWorktrees":["/workspace/removed"]');
		expect(leak).toContain(
			'"removedBranches":["refs/heads/nightworkers/existing"]',
		);
	});

	it("merges raw shard maps into the standard report contract", () => {
		temporaryRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-sharded-coverage-"),
		);
		const first = path.join(temporaryRoot, "first");
		const second = path.join(temporaryRoot, "second");
		const output = path.join(temporaryRoot, "merged");
		const source = path.join(temporaryRoot, "source.ts");
		fs.mkdirSync(first, { recursive: true });
		fs.mkdirSync(second, { recursive: true });
		fs.writeFileSync(
			path.join(first, "coverage-final.json"),
			JSON.stringify(fileCoverage(source, 0)),
		);
		fs.writeFileSync(
			path.join(second, "coverage-final.json"),
			JSON.stringify(fileCoverage(source, 1)),
		);

		const summary = mergeCoverageShardReports({
			shardDirectories: [first, second],
			outputDirectory: output,
		});

		expect(summary.statements).toMatchObject({
			total: 1,
			covered: 1,
			pct: 100,
		});
		expect(
			JSON.parse(
				fs.readFileSync(path.join(output, "coverage-summary.json"), "utf8"),
			).total.statements,
		).toMatchObject({ total: 1, covered: 1, pct: 100 });
		expect(fs.existsSync(path.join(output, "lcov.info"))).toBe(true);
	});

	it("only permits raw shard reports under the generated coverage root", () => {
		delete process.env.NIGHTWORKERS_COVERAGE_SHARD_REPORTS_DIR;
		expect(resolveCoverageRuntime("./coverage/backend")).toEqual({
			reportsDirectory: "./coverage/backend",
			reporter: ["text", "html", "lcov", "json-summary"],
		});
		process.env.NIGHTWORKERS_COVERAGE_SHARD_REPORTS_DIR = path.join(
			process.cwd(),
			"coverage",
			".shards",
			"backend",
			"1",
		);
		expect(resolveCoverageRuntime("./coverage/backend")).toMatchObject({
			reporter: ["json"],
		});
		process.env.NIGHTWORKERS_COVERAGE_SHARD_REPORTS_DIR = path.join(
			os.tmpdir(),
			"outside-coverage",
		);
		expect(() => resolveCoverageRuntime("./coverage/backend")).toThrow(
			"must stay under coverage/.shards",
		);
	});
});

function fileCoverage(source: string, count: number) {
	return {
		[source]: {
			path: source,
			statementMap: {
				0: {
					start: { line: 1, column: 0 },
					end: { line: 1, column: 1 },
				},
			},
			fnMap: {},
			branchMap: {},
			s: { 0: count },
			f: {},
			b: {},
		},
	};
}
