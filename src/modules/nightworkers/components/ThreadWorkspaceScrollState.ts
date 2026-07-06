const SCROLL_BOTTOM_LOCK_THRESHOLD = 48;
const SCROLL_STATE_STORAGE_KEY_PREFIX = "nightworkers:thread-scroll:v1:";

export type ScrollSnapshot = {
	scrollTop: number;
	maxScrollTop: number;
	distanceFromBottom: number;
	wasNearBottom: boolean;
};

export type PersistedScrollState =
	| {
			mode: "bottom";
	  }
	| {
			mode: "manual";
			snapshot: ScrollSnapshot;
	  };

function clampScrollTop(value: number, maxScrollTop: number) {
	return Math.max(0, Math.min(value, maxScrollTop));
}

export function createScrollSnapshot(metrics: {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
}): ScrollSnapshot {
	const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
	const scrollTop = clampScrollTop(metrics.scrollTop, maxScrollTop);
	const distanceFromBottom = Math.max(0, maxScrollTop - scrollTop);
	return {
		scrollTop,
		maxScrollTop,
		distanceFromBottom,
		wasNearBottom: distanceFromBottom <= SCROLL_BOTTOM_LOCK_THRESHOLD,
	};
}

export function resolveRestoredScrollTop(
	snapshot: ScrollSnapshot,
	metrics: { scrollHeight: number; clientHeight: number },
) {
	const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
	if (snapshot.wasNearBottom) return maxScrollTop;
	if (snapshot.maxScrollTop <= 0 || maxScrollTop <= 0) return 0;
	const progress = snapshot.scrollTop / snapshot.maxScrollTop;
	return clampScrollTop(Math.round(maxScrollTop * progress), maxScrollTop);
}

export function shouldKeepPendingRestore(
	state: PersistedScrollState,
	metrics: { scrollHeight: number; clientHeight: number },
) {
	if (state.mode === "bottom") return true;
	return (
		metrics.scrollHeight < state.snapshot.maxScrollTop + metrics.clientHeight
	);
}

export function resolveEffectiveScrollState(
	state: PersistedScrollState,
	forceLatestFocus: boolean,
): PersistedScrollState {
	return forceLatestFocus ? { mode: "bottom" } : state;
}

export function buildPersistedScrollState(
	snapshot: ScrollSnapshot,
): PersistedScrollState {
	return snapshot.wasNearBottom
		? { mode: "bottom" }
		: {
				mode: "manual",
				snapshot,
			};
}

function scrollStateStorageKey(sessionId: string) {
	return `${SCROLL_STATE_STORAGE_KEY_PREFIX}${sessionId}`;
}

export function loadPersistedScrollState(
	sessionId: string,
): PersistedScrollState | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(scrollStateStorageKey(sessionId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Record<string, unknown> | null;
		if (!parsed || typeof parsed !== "object") return null;
		if (parsed.mode === "bottom") return { mode: "bottom" };
		const snapshotCandidate =
			parsed.snapshot && typeof parsed.snapshot === "object"
				? (parsed.snapshot as Record<string, unknown>)
				: parsed;
		if (
			typeof snapshotCandidate.scrollTop !== "number" ||
			typeof snapshotCandidate.maxScrollTop !== "number" ||
			typeof snapshotCandidate.distanceFromBottom !== "number" ||
			typeof snapshotCandidate.wasNearBottom !== "boolean"
		) {
			return { mode: "bottom" };
		}
		const snapshot: ScrollSnapshot = {
			scrollTop: snapshotCandidate.scrollTop,
			maxScrollTop: snapshotCandidate.maxScrollTop,
			distanceFromBottom: snapshotCandidate.distanceFromBottom,
			wasNearBottom: snapshotCandidate.wasNearBottom,
		};
		return {
			mode: snapshot.wasNearBottom ? "bottom" : "manual",
			snapshot,
		};
	} catch {
		return null;
	}
}

export function persistScrollState(
	sessionId: string,
	state: PersistedScrollState,
) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(
		scrollStateStorageKey(sessionId),
		JSON.stringify(state),
	);
}

export function readScrollSnapshot(element: HTMLDivElement): ScrollSnapshot {
	return createScrollSnapshot({
		scrollTop: element.scrollTop,
		scrollHeight: element.scrollHeight,
		clientHeight: element.clientHeight,
	});
}

export function restoreScrollState(
	element: HTMLDivElement,
	state: PersistedScrollState,
) {
	const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
	if (state.mode === "bottom") {
		element.scrollTop = maxScrollTop;
		return;
	}
	element.scrollTop = resolveRestoredScrollTop(state.snapshot, {
		scrollHeight: element.scrollHeight,
		clientHeight: element.clientHeight,
	});
}
