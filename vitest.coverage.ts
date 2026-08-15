import path from "node:path";

export const coverageExclusionReasons = {
	generated: ["**/*.d.ts", "api/db/schema.ts", "src/routeTree.gen.ts"],
	entrypoint: ["api/index.ts", "src/main.tsx"],
	sideEffectBoundary: [
		"api/scripts/**",
		"api/db/seed.ts",
		"api/db/migrations/**",
		"src/mocks/**",
	],
	testAndBuildOutput: [
		"**/*.test.{ts,tsx}",
		"**/*.spec.{ts,tsx}",
		"tests/**",
		"scripts/**",
		"dist/**",
		"dist-api/**",
		"dist-api-desktop/**",
		"node_modules/**",
	],
} as const;

export const coverageExcludes = Object.values(coverageExclusionReasons).flat();

export const coverageReportPaths = {
	root: "coverage",
	backend: "coverage/backend",
	frontend: "coverage/frontend",
} as const;

export const backendCoverage = {
	include: ["api/**/*.ts", "shared/**/*.ts"],
	exclude: coverageExcludes,
	reportsDirectory: `./${coverageReportPaths.backend}`,
};

export const frontendCoverage = {
	include: ["src/**/*.ts", "src/**/*.tsx"],
	exclude: coverageExcludes,
	reportsDirectory: `./${coverageReportPaths.frontend}`,
};

export function resolveCoverageRuntime(defaultReportsDirectory: string): {
	reportsDirectory: string;
	reporter: Array<"text" | "html" | "lcov" | "json" | "json-summary">;
} {
	const shardReportsDirectory =
		process.env.NIGHTWORKERS_COVERAGE_SHARD_REPORTS_DIR?.trim();
	if (!shardReportsDirectory) {
		return {
			reportsDirectory: defaultReportsDirectory,
			reporter: ["text", "html", "lcov", "json-summary"],
		};
	}
	const resolved = path.resolve(shardReportsDirectory);
	const shardRoot = path.resolve(coverageReportPaths.root, ".shards");
	const relative = path.relative(shardRoot, resolved);
	if (
		!relative ||
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new Error("Coverage shard reports must stay under coverage/.shards.");
	}
	return { reportsDirectory: resolved, reporter: ["json"] };
}
