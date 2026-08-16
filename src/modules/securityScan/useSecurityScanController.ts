import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	SecurityScanCapabilities,
	SecurityScanPreview,
	SecurityScanReportDetail,
	SecurityScanSelection,
	SecurityScanTarget,
	SecurityScanTargetKind,
} from "../../../shared/schemas/security-scan.schema";
import { readJsonResponse } from "../../lib/api-error";
import {
	isTerminalSecurityScanStatus,
	mergeSecurityScanReport,
	securityScanCapabilitiesQueryOptions,
	securityScanDetailQueryOptions,
	securityScanFindingsQueryOptions,
	securityScanHistoryQueryOptions,
	securityScanProviderSettingsQueryOptions,
	securityScanQueryKeys,
	securityScanReportsQueryOptions,
} from "./security-scan-queries";
import {
	cancelSecurityScan,
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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useSecurityScanController(repositoryId: string) {
	const queryClient = useQueryClient();
	const repositoryIdRef = useRef(repositoryId);
	const selectedRepositoryRef = useRef<string | null>(null);
	const historyInitializedRepositoryRef = useRef<string | null>(null);
	const appliedCapabilitiesRef = useRef<{
		repositoryId: string;
		capabilities: SecurityScanCapabilities;
	} | null>(null);
	const previewRequestIdRef = useRef(0);
	const startInFlightRef = useRef<string | null>(null);
	repositoryIdRef.current = repositoryId;

	const providerSettingsQuery = useQuery(
		securityScanProviderSettingsQueryOptions(),
	);
	const configured = Boolean(
		providerSettingsQuery.data?.enabled &&
			(providerSettingsQuery.data.transport === "local_cli"
				? providerSettingsQuery.data.localCliConfigured
				: providerSettingsQuery.data.tokenConfigured),
	);
	const capabilitiesQuery = useQuery(
		securityScanCapabilitiesQueryOptions(repositoryId, configured),
	);
	const historyQuery = useQuery(securityScanHistoryQueryOptions(repositoryId));

	const [selection, setSelection] = useState<SecurityScanSelection>({
		mode: "preset",
		presetId: "standard",
	});
	const [target, setTarget] = useState<SecurityScanTarget>({
		kind: "working_tree",
	});
	const [preview, setPreview] = useState<SecurityScanPreview | null>(null);
	const [activeScanRunRef, setActiveScanRunRef] = useState<string | null>(null);
	const [action, setAction] = useState<ScanAction | null>(null);
	const [mutationError, setMutationError] = useState("");

	const activeScanQuery = useQuery(
		securityScanDetailQueryOptions(repositoryId, activeScanRunRef),
	);
	const activeScan = activeScanQuery.data ?? null;
	const hasTerminalScan = isTerminalSecurityScanStatus(activeScan?.status);
	const findingsQuery = useQuery(
		securityScanFindingsQueryOptions(
			repositoryId,
			activeScanRunRef,
			hasTerminalScan,
		),
	);
	const reportsQuery = useQuery(
		securityScanReportsQueryOptions(
			repositoryId,
			activeScanRunRef,
			hasTerminalScan,
		),
	);

	const applyCapabilities = useCallback((value: SecurityScanCapabilities) => {
		previewRequestIdRef.current += 1;
		setPreview(null);
		const preferred = preferredSecurityScanSelection(value);
		if (!preferred) return;
		setSelection(preferred.selection);
		setTarget(preferred.target);
	}, []);

	useEffect(() => {
		if (selectedRepositoryRef.current !== repositoryId) {
			selectedRepositoryRef.current = repositoryId;
			historyInitializedRepositoryRef.current = null;
			previewRequestIdRef.current += 1;
			startInFlightRef.current = null;
			appliedCapabilitiesRef.current = null;
			setMutationError("");
			setPreview(null);
		}
		if (
			historyInitializedRepositoryRef.current === repositoryId ||
			!historyQuery.data
		) {
			return;
		}
		historyInitializedRepositoryRef.current = repositoryId;
		setActiveScanRunRef(historyQuery.data.items[0]?.scanRunRef ?? null);
	}, [historyQuery.data, repositoryId]);

	useEffect(() => {
		const capabilities = capabilitiesQuery.data;
		if (!capabilities) return;
		const previous = appliedCapabilitiesRef.current;
		if (
			previous?.repositoryId === repositoryId &&
			previous.capabilities === capabilities
		) {
			return;
		}
		appliedCapabilitiesRef.current = { repositoryId, capabilities };
		applyCapabilities(capabilities);
	}, [applyCapabilities, capabilitiesQuery.data, repositoryId]);

	const loadCapabilities = useCallback(async () => {
		setAction("capabilities");
		setMutationError("");
		try {
			const result = await capabilitiesQuery.refetch();
			if (result.error) throw result.error;
			if (result.data && repositoryIdRef.current === repositoryId) {
				appliedCapabilitiesRef.current = {
					repositoryId,
					capabilities: result.data,
				};
				applyCapabilities(result.data);
			}
		} catch (error) {
			if (repositoryIdRef.current === repositoryId) {
				setMutationError(errorMessage(error));
			}
		} finally {
			if (repositoryIdRef.current === repositoryId) setAction(null);
		}
	}, [applyCapabilities, capabilitiesQuery, repositoryId]);

	const updateSelection = useCallback((next: SecurityScanSelection) => {
		previewRequestIdRef.current += 1;
		setSelection(next);
		setPreview(null);
	}, []);

	const updateTarget = useCallback((kind: SecurityScanTargetKind) => {
		previewRequestIdRef.current += 1;
		setTarget({ kind });
		setPreview(null);
	}, []);

	const createPreview = useCallback(async () => {
		const requestId = ++previewRequestIdRef.current;
		setAction("preview");
		setMutationError("");
		try {
			const nextPreview = await readJsonResponse<SecurityScanPreview>(
				await previewSecurityScan(repositoryId, { selection, target }),
			);
			if (
				repositoryIdRef.current === repositoryId &&
				previewRequestIdRef.current === requestId
			) {
				setPreview(nextPreview);
			}
		} catch (error) {
			if (
				repositoryIdRef.current === repositoryId &&
				previewRequestIdRef.current === requestId
			) {
				setMutationError(errorMessage(error));
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
		setMutationError("");
		try {
			const started = await readJsonResponse<{
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
			queryClient.setQueryData(
				securityScanQueryKeys.history(repositoryId),
				(current: { items: Array<{ scanRunRef: string }> } | undefined) => ({
					items: [
						{
							scanRunRef: started.scanRunRef,
							selection,
							target,
							createdAt: started.createdAt,
						},
						...(current?.items ?? []).filter(
							(item) => item.scanRunRef !== started.scanRunRef,
						),
					],
				}),
			);
			setPreview(null);
			setActiveScanRunRef(started.scanRunRef);
			await queryClient.fetchQuery(
				securityScanDetailQueryOptions(repositoryId, started.scanRunRef),
			);
		} catch (error) {
			if (repositoryIdRef.current === repositoryId) {
				setMutationError(errorMessage(error));
			}
		} finally {
			if (startInFlightRef.current === requestKey) {
				startInFlightRef.current = null;
				if (repositoryIdRef.current === repositoryId) setAction(null);
			}
		}
	}, [preview, queryClient, repositoryId, selection, target]);

	const selectScan = useCallback(
		async (scanRunRef: string) => {
			setMutationError("");
			setActiveScanRunRef(scanRunRef);
			try {
				await queryClient.fetchQuery(
					securityScanDetailQueryOptions(repositoryId, scanRunRef),
				);
			} catch (error) {
				if (repositoryIdRef.current === repositoryId) {
					setMutationError(errorMessage(error));
				}
			}
		},
		[queryClient, repositoryId],
	);

	const cancelScan = useCallback(async () => {
		if (!activeScan) return;
		const scanRunRef = activeScan.scanRunRef;
		setAction("cancel");
		setMutationError("");
		try {
			const cancelled = await readJsonResponse<typeof activeScan>(
				await cancelSecurityScan(repositoryId, scanRunRef),
			);
			if (
				repositoryIdRef.current === repositoryId &&
				activeScanRunRef === scanRunRef
			) {
				queryClient.setQueryData(
					securityScanQueryKeys.detail(repositoryId, scanRunRef),
					cancelled,
				);
				void queryClient.invalidateQueries({
					queryKey: securityScanQueryKeys.history(repositoryId),
				});
			}
		} catch (error) {
			if (activeScanRunRef === scanRunRef)
				setMutationError(errorMessage(error));
		} finally {
			if (
				repositoryIdRef.current === repositoryId &&
				activeScanRunRef === scanRunRef
			) {
				setAction(null);
			}
		}
	}, [activeScan, activeScanRunRef, queryClient, repositoryId]);

	const createReport = useCallback(async () => {
		if (!activeScan) return null;
		const scanRunRef = activeScan.scanRunRef;
		setAction("report");
		setMutationError("");
		try {
			const started = await readJsonResponse<{
				report: SecurityScanReportDetail;
			}>(await startSecurityScanReport(repositoryId, scanRunRef));
			if (
				repositoryIdRef.current !== repositoryId ||
				activeScanRunRef !== scanRunRef
			) {
				return null;
			}
			queryClient.setQueryData(
				securityScanQueryKeys.reports(repositoryId, scanRunRef),
				(current: SecurityScanReportDetail[] | undefined) =>
					mergeSecurityScanReport(current, started.report),
			);
			return started.report;
		} catch (error) {
			if (activeScanRunRef === scanRunRef)
				setMutationError(errorMessage(error));
			return null;
		} finally {
			if (
				repositoryIdRef.current === repositoryId &&
				activeScanRunRef === scanRunRef
			) {
				setAction(null);
			}
		}
	}, [activeScan, activeScanRunRef, queryClient, repositoryId]);

	const selectedPreset = useMemo(
		() =>
			selection.mode === "preset"
				? (capabilitiesQuery.data?.presets.find(
						(preset) => preset.id === selection.presetId,
					) ?? null)
				: null,
		[capabilitiesQuery.data, selection],
	);
	const queryError =
		providerSettingsQuery.error ??
		historyQuery.error ??
		capabilitiesQuery.error ??
		activeScanQuery.error ??
		findingsQuery.error ??
		reportsQuery.error;

	return {
		providerSettings: providerSettingsQuery.data ?? null,
		capabilities: capabilitiesQuery.data ?? null,
		history: historyQuery.data?.items ?? [],
		selection,
		target,
		preview,
		activeScan,
		findings: findingsQuery.data ?? [],
		reports: reportsQuery.data ?? [],
		selectedPreset,
		action:
			action ??
			(providerSettingsQuery.isPending || historyQuery.isPending
				? "initial"
				: null),
		error: mutationError || (queryError ? errorMessage(queryError) : ""),
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
