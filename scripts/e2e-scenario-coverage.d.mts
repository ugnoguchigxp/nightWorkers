export type E2eCoverageInput = {
	catalog: unknown;
	report: unknown;
	playwrightExitCode?: number;
	now?: Date;
};

export type E2eCoverageResult = {
	version: 1;
	generatedAt: string;
	catalogVersion: unknown;
	playwrightExitCode: number;
	passed: boolean;
	thresholds: Record<string, unknown>;
	thresholdResults: Record<string, boolean>;
	summary: {
		requiredScenarios: number;
		automatedScenarios: number;
		passedScenarios: number;
		p0Coverage: number;
		weightedCoverage: number;
		executedPassRate: number;
		p0Flakes: number;
		plannedScenarios: number;
	};
	scenarios: unknown[];
	uncovered: string[];
	planned: unknown[];
	issues: Array<{ code: string; message: string }>;
};

export function validateE2eScenarioCatalog(catalog: unknown): {
	errors: string[];
	scenarios: unknown[];
};

export function evaluateE2eScenarioCoverage(
	input: E2eCoverageInput,
): E2eCoverageResult;
