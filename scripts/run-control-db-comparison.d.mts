export type RunControlDatabaseMetrics = Record<string, string | number | boolean>;

export function parseRunControlComparisonArgs(argv: string[]): {
	baseline: string;
	current: string;
	limit: number;
	json: boolean;
};

export function readRunControlDatabaseMetrics(
	databasePath: string,
	options?: { limit?: number },
): RunControlDatabaseMetrics;

export function compareRunControlMetrics(
	baseline: RunControlDatabaseMetrics,
	current: RunControlDatabaseMetrics,
): Record<
	string,
	{
		baseline: number;
		current: number;
		delta: number;
		deltaPercent: number | null;
	}
>;
