import type { ReviewEvidenceRef, ReviewFinding } from "./results/types";
import type {
	ReviewRecommendationLevel,
	ReviewRecommendationReason,
	ReviewSectionKind,
} from "./review-mode.model";
import type { ReviewEvidencePack } from "./rubrics/types";

const SECURITY_PATH_PATTERN =
	/(^|\/)(auth|oauth|permission|permissions|secret|secrets|security|billing|payment|payments|middleware)(\/|\.|-|$)|\b(policy|token|password|credential|csrf|jwt)\b/i;
const SCHEMA_PATH_PATTERN =
	/(^|\/)(drizzle|migrations?|schema|db)(\/|\.|-|$)|\.(sql)$/i;
const PUBLIC_CONTRACT_PATTERN =
	/(^|\/)(api\/routes|api\/modules|shared\/schemas|mcp|worker-tools)(\/|$)|\b(openapi|route-definitions|schema)\b/i;

function changedFileRefs(pack: ReviewEvidencePack): ReviewEvidenceRef[] {
	return pack.diff.changedFiles.map((path) => ({
		kind: "changed_file" as const,
		path,
	}));
}

function diffRef(pack: ReviewEvidencePack): ReviewEvidenceRef {
	return {
		kind: "diff",
		runId: pack.runId,
		bytes: pack.diff.bytes,
		hasChanges: pack.diff.hasChanges,
	};
}

function isSecuritySensitive(pack: ReviewEvidencePack) {
	return pack.diff.changedFiles.some((file) =>
		SECURITY_PATH_PATTERN.test(file),
	);
}

function isSchemaOrMigration(pack: ReviewEvidencePack) {
	return pack.diff.changedFiles.some((file) => SCHEMA_PATH_PATTERN.test(file));
}

function isPublicContract(pack: ReviewEvidencePack) {
	return pack.diff.changedFiles.some((file) =>
		PUBLIC_CONTRACT_PATTERN.test(file),
	);
}

export function buildRecommendationFromEvidence(input: {
	runId: string;
	taskId: string;
	repositoryId: string;
	pack: ReviewEvidencePack;
	openTodoCount: number;
}): {
	level: ReviewRecommendationLevel;
	defaultAction: "skip" | "offer_review" | "require_review";
	reasons: ReviewRecommendationReason[];
} {
	const { pack } = input;
	const reasons: ReviewRecommendationReason[] = [];
	const addReason = (reason: ReviewRecommendationReason) =>
		reasons.push(reason);

	if (pack.diff.bytes > 20_000) {
		addReason({
			code: "large_diff",
			severity: "warning",
			label: "Large diff should be reviewed before acceptance.",
			evidenceRefs: [diffRef(pack)],
		});
	}
	if (pack.diff.changedFiles.length >= 8) {
		addReason({
			code: "many_changed_files",
			severity: "warning",
			label: "Many changed files increase review risk.",
			evidenceRefs: changedFileRefs(pack),
		});
	}
	if (input.openTodoCount > 0) {
		addReason({
			code: "todo_unresolved",
			severity: "blocking",
			label: "Run still has unresolved Todo items.",
			evidenceRefs: [],
		});
	}
	if (isSecuritySensitive(pack)) {
		addReason({
			code: "security_sensitive_change",
			severity: "blocking",
			label: "Security-sensitive paths changed.",
			evidenceRefs: changedFileRefs(pack).filter((ref) =>
				ref.kind === "changed_file"
					? SECURITY_PATH_PATTERN.test(ref.path)
					: false,
			),
		});
		addReason({
			code: "security_plugin_missing",
			severity: "blocking",
			label:
				"No external security plugin evidence is linked for the sensitive change.",
			evidenceRefs: [],
		});
	}
	if (isSchemaOrMigration(pack)) {
		addReason({
			code: "schema_or_migration_change",
			severity: "blocking",
			label: "Schema or migration paths changed.",
			evidenceRefs: changedFileRefs(pack).filter((ref) =>
				ref.kind === "changed_file"
					? SCHEMA_PATH_PATTERN.test(ref.path)
					: false,
			),
		});
	}
	if (isPublicContract(pack)) {
		addReason({
			code: "public_contract_change",
			severity: "blocking",
			label: "Public API, schema, MCP, or worker-tool contract changed.",
			evidenceRefs: changedFileRefs(pack).filter((ref) =>
				ref.kind === "changed_file"
					? PUBLIC_CONTRACT_PATTERN.test(ref.path)
					: false,
			),
		});
	}
	if (reasons.length === 0) {
		if (!pack.diff.hasChanges || pack.diff.bytes === 0) {
			addReason({
				code: "minor_no_review_needed",
				severity: "info",
				label: "No risky run evidence was detected.",
				evidenceRefs: [],
			});
			return { level: "none", defaultAction: "skip", reasons };
		}
		addReason({
			code: "minor_no_review_needed",
			severity: "info",
			label: "Focused change has no blocking review signal.",
			evidenceRefs: [diffRef(pack)],
		});
		return { level: "optional", defaultAction: "offer_review", reasons };
	}

	const level: ReviewRecommendationLevel = reasons.some(
		(reason) => reason.severity === "blocking",
	)
		? "required"
		: "recommended";
	return {
		level,
		defaultAction: level === "required" ? "require_review" : "offer_review",
		reasons,
	};
}

export function sectionFindings(
	kind: ReviewSectionKind,
	pack: ReviewEvidencePack,
): ReviewFinding[] {
	if (kind === "security_review") {
		const findings: ReviewFinding[] = [];
		if (isSecuritySensitive(pack)) {
			findings.push({
				severity: "blocking",
				title: "Security-sensitive change needs external evidence",
				body: "Security-sensitive paths changed and no external security plugin evidence is linked.",
				evidenceRefs: changedFileRefs(pack).filter((ref) =>
					ref.kind === "changed_file"
						? SECURITY_PATH_PATTERN.test(ref.path)
						: false,
				),
			});
		}
		if (isSchemaOrMigration(pack)) {
			findings.push({
				severity: "blocking",
				title: "Schema or migration change requires review",
				body: "Schema or migration paths changed. Migration/apply verification evidence should be checked before acceptance.",
				evidenceRefs: changedFileRefs(pack).filter((ref) =>
					ref.kind === "changed_file"
						? SCHEMA_PATH_PATTERN.test(ref.path)
						: false,
				),
			});
		}
		if (isPublicContract(pack)) {
			findings.push({
				severity: "blocking",
				title: "Public contract change requires review",
				body: "Public API, schema, MCP, or worker-tool contract paths changed.",
				evidenceRefs: changedFileRefs(pack).filter((ref) =>
					ref.kind === "changed_file"
						? PUBLIC_CONTRACT_PATTERN.test(ref.path)
						: false,
				),
			});
		}
		return findings;
	}
	return [];
}
