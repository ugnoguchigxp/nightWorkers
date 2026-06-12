const SQLITE_BUSY_RETRY_DELAYS_MS = [25, 75, 150, 300, 600];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isSqliteBusyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('SQLITE_BUSY') ||
    message.includes('database is locked') ||
    message.includes('cannot commit transaction')
  );
}

export async function withSqliteBusyRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SQLITE_BUSY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSqliteBusyError(error) || attempt === SQLITE_BUSY_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await sleep(SQLITE_BUSY_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}
