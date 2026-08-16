import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import {
	type SecurityScanFindingPage,
	type SecurityScanReportDetail,
	securityScanBindingSchema,
	securityScanCapabilitiesSchema,
	securityScanFindingPageSchema,
	securityScanProviderSettingsSchema,
	securityScanReportDetailSchema,
	securityScanRunDetailSchema,
} from "../../../shared/schemas/security-scan.schema";
import { readJsonResponse } from "../../lib/api-error";
import {
	fetchSecurityScan,
	fetchSecurityScanCapabilities,
	fetchSecurityScanFindings,
	fetchSecurityScanHistory,
	fetchSecurityScanProviderSettings,
	fetchSecurityScanReports,
} from "./securityScanCommands";

const historyResponseSchema = z.object({
	items: z.array(securityScanBindingSchema),
});
const reportsResponseSchema = z.object({
	items: z.array(securityScanReportDetailSchema),
});

export const securityScanQueryKeys = {
	providerSettings: ["security-scan", "provider-settings"] as const,
	capabilities: (repositoryId: string) =>
		["security-scan", "capabilities", repositoryId] as const,
	history: (repositoryId: string) =>
		["security-scan", "history", repositoryId] as const,
	detail: (repositoryId: string, scanRunRef: string) =>
		["security-scan", "detail", repositoryId, scanRunRef] as const,
	findings: (repositoryId: string, scanRunRef: string) =>
		["security-scan", "findings", repositoryId, scanRunRef] as const,
	reports: (repositoryId: string, scanRunRef: string) =>
		["security-scan", "reports", repositoryId, scanRunRef] as const,
};

export function isTerminalSecurityScanStatus(status: string | undefined) {
	return (
		status === "completed" || status === "failed" || status === "cancelled"
	);
}

export async function fetchSecurityScanFindingPages(
	repositoryId: string,
	scanRunRef: string,
	signal?: AbortSignal,
): Promise<SecurityScanFindingPage["items"]> {
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
		const page: SecurityScanFindingPage = await readJsonResponse(
			await fetchSecurityScanFindings(
				repositoryId,
				scanRunRef,
				cursor ?? undefined,
				{ signal },
			),
			securityScanFindingPageSchema,
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

export function securityScanProviderSettingsQueryOptions() {
	return queryOptions({
		queryKey: securityScanQueryKeys.providerSettings,
		queryFn: async ({ signal }) =>
			readJsonResponse(
				await fetchSecurityScanProviderSettings({ signal }),
				securityScanProviderSettingsSchema,
			),
	});
}

export function securityScanCapabilitiesQueryOptions(
	repositoryId: string,
	enabled: boolean,
) {
	return queryOptions({
		queryKey: securityScanQueryKeys.capabilities(repositoryId),
		enabled,
		queryFn: async ({ signal }) =>
			readJsonResponse(
				await fetchSecurityScanCapabilities(repositoryId, { signal }),
				securityScanCapabilitiesSchema,
			),
	});
}

export function securityScanHistoryQueryOptions(repositoryId: string) {
	return queryOptions({
		queryKey: securityScanQueryKeys.history(repositoryId),
		queryFn: async ({ signal }) =>
			readJsonResponse(
				await fetchSecurityScanHistory(repositoryId, { signal }),
				historyResponseSchema,
			),
	});
}

export function securityScanDetailQueryOptions(
	repositoryId: string,
	scanRunRef: string | null,
) {
	return queryOptions({
		queryKey: securityScanQueryKeys.detail(repositoryId, scanRunRef ?? "none"),
		enabled: Boolean(scanRunRef),
		queryFn: async ({ signal }) => {
			if (!scanRunRef) throw new Error("scanRunRef is required");
			return readJsonResponse(
				await fetchSecurityScan(repositoryId, scanRunRef, { signal }),
				securityScanRunDetailSchema,
			);
		},
		refetchInterval: (query) =>
			isTerminalSecurityScanStatus(query.state.data?.status) ? false : 2_000,
	});
}

export function securityScanFindingsQueryOptions(
	repositoryId: string,
	scanRunRef: string | null,
	enabled: boolean,
) {
	return queryOptions({
		queryKey: securityScanQueryKeys.findings(
			repositoryId,
			scanRunRef ?? "none",
		),
		enabled: enabled && Boolean(scanRunRef),
		queryFn: async ({ signal }) => {
			if (!scanRunRef) throw new Error("scanRunRef is required");
			return fetchSecurityScanFindingPages(repositoryId, scanRunRef, signal);
		},
	});
}

export function securityScanReportsQueryOptions(
	repositoryId: string,
	scanRunRef: string | null,
	enabled: boolean,
) {
	return queryOptions({
		queryKey: securityScanQueryKeys.reports(repositoryId, scanRunRef ?? "none"),
		enabled: enabled && Boolean(scanRunRef),
		queryFn: async ({ signal }) => {
			if (!scanRunRef) throw new Error("scanRunRef is required");
			return readJsonResponse(
				await fetchSecurityScanReports(repositoryId, scanRunRef, { signal }),
				reportsResponseSchema,
			).then((response) => response.items);
		},
		refetchInterval: (query) =>
			query.state.data?.some(
				(report) => report.status === "queued" || report.status === "running",
			)
				? 2_000
				: false,
	});
}

export function mergeSecurityScanReport(
	current: SecurityScanReportDetail[] | undefined,
	report: SecurityScanReportDetail,
) {
	return [
		report,
		...(current ?? []).filter((item) => item.reportRef !== report.reportRef),
	];
}
