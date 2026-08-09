import crypto from "node:crypto";
import path from "node:path";
import type {
	SecurityScanSelection,
	SecurityScanTarget,
} from "../../../shared/schemas/security-scan.schema";
import { AppError } from "../../lib/errors";

type LocalCliPreviewRecord = {
	projectPath: string;
	selection: string;
	target: string;
	digest: string;
	resolvedProfileRef: string;
	timeoutSeconds: number;
	totalSteps: number;
	expiresAt: number;
};

const previews = new Map<string, LocalCliPreviewRecord>();
const activeJobs = new Map<string, AbortController>();
const mutationQueues = new Map<string, Promise<void>>();
let startQueue: Promise<void> = Promise.resolve();

export function registerLocalCliPreview(input: {
	projectPath: string;
	selection: SecurityScanSelection;
	target: SecurityScanTarget;
	digest: string;
	resolvedProfileRef: string;
	timeoutSeconds: number;
	totalSteps: number;
	ttlMs: number;
}) {
	pruneExpiredPreviews();
	const previewRef = crypto.randomUUID();
	const expiresAt = Date.now() + input.ttlMs;
	previews.set(previewRef, {
		projectPath: path.resolve(input.projectPath),
		selection: JSON.stringify(input.selection),
		target: JSON.stringify(input.target),
		digest: input.digest,
		resolvedProfileRef: input.resolvedProfileRef,
		timeoutSeconds: input.timeoutSeconds,
		totalSteps: input.totalSteps,
		expiresAt,
	});
	return { previewRef, expiresAt };
}

export function requireLocalCliPreview(input: {
	previewRef: string;
	projectPath: string;
	selection: SecurityScanSelection;
	target: SecurityScanTarget;
	expectedTargetDigest: string;
}) {
	pruneExpiredPreviews();
	const preview = previews.get(input.previewRef);
	if (!preview) {
		throw new AppError(
			409,
			"SECURITY_SCAN_PREVIEW_EXPIRED",
			"スキャンのプレビューが期限切れです。もう一度実行内容を確認してください。",
		);
	}
	const matches =
		preview.projectPath === path.resolve(input.projectPath) &&
		preview.selection === JSON.stringify(input.selection) &&
		preview.target === JSON.stringify(input.target) &&
		preview.digest === input.expectedTargetDigest;
	if (!matches) {
		throw new AppError(
			409,
			"SECURITY_SCAN_PREVIEW_MISMATCH",
			"プレビューとスキャン条件が一致しません。もう一度実行内容を確認してください。",
		);
	}
	return preview;
}

export function consumeLocalCliPreview(previewRef: string) {
	previews.delete(previewRef);
}

export function serializeLocalCliStart<T>(operation: () => Promise<T>) {
	const result = startQueue.then(operation);
	startQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

export function localCliActiveJobCount() {
	return activeJobs.size;
}

export function setLocalCliActiveJob(
	scanRunRef: string,
	controller: AbortController,
) {
	activeJobs.set(scanRunRef, controller);
}

export function getLocalCliActiveJob(scanRunRef: string) {
	return activeJobs.get(scanRunRef);
}

export function hasLocalCliActiveJob(scanRunRef: string) {
	return activeJobs.has(scanRunRef);
}

export function deleteLocalCliActiveJob(scanRunRef: string) {
	activeJobs.delete(scanRunRef);
}

export function withLocalCliScanMutation<T>(
	scanRunRef: string,
	operation: () => Promise<T>,
) {
	const previous = mutationQueues.get(scanRunRef) ?? Promise.resolve();
	const result = previous.then(operation);
	const settled = result.then(
		() => undefined,
		() => undefined,
	);
	mutationQueues.set(scanRunRef, settled);
	void settled.then(() => {
		if (mutationQueues.get(scanRunRef) === settled) {
			mutationQueues.delete(scanRunRef);
		}
	});
	return result;
}

function pruneExpiredPreviews() {
	const now = Date.now();
	for (const [previewRef, preview] of previews) {
		if (preview.expiresAt <= now) previews.delete(previewRef);
	}
}
