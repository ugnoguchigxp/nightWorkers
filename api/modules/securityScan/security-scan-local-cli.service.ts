import crypto from "node:crypto";
import path from "node:path";
import type {
	SecurityScanCapabilities,
	SecurityScanPreview,
	SecurityScanSelection,
	SecurityScanStartResponse,
	SecurityScanTarget,
} from "../../../shared/schemas/security-scan.schema";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import {
	readVulnWorkbenchCliSettings,
	runVulnWorkbenchSecurityDiagnostic,
} from "../review/review-vulnworkbench.service";
import {
	loadVulnWorkbenchCliCapabilities,
	loadVulnWorkbenchCliDiffPreview,
	loadVulnWorkbenchCliProfilePlan,
} from "./security-scan-local-cli-command";
import {
	localCliFailureAfterRestart,
	localCliStartResponse,
	persistLocalCliCancelled,
	persistLocalCliFailure,
	persistLocalCliResult,
} from "./security-scan-local-cli-result";
import {
	consumeLocalCliPreview,
	deleteLocalCliActiveJob,
	hasLocalCliActiveJob,
	localCliActiveJobCount,
	registerLocalCliPreview,
	requireLocalCliPreview,
	serializeLocalCliStart,
	setLocalCliActiveJob,
	withLocalCliScanMutation,
} from "./security-scan-local-cli-runtime";
import {
	captureLocalCliTarget,
	localCliDiffWarnings,
	localCliToolSteps,
	requireLocalCliProject,
	resolveLocalCliSelection,
} from "./security-scan-local-cli-snapshot";
import {
	findLocalScanRecordByIdempotency,
	type LocalScanRecord,
	localScanRecordPath,
	readLocalScanRecord,
	requireLocalScanRecord,
	writeLocalScanRecord,
} from "./security-scan-local-cli-storage";

const LOCAL_PREVIEW_TTL_MS = 5 * 60 * 1000;

export {
	localCliCancel,
	localCliFindings,
	localCliReportContent,
	localCliReports,
	localCliScanDetail,
	localCliStartReport,
} from "./security-scan-local-cli-access";

export async function localCliCapabilities(
	projectPath: string,
): Promise<SecurityScanCapabilities> {
	await requireLocalCliProject(projectPath);
	return await loadVulnWorkbenchCliCapabilities(
		projectPath,
		readVulnWorkbenchCliSettings(),
	);
}

export async function localCliPreview(
	projectPath: string,
	selection: SecurityScanSelection,
	target: SecurityScanTarget,
): Promise<SecurityScanPreview> {
	await requireLocalCliProject(projectPath);
	const settings = readVulnWorkbenchCliSettings();
	const capabilities = await loadVulnWorkbenchCliCapabilities(
		projectPath,
		settings,
	);
	const resolved = resolveLocalCliSelection(capabilities, selection, target);
	const plan = await loadVulnWorkbenchCliProfilePlan(
		resolved.profileRef,
		target.kind,
		settings,
	);
	const diffPreview =
		target.kind === "working_tree"
			? await loadVulnWorkbenchCliDiffPreview(
					projectPath,
					resolved.profileRef,
					settings,
				)
			: null;
	const fullSnapshot =
		target.kind === "full" ? await captureLocalCliTarget(projectPath) : null;
	const digest = fullSnapshot?.digest ?? diffPreview?.target.targetDigest ?? "";
	const maxStepTimeout = Math.max(
		1,
		...plan.resolvedSteps.map((step) => step.timeoutSec),
	);
	const estimatedDurationSeconds = resolved.estimatedDurationSeconds ?? {
		min: Math.max(1, Math.floor(maxStepTimeout / 6)),
		max: maxStepTimeout,
	};
	const registered = registerLocalCliPreview({
		projectPath,
		selection,
		target,
		digest,
		resolvedProfileRef: resolved.profileRef,
		timeoutSeconds: Math.max(
			settings.timeoutSeconds,
			estimatedDurationSeconds.max + 60,
		),
		totalSteps: plan.resolvedSteps.length,
		ttlMs: LOCAL_PREVIEW_TTL_MS,
	});
	return {
		previewRef: registered.previewRef,
		resolvedProfileRef: resolved.profileRef,
		target: {
			kind: target.kind,
			digest,
			sourceRevision:
				fullSnapshot?.gitHead ?? diffPreview?.target.baseSha ?? null,
			fileCount:
				fullSnapshot?.fileCount ?? diffPreview?.target.changedFileCount ?? null,
		},
		estimatedDurationSeconds,
		toolSteps: localCliToolSteps(plan, diffPreview),
		warnings: [
			...new Set([...resolved.warnings, ...localCliDiffWarnings(diffPreview)]),
		],
		expiresAt: new Date(registered.expiresAt).toISOString(),
	};
}

