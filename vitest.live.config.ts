import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		env: {
			NODE_ENV: "test",
			NIGHTWORKERS_DESKTOP: "0",
		},
		fileParallelism: false,
		include: ["tests/live/**/*.{test,spec}.{ts,tsx}"],
		alias: {
			"@nightworkers/mission-pilot/backend": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/backend/index.ts",
			),
			"@nightworkers/mission-pilot/contracts": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/contracts/index.ts",
			),
			"@nightworkers/mission-pilot/testing": path.resolve(
				__dirname,
				"./packages/mission-pilot/src/testing/index.ts",
			),
		},
	},
});
