import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	SecurityScanBinding,
	SecurityScanCapabilities,
	SecurityScanFindingPage,
	SecurityScanPreview,
	SecurityScanProviderSettings,
	SecurityScanReportDetail,
	SecurityScanRunDetail,
	SecurityScanSelection,
	SecurityScanTarget,
	SecurityScanTargetKind,
} from "../../../shared/schemas/security-scan.schema";
import {
	cancelSecurityScan,
	fetchSecurityScan,
	fetchSecurityScanCapabilities,
	fetchSecurityScanFindings,
	fetchSecurityScanHistory,
	fetchSecurityScanProviderSettings,
	fetchSecurityScanReports,
	previewSecurityScan,
	startSecurityScan,
	startSecurityScanReport,
} from "./securityScanCommands";

type ScanAction =
	| "initial"
	| "capabilities"
	| "preview"
	| "start"
	| "cancel"
	| "report";

async function readResponse<T>(
	responseInput: Response | Promise<Response>,
): Promise<T> {
	const response = await responseInput;
	const payload = (await response.json().catch(() => null)) as
		| T
		| { error?: { message?: string } }
		| null;
	if (!response.ok) {
		throw new Error(
			payload &&
				typeof payload === "object" &&
				"error" in payload &&
				payload.error?.message
				? payload.error.message
				: `Request failed (${response.status})`,
		);
	}
	return payload as T;
}

