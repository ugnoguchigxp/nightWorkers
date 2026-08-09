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
import { preferredSecurityScanSelection } from "./securityScanSelection";

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

async function fetchFindingPages(repositoryId: string, scanRunRef: string) {
	const items = new Map<string, SecurityScanFindingPage["items"][number]>();
	let cursor: string | null = null;
	const seenCursors = new Set<string>();
	while (items.size < 1_000) {
		if (cursor) {
			if (seenCursors.has(cursor)) {
				throw new Error("Findingページングが循環しています。");
			}
			seenCursors.add(cursor);
		}
		const page: SecurityScanFindingPage = await readResponse(
			fetchSecurityScanFindings(repositoryId, scanRunRef, cursor ?? undefined),
		);
		for (const finding of page.items) {
			if (items.size >= 1_000) break;
			items.set(finding.ref, finding);
		}
		if (!page.nextCursor) break;
		cursor = page.nextCursor;
	}
	return [...items.values()];
}

export function useSecurityScanController(repositoryId: string) {
	const repositoryIdRef = useRef(repositoryId);
	const activeScanRunRefRef = useRef<string | null>(null);
	const pollInFlightRef = useRef(false);
	const previewRequestIdRef = useRef(0);
	const startInFlightRef = useRef<string | null>(null);
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
	const applyCapabilities = useCallback((value: SecurityScanCapabilities) => {
		previewRequestIdRef.current += 1;
		setCapabilities(value);
		setPreview(null);
		const preferred = preferredSecurityScanSelection(value);
		if (!preferred) return;
		setSelection(preferred.selection);
		setTarget(preferred.target);
	}, []);

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
				fetchFindingPages(repositoryId, scan.scanRunRef),
				readResponse<{ items: SecurityScanReportDetail[] }>(
					fetchSecurityScanReports(repositoryId, scan.scanRunRef),
				),
			]);
			if (
				repositoryIdRef.current !== repositoryId ||
				activeScanRunRefRef.current !== scan.scanRunRef
			) {
				return;
			}
			if (findingResult.status === "fulfilled") {
				setFindings(findingResult.value);
			}
			if (reportResult.status === "fulfilled") {
				setReports(reportResult.value.items);
			}
			const failures = [findingResult, reportResult].flatMap((result) =>
				result.status === "rejected" ? [result.reason] : [],
			);
			if (failures.length > 0) {
				throw new Error(
					failures
						.map((cause) =>
							cause instanceof Error ? cause.message : String(cause),
						)
						.join(" / "),
				);
			}
		},
		[repositoryId],
	);

	const loadScan = useCallback(
		async (scanRunRef: string) => {
			const scan = await readResponse<SecurityScanRunDetail>(
				await fetchSecurityScan(repositoryId, scanRunRef),
			);
			if (
				repositoryIdRef.current !== repositoryId ||
				activeScanRunRefRef.current !== scanRunRef
			) {
				return scan;
			}
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
			if (repositoryIdRef.current !== repositoryId) return;
			applyCapabilities(value);
		} catch (cause) {
			if (repositoryIdRef.current !== repositoryId) return;
			setCapabilities(null);
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (repositoryIdRef.current === repositoryId) setAction(null);
		}
	}, [applyCapabilities, repositoryId]);

	useEffect(() => {
		let cancelled = false;
		activeScanRunRefRef.current = null;
		previewRequestIdRef.current += 1;
		startInFlightRef.current = null;
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
					activeScanRunRefRef.current = scanHistory.items[0].scanRunRef;
					await loadScan(scanHistory.items[0].scanRunRef).catch((cause) => {
						if (!cancelled) {
							setError(cause instanceof Error ? cause.message : String(cause));
						}
					});
				}
				const configured =
					settings.enabled &&
					(settings.transport === "local_cli"
						? settings.localCliConfigured
						: settings.tokenConfigured);
				if (configured) {
					const value = await readResponse<SecurityScanCapabilities>(
						await fetchSecurityScanCapabilities(repositoryId),
					);
					if (!cancelled) applyCapabilities(value);
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
	}, [applyCapabilities, loadScan, repositoryId]);

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
					if (activeScanRunRefRef.current === activeScan.scanRunRef) {
						setError(cause instanceof Error ? cause.message : String(cause));
					}
				})
				.finally(() => {
					pollInFlightRef.current = false;
				});
		}, 2_000);
		return () => window.clearInterval(timer);
	}, [activeScan, loadScan, reportsNeedPolling, scanNeedsPolling]);

	const updateSelection = useCallback((next: SecurityScanSelection) => {
		previewRequestIdRef.current += 1;
		setSelection(next);
		setPreview(null);
		setAction((current) => (current === "preview" ? null : current));
	}, []);
	const updateTarget = useCallback((kind: SecurityScanTargetKind) => {
		previewRequestIdRef.current += 1;
		setTarget({ kind });
		setPreview(null);
		setAction((current) => (current === "preview" ? null : current));
	}, []);

	const createPreview = useCallback(async () => {
		const requestId = ++previewRequestIdRef.current;
		setAction("preview");
		setError("");
		try {
			const nextPreview = await readResponse<SecurityScanPreview>(
				await previewSecurityScan(repositoryId, { selection, target }),
			);
			if (
				repositoryIdRef.current === repositoryId &&
				previewRequestIdRef.current === requestId
			) {
				setPreview(nextPreview);
			}
		} catch (cause) {
			if (
				repositoryIdRef.current === repositoryId &&
				previewRequestIdRef.current === requestId
			) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		} finally {
			if (
				repositoryIdRef.current === repositoryId &&
				previewRequestIdRef.current === requestId
			) {
				setAction(null);
			}
		}
	}, [repositoryId, selection, target]);

	const runScan = useCallback(async () => {
		if (!preview || startInFlightRef.current) return;
		const requestKey = `${repositoryId}:${preview.previewRef}`;
		startInFlightRef.current = requestKey;
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
			if (repositoryIdRef.current !== repositoryId) return;
			activeScanRunRefRef.current = started.scanRunRef;
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
			setActiveScan(null);
			setFindings([]);
			setReports([]);
			await loadScan(started.scanRunRef);
		} catch (cause) {
			if (repositoryIdRef.current === repositoryId) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		} finally {
			if (startInFlightRef.current === requestKey) {
				startInFlightRef.current = null;
				if (repositoryIdRef.current === repositoryId) setAction(null);
			}
		}
	}, [loadScan, preview, repositoryId, selection, target]);

	const selectScan = useCallback(
		async (scanRunRef: string) => {
			activeScanRunRefRef.current = scanRunRef;
			setAction(null);
			setError("");
			setActiveScan(null);
			setFindings([]);
			setReports([]);
			try {
				await loadScan(scanRunRef);
			} catch (cause) {
				if (activeScanRunRefRef.current === scanRunRef) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}
		},
		[loadScan],
	);

	const cancelScan = useCallback(async () => {
		if (!activeScan) return;
		const scanRunRef = activeScan.scanRunRef;
		setAction("cancel");
		setError("");
		try {
			const cancelled = await readResponse<SecurityScanRunDetail>(
				await cancelSecurityScan(repositoryId, scanRunRef),
			);
			if (
				repositoryIdRef.current === repositoryId &&
				activeScanRunRefRef.current === scanRunRef
			) {
				setActiveScan(cancelled);
			}
		} catch (cause) {
			if (activeScanRunRefRef.current === scanRunRef) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		} finally {
			if (
				repositoryIdRef.current === repositoryId &&
				activeScanRunRefRef.current === scanRunRef
			) {
				setAction(null);
			}
		}
	}, [activeScan, repositoryId]);

	const createReport = useCallback(async () => {
		if (!activeScan) return null;
		const scanRunRef = activeScan.scanRunRef;
		setAction("report");
		setError("");
		try {
			const started = await readResponse<{
				report: SecurityScanReportDetail;
			}>(await startSecurityScanReport(repositoryId, scanRunRef));
			if (
				repositoryIdRef.current !== repositoryId ||
				activeScanRunRefRef.current !== scanRunRef
			) {
				return null;
			}
			setReports((current) => [
				started.report,
				...current.filter(
					(report) => report.reportRef !== started.report.reportRef,
				),
			]);
			return started.report;
		} catch (cause) {
			if (activeScanRunRefRef.current === scanRunRef) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
			return null;
		} finally {
			if (
				repositoryIdRef.current === repositoryId &&
				activeScanRunRefRef.current === scanRunRef
			) {
				setAction(null);
			}
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
