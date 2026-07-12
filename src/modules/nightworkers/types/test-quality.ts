export type TestQualitySettings = {
	coverageGateEnabled: boolean;
	coverageMinimumPercent: number;
	coverageMaxIterations: number;
};

export const defaultTestQualitySettings: TestQualitySettings = {
	coverageGateEnabled: false,
	coverageMinimumPercent: 80,
	coverageMaxIterations: 5,
};