export function useSecurityScanController(repositoryId: string) {
	const repositoryIdRef = useRef(repositoryId);
	const pollInFlightRef = useRef(false);
	repositoryIdRef.current = repositoryId;
	const [providerSettings, setProviderSettings] =
		useState<SecurityScanProviderSettings | null>(null);
	const [capabilities, setCapabilities] =
		useState<SecurityScanCapabilities | null>(null);
	const [history, setHistory] = useState<SecurityScanBinding[]>([]);
	const [selection, setSelection] = useState<SecurityScanSelection>({
		mode: "preset",
		presetId: "standard",
	});
	const [target, setTarget] = useState<SecurityScanTarget>({
		kind: "working_tree",
	});
	const [preview, setPreview] = useState<SecurityScanPreview | null>(null);
	const [activeScan, setActiveScan] = useState<SecurityScanRunDetail | null>(
		null,
	);
	const [findings, setFindings] = useState<SecurityScanFindingPage["items"]>(
		[],
	);
	const [reports, setReports] = useState<SecurityScanReportDetail[]>([]);
	const [action, setAction] = useState<ScanAction | null>("initial");
	const [error, setError] = useState("");

	const loadScanArtifacts = useCallback(
		async (scan: SecurityScanRunDetail) => {
			if (
				scan.status !== "completed" &&
				scan.status !== "failed" &&
				scan.status !== "cancelled"
			) {
				return;
			}
			const [findingResult, reportResult] = await Promise.allSettled([
				readResponse<SecurityScanFindingPage>(
					fetchSecurityScanFindings(repositoryId, scan.scanRunRef),
				),
				readResponse<{ items: SecurityScanReportDetail[] }>(
					fetchSecurityScanReports(repositoryId, scan.scanRunRef),
				),
			]);
			if (repositoryIdRef.current !== repositoryId) return;
			if (findingResult.status === "fulfilled") {
				setFindings(findingResult.value.items);
			}
			if (reportResult.status === "fulfilled") {
				setReports(reportResult.value.items);
			}
		},
		[repositoryId],
	);

	const loadScan = useCallback(
		async (scanRunRef: string) => {
			const scan = await readResponse<SecurityScanRunDetail>(
				await fetchSecurityScan(repositoryId, scanRunRef),
			);
			if (repositoryIdRef.current !== repositoryId) return scan;
			setActiveScan(scan);
			await loadScanArtifacts(scan);
			return scan;
		},
		[loadScanArtifacts, repositoryId],
	);

	const loadCapabilities = useCallback(async () => {
		setAction("capabilities");
		setError("");
		try {
			const value = await readResponse<SecurityScanCapabilities>(
				await fetchSecurityScanCapabilities(repositoryId),
			);
			setCapabilities(value);
			const recommended =
				value.presets.find((preset) => preset.recommended) ?? value.presets[0];
			if (recommended) {
				setSelection({ mode: "preset", presetId: recommended.id });
				const supportedTarget =
					recommended.targets.find((item) => item.kind === "working_tree") ??
					recommended.targets[0];
				if (supportedTarget) setTarget({ kind: supportedTarget.kind });
			}
		} catch (cause) {
			setCapabilities(null);
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setAction(null);
		}
	}, [repositoryId]);

	useEffect(() => {
		let cancelled = false;
		setAction("initial");
		setError("");
		setCapabilities(null);
		setHistory([]);
		setPreview(null);
		setActiveScan(null);
		setFindings([]);
		setReports([]);
		Promise.all([
			readResponse<SecurityScanProviderSettings>(
				fetchSecurityScanProviderSettings(),
			),
			readResponse<{ items: SecurityScanBinding[] }>(
				fetchSecurityScanHistory(repositoryId),
			),
		])
			.then(async ([settings, scanHistory]) => {
				if (cancelled) return;
				setProviderSettings(settings);
				setHistory(scanHistory.items);
				if (scanHistory.items[0]) {
					await loadScan(scanHistory.items[0].scanRunRef).catch((cause) => {
						if (!cancelled) {
							setError(cause instanceof Error ? cause.message : String(cause));
						}
					});
				}
				if (settings.enabled && settings.tokenConfigured) {
					const value = await readResponse<SecurityScanCapabilities>(
						await fetchSecurityScanCapabilities(repositoryId),
					);
					if (!cancelled) setCapabilities(value);
				}
			})
			.catch((cause) => {
				if (!cancelled) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			})
			.finally(() => {
				if (!cancelled) setAction(null);
			});
		return () => {
			cancelled = true;
		};
	}, [loadScan, repositoryId]);

	const reportsNeedPolling = reports.some(
		(report) => report.status === "queued" || report.status === "running",
	);
	const scanNeedsPolling =
		activeScan?.status === "queued" || activeScan?.status === "running";
	useEffect(() => {
		if (!activeScan || (!scanNeedsPolling && !reportsNeedPolling)) return;
		const timer = window.setInterval(() => {
			if (pollInFlightRef.current) return;
			pollInFlightRef.current = true;
			void loadScan(activeScan.scanRunRef)
				.catch((cause) => {
					setError(cause instanceof Error ? cause.message : String(cause));
				})
				.finally(() => {
					pollInFlightRef.current = false;
				});
		}, 2_000);
		return () => window.clearInterval(timer);
	}, [activeScan, loadScan, reportsNeedPolling, scanNeedsPolling]);

	const updateSelection = useCallback((next: SecurityScanSelection) => {
		setSelection(next);
		setPreview(null);
	}, []);
	const updateTarget = useCallback((kind: SecurityScanTargetKind) => {
		setTarget({ kind });
		setPreview(null);
	}, []);

	const createPreview = useCallback(async () => {
		setAction("preview");
		setError("");
		try {
			setPreview(
				await readResponse<SecurityScanPreview>(
					await previewSecurityScan(repositoryId, { selection, target }),
				),
			);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setAction(null);
		}
	}, [repositoryId, selection, target]);

	const runScan = useCallback(async () => {
		if (!preview) return;
		setAction("start");
		setError("");
		try {
			const started = await readResponse<{
				scanRunRef: string;
				createdAt: string;
			}>(
				await startSecurityScan(repositoryId, {
					selection,
					target,
					previewRef: preview.previewRef,
					expectedTargetDigest: preview.target.digest,
				}),
			);
			setHistory((current) => [
				{
					scanRunRef: started.scanRunRef,
					selection,
					target,
					createdAt: started.createdAt,
				},
				...current.filter((item) => item.scanRunRef !== started.scanRunRef),
			]);
			setPreview(null);
			setFindings([]);
			setReports([]);
			await loadScan(started.scanRunRef);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setAction(null);
		}
	}, [loadScan, preview, repositoryId, selection, target]);

	const selectScan = useCallback(
		async (scanRunRef: string) => {
			setError("");
			setFindings([]);
			setReports([]);
			try {
				await loadScan(scanRunRef);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		},
		[loadScan],
	);

	const cancelScan = useCallback(async () => {
		if (!activeScan) return;
		setAction("cancel");
		setError("");
		try {
			const cancelled = await readResponse<SecurityScanRunDetail>(
				await cancelSecurityScan(repositoryId, activeScan.scanRunRef),
			);
			setActiveScan(cancelled);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setAction(null);
		}
	}, [activeScan, repositoryId]);

	const createReport = useCallback(async () => {
		if (!activeScan) return;
		setAction("report");
		setError("");
		try {
			const started = await readResponse<{
				report: SecurityScanReportDetail;
			}>(await startSecurityScanReport(repositoryId, activeScan.scanRunRef));
			setReports((current) => [
				started.report,
				...current.filter(
					(report) => report.reportRef !== started.report.reportRef,
				),
			]);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setAction(null);
		}
	}, [activeScan, repositoryId]);

	const selectedPreset = useMemo(
		() =>
			selection.mode === "preset"
				? (capabilities?.presets.find(
						(preset) => preset.id === selection.presetId,
					) ?? null)
				: null,
		[capabilities, selection],
	);

	return {
		providerSettings,
		capabilities,
		history,
		selection,
		target,
		preview,
		activeScan,
		findings,
		reports,
		selectedPreset,
		action,
		error,
		loadCapabilities,
		updateSelection,
		updateTarget,
		createPreview,
		runScan,
		selectScan,
		cancelScan,
		createReport,
	};
}
