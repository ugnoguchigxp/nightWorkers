import type {
	SecurityScanProviderSettingsInput,
	SecurityScanSelection,
	SecurityScanTarget,
} from "../../../shared/schemas/security-scan.schema";
import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";

function basePath(repositoryId: string) {
	return `/api/repositories/${encodeURIComponent(repositoryId)}/security-scans`;
}

export function fetchSecurityScanProviderSettings(init?: RequestInit) {
	return apiFetch("/api/settings/vulnerability-scan-provider", init);
}

export function saveSecurityScanProviderSettings(
	settings: SecurityScanProviderSettingsInput,
) {
	return apiFetch(
		"/api/settings/vulnerability-scan-provider",
		jsonRequest("PUT", settings),
	);
}

export function fetchSecurityScanHistory(
	repositoryId: string,
	init?: RequestInit,
) {
	return apiFetch(basePath(repositoryId), init);
}

export function fetchSecurityScanCapabilities(
	repositoryId: string,
	init?: RequestInit,
) {
	return apiFetch(`${basePath(repositoryId)}/capabilities`, init);
}

export function previewSecurityScan(
	repositoryId: string,
	input: { selection: SecurityScanSelection; target: SecurityScanTarget },
) {
	return apiFetch(
		`${basePath(repositoryId)}/preview`,
		jsonRequest("POST", input),
	);
}

export function startSecurityScan(
	repositoryId: string,
	input: {
		selection: SecurityScanSelection;
		target: SecurityScanTarget;
		previewRef: string;
		expectedTargetDigest: string;
	},
) {
	const request = jsonRequest("POST", input);
	const headers = new Headers(request.headers);
	headers.set("Idempotency-Key", crypto.randomUUID());
	return apiFetch(basePath(repositoryId), { ...request, headers });
}

export function fetchSecurityScan(
	repositoryId: string,
	scanRunRef: string,
	init?: RequestInit,
) {
	return apiFetch(
		`${basePath(repositoryId)}/${encodeURIComponent(scanRunRef)}`,
		init,
	);
}

export function cancelSecurityScan(repositoryId: string, scanRunRef: string) {
	return apiFetch(
		`${basePath(repositoryId)}/${encodeURIComponent(scanRunRef)}/cancel`,
		{ method: "POST" },
	);
}

export function fetchSecurityScanFindings(
	repositoryId: string,
	scanRunRef: string,
	cursor?: string,
	init?: RequestInit,
) {
	const query = new URLSearchParams({ limit: "100" });
	if (cursor) query.set("cursor", cursor);
	return apiFetch(
		`${basePath(repositoryId)}/${encodeURIComponent(scanRunRef)}/findings?${query.toString()}`,
		init,
	);
}

export function fetchSecurityScanReports(
	repositoryId: string,
	scanRunRef: string,
	init?: RequestInit,
) {
	return apiFetch(
		`${basePath(repositoryId)}/${encodeURIComponent(scanRunRef)}/reports`,
		init,
	);
}

export function startSecurityScanReport(
	repositoryId: string,
	scanRunRef: string,
) {
	return apiFetch(
		`${basePath(repositoryId)}/${encodeURIComponent(scanRunRef)}/reports`,
		{
			method: "POST",
			headers: { "Idempotency-Key": crypto.randomUUID() },
		},
	);
}

export function securityScanReportContentPath(
	repositoryId: string,
	scanRunRef: string,
	reportRef: string,
) {
	return `${basePath(repositoryId)}/${encodeURIComponent(
		scanRunRef,
	)}/reports/${encodeURIComponent(reportRef)}/content`;
}
