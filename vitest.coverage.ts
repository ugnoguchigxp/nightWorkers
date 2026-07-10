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

export const backendCoverage = {
	include: ["api/**/*.ts", "shared/**/*.ts"],
	exclude: coverageExcludes,
	reportsDirectory: "./coverage-backend",
};

export const frontendCoverage = {
	include: ["src/**/*.ts", "src/**/*.tsx"],
	exclude: coverageExcludes,
	reportsDirectory: "./coverage-frontend",
};
