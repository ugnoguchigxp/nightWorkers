import crypto from "node:crypto";
import path from "node:path";
import type {
	SecurityScanFindingPage,
	SecurityScanRunDetail,
} from "../../../shared/schemas/security-scan.schema";
import {
	securityScanFindingPageSchema,
	securityScanRunDetailSchema,
} from "../../../shared/schemas/security-scan.schema";
import type { SecurityScanTaskGenerationSnapshot } from "../../../shared/schemas/task-generation.schema";
import { AppError, NotFoundError, ValidationError } from "../../lib/errors";
import { redactSecretText } from "../../services/security/secret-redaction";
import * as nightworkersRepository from "../nightworkers/nightworkers.repository";
import {
	providerFindings,
	providerScanDetail,
} from "./security-scan-provider.client";
import { listSecurityScanBindings } from "./security-scan-settings.service";

type Finding = SecurityScanFindingPage["items"][number];

const MAX_FINDING_PAGES = 100;

function boundedRedactedText(value: string | null, maxLength: number) {
	if (!value) return null;
	return redactSecretText(value).slice(0, maxLength);
}

function safeRepositoryPath(repositoryPath: string, value: string | null) {
	if (!value) return null;
	const normalized = path.isAbsolute(value)
		? path.relative(repositoryPath, value)
		: path.normalize(value);
	if (
		normalized === ".." ||
		normalized.startsWith(`..${path.sep}`) ||
		path.isAbsolute(normalized)
	) {
		return null;
	}
	return redactSecretText(normalized.split(path.sep).join("/")).slice(0, 4_096);
}

export function securityFindingFingerprint(finding: Finding) {
	return crypto
		.createHash("sha256")
		.update(
			JSON.stringify({
				tool: finding.tool,
				ruleId: finding.ruleId,
				category: finding.category,
				title: finding.title,
				location: finding.location,
			}),
		)
		.digest("hex");
}

function safeReference(value: string) {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		const sanitized = url.toString();
		return sanitized.length <= 512 ? sanitized : url.origin;
	} catch {
		return null;
	}
}

export function sanitizeSecurityFindingForTaskGeneration(
	repositoryPath: string,
	finding: Finding,
): SecurityScanTaskGenerationSnapshot["findings"][number] {
	return {
		ref: finding.ref,
		fingerprintHash: securityFindingFingerprint(finding),
		severity: finding.severity,
		title: redactSecretText(finding.title).slice(0, 1_024),
		category: boundedRedactedText(finding.category, 256),
		tool: redactSecretText(finding.tool).slice(0, 128),
		ruleId: boundedRedactedText(finding.ruleId, 512),
		location: {
			path: safeRepositoryPath(repositoryPath, finding.location.path),
			startLine: finding.location.startLine,
			endLine: finding.location.endLine,
		},
		description: boundedRedactedText(finding.description, 2_000),
		recommendation: boundedRedactedText(finding.recommendation, 2_000),
		references: finding.references
			.map(safeReference)
			.filter((reference): reference is string => Boolean(reference))
			.slice(0, 8),
	};
}

async function readSelectedFindings(scanRunRef: string, findingRefs: string[]) {
	const requested = new Set(findingRefs);
	const selected = new Map<string, Finding>();
	const seenCursors = new Set<string>();
	let cursor: string | null = null;
	for (let pageIndex = 0; pageIndex < MAX_FINDING_PAGES; pageIndex += 1) {
		const query = new URLSearchParams({ limit: "100" });
		if (cursor) query.set("cursor", cursor);
		const page = await providerFindings(
			scanRunRef,
			query,
			securityScanFindingPageSchema,
		);
		for (const finding of page.items) {
			if (requested.has(finding.ref)) selected.set(finding.ref, finding);
		}
		if (selected.size === requested.size || !page.nextCursor) break;
		if (seenCursors.has(page.nextCursor)) {
			throw new AppError(
				502,
				"SECURITY_SCAN_FINDING_CURSOR_LOOP",
				"vulnWorkbench のFindingページングが循環しています。",
			);
		}
		seenCursors.add(page.nextCursor);
		cursor = page.nextCursor;
	}
	const missing = findingRefs.filter((findingRef) => !selected.has(findingRef));
	if (missing.length > 0) {
		throw new ValidationError(
			"選択されたFindingがスキャン結果に存在しません。",
			{ findingRefs: missing },
		);
	}
	return findingRefs.map((findingRef) => selected.get(findingRef) as Finding);
}

function coverageWarnings(
	coverage: NonNullable<SecurityScanRunDetail["summary"]>["coverage"] | null,
) {
	if (!coverage) return ["スキャンのcoverage情報を確認できません。"];
	return [
		...(coverage.skipped > 0
			? [`${coverage.skipped}件の検査ステップがskipされています。`]
			: []),
		...(coverage.failed > 0
			? [`${coverage.failed}件の検査ステップが失敗しています。`]
			: []),
		...coverage.gaps.map((gap) => `${gap.code}: ${gap.message}`),
	];
}

export async function loadSecurityScanTaskGenerationEvidence(input: {
	repositoryId: string;
	scanRunRef: string;
	findingRefs: string[];
}) {
	const repository = await nightworkersRepository.getRepository(
		input.repositoryId,
	);
	if (!repository?.allowed) throw new NotFoundError("Project not found");
	const bound = listSecurityScanBindings(input.repositoryId).some(
		(binding) => binding.scanRunRef === input.scanRunRef,
	);
	if (!bound) {
		throw new AppError(
			404,
			"SECURITY_SCAN_BINDING_NOT_FOUND",
			"このProjectに紐づくスキャンが見つかりません。",
		);
	}
	const scan = await providerScanDetail(
		input.scanRunRef,
		securityScanRunDetailSchema,
	);
	if (scan.status !== "completed") {
		throw new AppError(
			409,
			"SECURITY_SCAN_NOT_COMPLETED",
			"完了したスキャンからのみTask候補を生成できます。",
		);
	}
	const findings = await readSelectedFindings(
		input.scanRunRef,
		input.findingRefs,
	);
	const safeFindings = findings.map((finding) =>
		sanitizeSecurityFindingForTaskGeneration(repository.localPath, finding),
	);
	const safeCoverage = scan.summary
		? {
				...scan.summary.coverage,
				gaps: scan.summary.coverage.gaps.map((gap) => ({
					code: gap.code,
					message: redactSecretText(gap.message).slice(0, 512),
				})),
			}
		: null;
	const snapshot: SecurityScanTaskGenerationSnapshot = {
		schemaVersion: "nightworkers.security-task-generation-snapshot/v1",
		repository: {
			id: repository.id,
			name: redactSecretText(repository.name).slice(0, 256),
		},
		scan: {
			scanRunRef: scan.scanRunRef,
			target: scan.target,
			coverage: safeCoverage ?? {
				completed: 0,
				skipped: 0,
				failed: 0,
				gaps: [],
			},
		},
		findings: safeFindings,
	};
	return {
		repository,
		snapshot,
		coverageWarnings: coverageWarnings(safeCoverage),
	};
}
