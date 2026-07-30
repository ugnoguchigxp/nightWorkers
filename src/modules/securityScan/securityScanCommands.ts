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

export function fetchSecurityScanProviderSettings() {
	return apiFetch("/api/settings/vulnerability-scan-provider");
}

export function saveSecurityScanProviderSettings(
	settings: SecurityScanProviderSettingsInput,
) {
	return apiFetch(
		"/api/settings/vulnerability-scan-provider",
		jsonRequest("PUT", settings),
	);
}

export function fetchSecurityScanHistory(repositoryId: string) {
	return apiFetch(basePath(repositoryId));
}

export function fetchSecurityScanCapabilities(repositoryId: string) {
	return apiFetch(`${basePath(repositoryId)}/capabilities`);
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

export function fetchSecurityScan(repositoryId: string, scanRunRef: string) {
	return apiFetch(
		`${basePath(repositoryId)}/${encodeURIComponent(scanRunRef)}`,
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
) {
	return apiFetch(
		`${basePath(repositoryId)}/${encodeURIComponent(scanRunRef)}/findings?limit=100`,
	);
}

export function fetchSecurityScanReports(
	repositoryId: string,
	scanRunRef: string,
) {
	return apiFetch(
		`${basePath(repositoryId)}/${encodeURIComponent(scanRunRef)}/reports`,
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
