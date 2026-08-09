import crypto from "node:crypto";
import type {
	SecurityScanFindingPage,
	SecurityScanRunDetail,
	SecurityScanStartResponse,
} from "../../../shared/schemas/security-scan.schema";
import { redactSecretText } from "../../services/security/secret-redaction";
import type { VulnWorkbenchSecurityResult } from "../review/review-vulnworkbench.service";
import {
	type LocalScanRecord,
	readLocalScanRecord,
	writeLocalScanRecord,
} from "./security-scan-local-cli-storage";

const MAX_REPORT_BYTES = 5 * 1024 * 1024;

export async function persistLocalCliResult(
	record: LocalScanRecord,
	result: VulnWorkbenchSecurityResult,
) {
	const completedAt = new Date().toISOString();
	const findings = result.topFindings.map(toFinding);
	const scanCompleted = result.ok && result.scanRunId !== null;
	const inconclusive = result.status === "inconclusive";
	const coverage = result.coverage ?? {
		completed: scanCompleted ? 3 : 0,
		skipped: 0,
		failed: 0,
		gaps: [],
	};
	const coverageGaps = coverage.gaps.map((gap) => ({
		...gap,
		message: safeText(gap.message, 512),
	}));
	if (
		inconclusive &&
		coverageGaps.length === 0 &&
		(!result.reviewStatus || result.reviewStatus === "completed")
	) {
		coverageGaps.push({
			code: "oracle_inconclusive",
			message: safeText(
				result.error ?? "Security Oracleがinconclusiveを返しました。",
				512,
			),
		});
	}
	if (result.reviewStatus && result.reviewStatus !== "completed") {
		coverageGaps.push({
			code: "llm_review_unavailable",
			message: safeText(
				result.error ?? `LLM review status: ${result.reviewStatus}`,
				512,
			),
		});
	}
	record.detail = {
		...record.detail,
		status: scanCompleted ? "completed" : "failed",
		outcome: scanCompleted
			? inconclusive
				? "inconclusive"
				: result.findingCount > 0
					? "findings_present"
					: "no_findings"
			: "unavailable",
		progress: {
			completedSteps: scanCompleted
				? record.detail.progress.totalSteps
				: Math.min(
						record.detail.progress.totalSteps,
						coverage.completed + coverage.skipped + coverage.failed,
					),
			totalSteps: record.detail.progress.totalSteps,
			currentStep: scanCompleted ? "完了" : "失敗",
		},
		summary: scanCompleted
			? {
					findingCount: result.findingCount,
					severityCounts: result.severityCounts,
					coverage: {
						completed: coverage.completed,
						skipped: coverage.skipped,
						failed: coverage.failed,
						gaps: coverageGaps,
					},
				}
			: null,
		lastEventSeq: 2,
		completedAt,
		error: scanCompleted
			? null
			: {
					code: "LOCAL_CLI_SCAN_FAILED",
					message: safeText(
						result.error ?? "vulnWorkbench CLI scanが失敗しました。",
						1024,
					),
					retryable: result.status === "runtime_error",
				},
	};
	record.findings = findings;
	if (scanCompleted) attachReport(record, result, findings, completedAt);
	record.updatedAt = completedAt;
	await writeLocalScanRecord(record);
}

export async function persistLocalCliCancelled(record: LocalScanRecord) {
	const latest =
		(await readLocalScanRecord(record.detail.scanRunRef)) ?? record;
	if (latest.detail.status === "cancelled") return;
	const completedAt = new Date().toISOString();
	latest.detail = {
		...latest.detail,
		status: "cancelled",
		outcome: "unavailable",
		progress: {
			...latest.detail.progress,
			currentStep: "キャンセルされました。",
		},
		lastEventSeq: latest.detail.lastEventSeq + 1,
		completedAt,
		error: null,
	};
	latest.updatedAt = completedAt;
	await writeLocalScanRecord(latest);
}

export async function persistLocalCliFailure(
	record: LocalScanRecord,
	message: string,
) {
	const completedAt = new Date().toISOString();
	record.detail = {
		...record.detail,
		status: "failed",
		outcome: "unavailable",
		progress: { ...record.detail.progress, currentStep: "失敗" },
		lastEventSeq: record.detail.lastEventSeq + 1,
		completedAt,
		error: {
			code: "LOCAL_CLI_SCAN_FAILED",
			message: safeText(message, 1024),
			retryable: true,
		},
	};
	record.updatedAt = completedAt;
	await writeLocalScanRecord(record);
}

export function localCliFailureAfterRestart(
	record: LocalScanRecord,
): LocalScanRecord {
	const completedAt = new Date().toISOString();
	return {
		...record,
		detail: {
			...record.detail,
			status: "failed",
			outcome: "unavailable",
			progress: { ...record.detail.progress, currentStep: "中断" },
			lastEventSeq: record.detail.lastEventSeq + 1,
			completedAt,
			error: {
				code: "LOCAL_CLI_SCAN_INTERRUPTED",
				message:
					"NightWorkersの再起動によりローカルCLIスキャンが中断されました。",
				retryable: true,
			},
		},
		updatedAt: completedAt,
	};
}

export function localCliStartResponse(
	detail: SecurityScanRunDetail,
	replayed: boolean,
): SecurityScanStartResponse {
	return {
		scanRunRef: detail.scanRunRef,
		status: detail.status,
		resolvedProfileRef: detail.profileRef,
		target: detail.target,
		createdAt: detail.createdAt,
		replayed,
	};
}

