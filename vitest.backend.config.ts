import path from "node:path";
import { defineConfig } from "vitest/config";
import { testDatabasePath } from "./tests/vitest-db-env";
import { backendCoverage } from "./vitest.coverage";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 20_000,
		hookTimeout: 20_000,
		setupFiles: ["./tests/setup-vitest-db.ts"],
		env: {
			NODE_ENV: "test",
			DATABASE_URL: `file:${testDatabasePath}`,
			CORS_ORIGIN: "http://localhost:39174",
			NIGHTWORKERS_DESKTOP: "0",
			NIGHTWORKERS_SQLITE_BUSY_RETRY_PROFILE: "coverage",
		},
		fileParallelism: false,
		globalSetup: ["./tests/global-cleanup-after-tests.ts"],
		include: ["tests/**/*.{test,spec}.{ts,tsx}"],
		exclude: ["tests/e2e/**", "tests/live/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov", "json-summary"],
			reportsDirectory: backendCoverage.reportsDirectory,
			include: backendCoverage.include,
			exclude: backendCoverage.exclude,
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
		},
	},
});
