import path from "node:path";
import { defineConfig } from "vitest/config";
import { testDatabasePath } from "./tests/vitest-db-env";
import { coverageExcludes, coverageReportPaths } from "./vitest.coverage";

process.env.NIGHTWORKERS_VITEST_DB_PATH ??= testDatabasePath;

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["./tests/setup-vitest-db.ts"],
		env: {
			NODE_ENV: "test",
			NIGHTWORKERS_DATABASE_ACCESS_SCOPE: "isolated_test",
			DATABASE_URL: `file:${testDatabasePath}`,
			NIGHTWORKERS_VITEST_DB_PATH: testDatabasePath,
			CORS_ORIGIN: "http://localhost:39174",
			NIGHTWORKERS_DESKTOP: "0",
		},
		fileParallelism: false,
		globalSetup: ["./tests/global-cleanup-after-tests.ts"],
		include: ["tests/**/*.{test,spec}.{ts,tsx}"],
		exclude: ["tests/e2e/**", "tests/live/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov", "json-summary"],
			reportsDirectory: `./${coverageReportPaths.root}`,
			include: ["api/**/*.ts", "shared/**/*.ts", "src/**/*.ts", "src/**/*.tsx"],
			exclude: coverageExcludes,
		},
		alias: {
			"@": path.resolve(__dirname, "./src"),
			"@api": path.resolve(__dirname, "./api"),
			"@nightworkers/mission-pilot/backend": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/backend/index.ts",
			),
			"@nightworkers/mission-pilot/contracts": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/contracts/index.ts",
			),
			"@nightworkers/mission-pilot/frontend": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/frontend/index.ts",
			),
			"@nightworkers/mission-pilot/i18n": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/frontend/i18n/index.ts",
			),
			"@nightworkers/mission-pilot/testing": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/testing/index.ts",
			),
			"@nightworkers/mission-pilot/frontend.css": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/frontend/styles.css",
			),
		},
	},
});