function attachReport(
	record: LocalScanRecord,
	result: VulnWorkbenchSecurityResult,
	findings: SecurityScanFindingPage["items"],
	completedAt: string,
) {
	const reportContent = boundUtf8(
		buildReport(result, findings, completedAt),
		MAX_REPORT_BYTES,
	);
	const reportRef = crypto.randomUUID();
	record.reportContent = reportContent;
	record.report = {
		reportRef,
		scanRunRef: record.detail.scanRunRef,
		status: "completed",
		summaryMode: "deterministic_with_llm_summary",
		title: "vulnWorkbench Security Oracle レポート",
		llm: null,
		createdAt: record.detail.createdAt,
		startedAt: record.detail.startedAt,
		completedAt,
		content: {
			mediaType: "text/markdown",
			byteLength: Buffer.byteLength(reportContent, "utf8"),
			sha256: crypto.createHash("sha256").update(reportContent).digest("hex"),
		},
		error: null,
	};
}

function toFinding(
	finding: VulnWorkbenchSecurityResult["topFindings"][number],
): SecurityScanFindingPage["items"][number] {
	return {
		ref: safeFindingRef(finding),
		severity: normalizeSeverity(finding.severity),
		title: safeText(finding.title, 1024) || "Untitled finding",
		category: null,
		tool: safeText(finding.tool, 128) || "unknown",
		ruleId: safeText(finding.ruleId, 512) || null,
		location: {
			path: finding.location?.path
				? safeText(finding.location.path, 4096)
				: null,
			startLine: positiveLine(finding.location?.line),
			endLine: positiveLine(finding.location?.line),
		},
		description: null,
		evidence: safeText(finding.fingerprint, 16_384) || null,
		recommendation: safeText(finding.recommendation, 16_384) || null,
		references: [],
	};
}

function buildReport(
	result: VulnWorkbenchSecurityResult,
	findings: SecurityScanFindingPage["items"],
	completedAt: string,
) {
	const lines = [
		"# vulnWorkbench Security Oracle レポート",
		"",
		`- 対象: ${result.projectPath ?? "不明"}`,
		`- Scan Run: ${result.scanRunId ?? "不明"}`,
		`- 完了日時: ${completedAt}`,
		`- 検出件数: ${result.findingCount}`,
		"",
		"## カバレッジ",
		"",
		`- 完了: ${result.coverage?.completed ?? "不明"}`,
		`- スキップ: ${result.coverage?.skipped ?? "不明"}`,
		`- 失敗: ${result.coverage?.failed ?? "不明"}`,
		...(result.coverage?.gaps ?? []).map(
			(gap) => `- ギャップ ${gap.code}: ${safeText(gap.message, 512)}`,
		),
		"",
		"## 検出結果",
		"",
	];
	if (findings.length === 0) {
		lines.push("scanner-backed findingは検出されませんでした。", "");
	} else {
		for (const finding of findings) {
			const location = finding.location.path
				? `${finding.location.path}${finding.location.startLine ? `:${finding.location.startLine}` : ""}`
				: "位置情報なし";
			lines.push(
				`### [${finding.severity}] ${finding.title}`,
				"",
				`- 位置: ${location}`,
				`- ツール: ${finding.tool}`,
				`- ルール: ${finding.ruleId ?? "不明"}`,
				`- 推奨対応: ${finding.recommendation ?? "検出箇所を確認してください。"}`,
				"",
			);
		}
	}
	if (result.findingsTruncated) {
		lines.push(
			`このレポートには優先度の高い${findings.length}件のみを掲載しています。全検出件数は${result.findingCount}件です。`,
			"",
		);
	}
	lines.push(
		"## LLM review",
		"",
		`Status: ${result.reviewStatus ?? "unknown"}`,
		"",
		(result.improvementRequest
			? safeText(result.improvementRequest, 16_384)
			: null) ??
			"LLM reviewは完了していないため、scanner-backed evidenceのみを記録します。",
		"",
	);
	return lines.join("\n");
}

function normalizeSeverity(value: string) {
	const normalized = value.toLowerCase();
	return ["critical", "high", "medium", "low", "info"].includes(normalized)
		? (normalized as "critical" | "high" | "medium" | "low" | "info")
		: ("unknown" as const);
}

function safeFindingRef(
	finding: VulnWorkbenchSecurityResult["topFindings"][number],
) {
	const candidate = finding.id || finding.fingerprint;
	if (candidate && candidate.length <= 256) return candidate;
	return `local-${crypto
		.createHash("sha256")
		.update(candidate || JSON.stringify(finding))
		.digest("hex")
		.slice(0, 32)}`;
}

function positiveLine(value: number | null | undefined) {
	return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function clipText(value: string, maxLength: number) {
	return value.length <= maxLength
		? value
		: `${value.slice(0, maxLength - 1)}…`;
}

function safeText(value: string, maxLength: number) {
	return clipText(redactSecretText(value), maxLength);
}

function boundUtf8(value: string, maxBytes: number) {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.length <= maxBytes) return value;
	const suffix = Buffer.from("\n\n...[report truncated]...\n", "utf8");
	let boundary = Math.max(0, maxBytes - suffix.length);
	while (boundary > 0 && (bytes[boundary] & 0xc0) === 0x80) boundary -= 1;
	return `${bytes.subarray(0, boundary).toString("utf8")}${suffix.toString("utf8")}`;
}
