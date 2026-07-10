const SQLITE_BUSY_RETRY_DELAYS_MS = [25, 75, 150, 300, 600];
const SQLITE_BUSY_COVERAGE_RETRY_DELAYS_MS = [
	50, 100, 250, 500, 1_000, 2_000, 4_000,
];

function retryDelays() {
	return process.env.NIGHTWORKERS_SQLITE_BUSY_RETRY_PROFILE === "coverage"
		? SQLITE_BUSY_COVERAGE_RETRY_DELAYS_MS
		: SQLITE_BUSY_RETRY_DELAYS_MS;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isSqliteBusyError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("SQLITE_BUSY") ||
		message.includes("database is locked") ||
		message.includes("cannot commit transaction")
	);
}

export async function withSqliteBusyRetry<T>(
	operation: () => Promise<T>,
): Promise<T> {
	const delays = retryDelays();
	let lastError: unknown;
	for (let attempt = 0; attempt <= delays.length; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (!isSqliteBusyError(error) || attempt === delays.length) {
				throw error;
			}
			await sleep(delays[attempt]);
		}
	}
	throw lastError;
}
