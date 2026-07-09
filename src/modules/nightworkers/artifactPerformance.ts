import type { WorkbenchArtifactRef } from "./types";

const artifactPerfStorageKey = "nightworkers.artifactPerf";

type PendingArtifactOpen = {
	id: string;
	kind: WorkbenchArtifactRef["kind"];
	title: string;
	startedAt: number;
};

let pendingArtifactOpen: PendingArtifactOpen | null = null;

export function isArtifactPerfLoggingEnabled() {
	if (typeof window === "undefined") return false;
	try {
		return window.localStorage.getItem(artifactPerfStorageKey) === "1";
	} catch {
		return false;
	}
}

export function markArtifactOpenStart(artifact: WorkbenchArtifactRef) {
	if (!isArtifactPerfLoggingEnabled()) return;
	pendingArtifactOpen = {
		id: artifact.id,
		kind: artifact.kind,
		title: artifact.title,
		startedAt: nowMs(),
	};
}

export function logArtifactPaneRendered(
	artifact: WorkbenchArtifactRef | null,
	metrics: {
		activityArtifactCount: number;
		artifactVersionCount: number;
		taskMessageCount: number;
	},
) {
	if (!artifact || !isArtifactPerfLoggingEnabled()) return;
	const now = nowMs();
	const pending =
		pendingArtifactOpen?.id === artifact.id ? pendingArtifactOpen : null;
	console.info("[nightworkers:artifact-perf]", {
		artifactId: artifact.id,
		kind: artifact.kind,
		title: artifact.title,
		openToPaneMs: pending ? Math.round(now - pending.startedAt) : null,
		...metrics,
	});
	if (pending) pendingArtifactOpen = null;
}

export function measureArtifactPerf<T>(
	label: string,
	fn: () => T,
	metadata?: Record<string, unknown>,
): T {
	if (!isArtifactPerfLoggingEnabled()) return fn();
	const startedAt = nowMs();
	const result = fn();
	const durationMs = Math.round((nowMs() - startedAt) * 100) / 100;
	console.info("[nightworkers:artifact-perf]", {
		label,
		durationMs,
		...metadata,
	});
	return result;
}

export function logArtifactPerf(
	label: string,
	metadata?: Record<string, unknown>,
) {
	if (!isArtifactPerfLoggingEnabled()) return;
	console.info("[nightworkers:artifact-perf]", {
		label,
		...metadata,
	});
}

function nowMs() {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}
