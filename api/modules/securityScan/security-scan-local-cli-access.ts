import type {
	SecurityScanFindingPage,
	SecurityScanRunDetail,
	SecurityScanStartReportResponse,
} from "../../../shared/schemas/security-scan.schema";
import { AppError } from "../../lib/errors";
import {
	localCliFailureAfterRestart,
	persistLocalCliCancelled,
} from "./security-scan-local-cli-result";
import {
	getLocalCliActiveJob,
	hasLocalCliActiveJob,
	withLocalCliScanMutation,
} from "./security-scan-local-cli-runtime";
import {
	readLocalScanRecord,
	requireLocalScanRecord,
	writeLocalScanRecord,
} from "./security-scan-local-cli-storage";

export async function localCliScanDetail(
	scanRunRef: string,
): Promise<SecurityScanRunDetail> {
	let record = await requireLocalScanRecord(scanRunRef);
	if (
		(record.detail.status === "queued" || record.detail.status === "running") &&
		!hasLocalCliActiveJob(scanRunRef)
	) {
		record = (await readLocalScanRecord(scanRunRef)) ?? record;
		if (!["queued", "running"].includes(record.detail.status)) {
			return record.detail;
		}
		const failed = localCliFailureAfterRestart(record);
		await writeLocalScanRecord(failed);
		return failed.detail;
	}
	return record.detail;
}

export async function localCliCancel(
	scanRunRef: string,
): Promise<SecurityScanRunDetail> {
	getLocalCliActiveJob(scanRunRef)?.abort();
	return withLocalCliScanMutation(scanRunRef, async () => {
		const record = await requireLocalScanRecord(scanRunRef);
		if (!["queued", "running"].includes(record.detail.status)) {
			return record.detail;
		}
		await persistLocalCliCancelled(record);
		return (await requireLocalScanRecord(scanRunRef)).detail;
	});
}

export async function localCliFindings(
	scanRunRef: string,
	query: URLSearchParams,
): Promise<SecurityScanFindingPage> {
	const record = await requireLocalScanRecord(scanRunRef);
	const severity = query.get("severity");
	const tool = query.get("tool");
	const limit = Math.min(100, Math.max(1, Number(query.get("limit") ?? 100)));
	const cursor = query.get("cursor") ?? "0";
	const offset = Number(cursor);
	if (!Number.isSafeInteger(offset) || offset < 0) {
		throw new AppError(
			422,
			"SECURITY_SCAN_FINDING_CURSOR_INVALID",
			"finding cursorが不正です。",
		);
	}
	const filtered = record.findings
		.filter((finding) => !severity || finding.severity === severity)
		.filter((finding) => !tool || finding.tool === tool);
	const safeLimit = Number.isFinite(limit) ? limit : 100;
	const end = Math.min(filtered.length, offset + safeLimit);
	return {
		items: filtered.slice(offset, end),
		nextCursor: end < filtered.length ? String(end) : null,
	};
}

export async function localCliReports(scanRunRef: string) {
	const record = await requireLocalScanRecord(scanRunRef);
	return { items: record.report ? [record.report] : [] };
}

export async function localCliStartReport(
	scanRunRef: string,
): Promise<SecurityScanStartReportResponse> {
	const record = await requireLocalScanRecord(scanRunRef);
	if (!record.report) {
		throw new AppError(
			409,
			"SECURITY_SCAN_REPORT_UNAVAILABLE",
			"ローカルCLIスキャンのレポートはスキャン完了時に生成されます。",
		);
	}
	return { report: record.report, replayed: true };
}

export async function localCliReportContent(
	scanRunRef: string,
	reportRef: string,
) {
	const record = await requireLocalScanRecord(scanRunRef);
	if (record.report?.reportRef !== reportRef || record.reportContent === null) {
		throw new AppError(
			404,
			"SECURITY_SCAN_REPORT_NOT_FOUND",
			"レポートが見つかりません。",
		);
	}
	return {
		content: record.reportContent,
		contentType: "text/markdown; charset=utf-8",
		contentDisposition: `attachment; filename="security-report-${reportRef.slice(0, 8)}.md"`,
	};
}
