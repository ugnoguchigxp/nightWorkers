export const ACTIVE_RUN_HEARTBEAT_INTERVAL_MS = 60_000;
export const ACTIVE_RUN_STALE_AFTER_MS = 180_000;

export function hasFreshActiveRunHeartbeat(
	updatedAt: Date | string | number | null | undefined,
	nowMs = Date.now(),
) {
	if (!updatedAt) return false;
	const timestamp = new Date(updatedAt).getTime();
	return (
		Number.isFinite(timestamp) && nowMs - timestamp < ACTIVE_RUN_STALE_AFTER_MS
	);
}
