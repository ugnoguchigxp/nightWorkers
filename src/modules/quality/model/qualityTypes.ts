export type CoverageAxis = { labelKey: string; value: number };

export type E2EResultRow = {
	suite: string;
	status: string;
	tests: string;
	duration: string;
	lastFailure: string;
};