export function localCliStartScan(
	projectPath: string,
	input: {
		previewRef: string;
		selection: SecurityScanSelection;
		target: SecurityScanTarget;
		expectedTargetDigest: string;
	},
	idempotencyKey: string,
): Promise<SecurityScanStartResponse> {
	return serializeLocalCliStart(() =>
		startLocalCliScan(projectPath, input, idempotencyKey),
	);
}

async function startLocalCliScan(
	projectPath: string,
	input: {
		previewRef: string;
		selection: SecurityScanSelection;
		target: SecurityScanTarget;
		expectedTargetDigest: string;
	},
	idempotencyKey: string,
): Promise<SecurityScanStartResponse> {
	await requireLocalCliProject(projectPath);
	let replay = await findLocalScanRecordByIdempotency(
		projectPath,
		idempotencyKey,
	);
	if (replay) {
		requireMatchingReplay(replay, input);
		if (
			["queued", "running"].includes(replay.detail.status) &&
			!hasLocalCliActiveJob(replay.detail.scanRunRef)
		) {
			replay = localCliFailureAfterRestart(replay);
			await writeLocalScanRecord(replay);
		}
		return localCliStartResponse(replay.detail, true);
	}
	const preview = requireLocalCliPreview({ projectPath, ...input });
	if (localCliActiveJobCount() >= 1) {
		throw new AppError(
			429,
			"SECURITY_SCAN_LOCAL_CLI_BUSY",
			"別のローカルCLIスキャンを実行中です。完了後に再実行してください。",
		);
	}
	const settings = readVulnWorkbenchCliSettings();
	const diffPreview =
		input.target.kind === "working_tree"
			? await loadVulnWorkbenchCliDiffPreview(
					projectPath,
					preview.resolvedProfileRef,
					settings,
				)
			: null;
	const fullSnapshot =
		input.target.kind === "full"
			? await captureLocalCliTarget(projectPath)
			: null;
	const digest = fullSnapshot?.digest ?? diffPreview?.target.targetDigest ?? "";
	if (digest !== input.expectedTargetDigest) {
		throw new AppError(
			409,
			"SECURITY_SCAN_TARGET_CHANGED",
			"プレビュー後にProjectの内容が変わりました。もう一度実行内容を確認してください。",
		);
	}
	const scanRunRef = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	const record: LocalScanRecord = {
		version: 1,
		idempotencyKey,
		projectPath,
		request: input,
		execution: { timeoutSeconds: preview.timeoutSeconds },
		detail: {
			scanRunRef,
			status: "queued",
			outcome: null,
			presetId:
				input.selection.mode === "preset" ? input.selection.presetId : null,
			profileRef: preview.resolvedProfileRef,
			target: {
				kind: input.target.kind,
				digest,
				sourceRevision:
					fullSnapshot?.gitHead ?? diffPreview?.target.baseSha ?? null,
			},
			progress: {
				completedSteps: 0,
				totalSteps: preview.totalSteps,
				currentStep: null,
			},
			summary: null,
			lastEventSeq: 0,
			createdAt,
			startedAt: null,
			completedAt: null,
			error: null,
		},
		findings: [],
		report: null,
		reportContent: null,
		updatedAt: createdAt,
	};
	await writeLocalScanRecord(record);
	consumeLocalCliPreview(input.previewRef);
	const controller = new AbortController();
	setLocalCliActiveJob(scanRunRef, controller);
	queueMicrotask(() => {
		void executeLocalScan(record, controller)
			.catch((error) => {
				logger.error(
					{ error, scanRunRef },
					"Local vulnWorkbench CLI scan finalization failed",
				);
			})
			.finally(() => {
				deleteLocalCliActiveJob(scanRunRef);
			});
	});
	return localCliStartResponse(record.detail, false);
}

