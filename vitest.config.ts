import path from "node:path";
import { defineConfig } from "vitest/config";
import { testDatabasePath } from "./tests/vitest-db-env";
import { coverageExcludes } from "./vitest.coverage";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["./tests/setup-vitest-db.ts"],
		env: {
			NODE_ENV: "test",
			DATABASE_URL: `file:${testDatabasePath}`,
			JWT_SECRET: "nightworkers-vitest-jwt-secret-with-enough-length",
			AUTH_MODE: "local",
			API_AUTH_REQUIRED: "false",
			APP_URL: "http://localhost:39174",
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
			reportsDirectory: "./coverage",
			include: ["api/**/*.ts", "shared/**/*.ts", "src/**/*.ts", "src/**/*.tsx"],
			exclude: coverageExcludes,
		},
		alias: {
			"@": path.resolve(__dirname, "./src"),
			"@api": path.resolve(__dirname, "./api"),
		},
	},
});