async function executeLocalScan(
	record: LocalScanRecord,
	controller: AbortController,
) {
	try {
		const shouldRun = await withLocalCliScanMutation(
			record.detail.scanRunRef,
			async () => {
				const latest = await requireLocalScanRecord(record.detail.scanRunRef);
				if (controller.signal.aborted || latest.detail.status === "cancelled") {
					await persistLocalCliCancelled(latest);
					return false;
				}
				const startedAt = new Date().toISOString();
				latest.detail = {
					...latest.detail,
					status: "running",
					progress: {
						completedSteps: 0,
						totalSteps: latest.detail.progress.totalSteps,
						currentStep: "スキャン中",
					},
					lastEventSeq: 1,
					startedAt,
				};
				latest.updatedAt = startedAt;
				await writeLocalScanRecord(latest);
				record = latest;
				return true;
			},
		);
		if (!shouldRun) return;
		const baseSettings = readVulnWorkbenchCliSettings();
		await requireLocalCliTargetUnchanged(record, baseSettings);
		if (controller.signal.aborted) {
			throw new Error("ローカルCLIスキャンがキャンセルされました。");
		}
		const result = await runVulnWorkbenchSecurityDiagnostic({
			target: { repoRoot: record.projectPath, targetFiles: [] },
			artifactDir: path.dirname(localScanRecordPath(record.detail.scanRunRef)),
			settings: {
				...baseSettings,
				timeoutSeconds:
					record.execution?.timeoutSeconds ?? baseSettings.timeoutSeconds,
			},
			profile: record.detail.profileRef,
			scanTarget: record.detail.target.kind,
			expectedTargetDigest:
				record.detail.target.kind === "working_tree"
					? record.detail.target.digest
					: undefined,
			findingLimit: 1_000,
			signal: controller.signal,
		});
		if (!controller.signal.aborted) {
			await requireLocalCliTargetUnchanged(record, baseSettings);
		}
		await withLocalCliScanMutation(record.detail.scanRunRef, async () => {
			const latest = await requireLocalScanRecord(record.detail.scanRunRef);
			if (controller.signal.aborted || latest.detail.status === "cancelled") {
				await persistLocalCliCancelled(latest);
				return;
			}
			await persistLocalCliResult(latest, result);
		});
	} catch (error) {
		await withLocalCliScanMutation(record.detail.scanRunRef, async () => {
			const latest =
				(await readLocalScanRecord(record.detail.scanRunRef)) ?? record;
			if (controller.signal.aborted || latest.detail.status === "cancelled") {
				await persistLocalCliCancelled(latest);
				return;
			}
			await persistLocalCliFailure(
				latest,
				error instanceof Error ? error.message : String(error),
			);
		});
	}
}

async function requireLocalCliTargetUnchanged(
	record: LocalScanRecord,
	settings: ReturnType<typeof readVulnWorkbenchCliSettings>,
) {
	const digest =
		record.detail.target.kind === "full"
			? (await captureLocalCliTarget(record.projectPath)).digest
			: (
					await loadVulnWorkbenchCliDiffPreview(
						record.projectPath,
						record.detail.profileRef,
						settings,
					)
				).target.targetDigest;
	if (digest !== record.detail.target.digest) {
		throw new AppError(
			409,
			"SECURITY_SCAN_TARGET_CHANGED",
			"スキャン実行中にProjectの内容が変わったため、結果を採用しませんでした。もう一度プレビューしてください。",
		);
	}
}

function requireMatchingReplay(
	record: LocalScanRecord,
	input: NonNullable<LocalScanRecord["request"]>,
) {
	const matches = record.request
		? JSON.stringify(record.request) === JSON.stringify(input)
		: record.detail.target.kind === input.target.kind &&
			record.detail.target.digest === input.expectedTargetDigest &&
			(input.selection.mode === "preset"
				? record.detail.presetId === input.selection.presetId
				: record.detail.presetId === null &&
					record.detail.profileRef === input.selection.profileRef);
	if (!matches) {
		throw new AppError(
			409,
			"SECURITY_SCAN_IDEMPOTENCY_CONFLICT",
			"同じIdempotency-Keyが異なるスキャン条件で使用されました。",
		);
	}
}
