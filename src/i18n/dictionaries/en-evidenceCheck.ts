export const enEvidenceCheck = {
	"evidenceCheck.title": "Evidence Check",
	"evidenceCheck.openArtifact": "Open Evidence Check",
	"evidenceCheck.artifact.summary":
		"Implementation plan traceability, Spec conditions, and current evidence status",
	"evidenceCheck.unavailable":
		"No verification document is linked to this Spec.",
	"evidenceCheck.loading": "Loading the latest evidence.",
	"evidenceCheck.loadFailed": "The latest evidence could not be loaded.",
	"evidenceCheck.plan.title": "Implementation Plan Traceability",
	"evidenceCheck.plan.exactMatch":
		"The adopted implementation plan exactly matches the Run Todos.",
	"evidenceCheck.plan.mismatch":
		"The adopted implementation plan does not match the Run Todos.",
	"evidenceCheck.plan.legacyInferred":
		"The Run Todos exactly match the plan, but this legacy Run has no persisted plan digest.",
	"evidenceCheck.plan.provenanceMismatch":
		"The persisted plan digest or source does not match.",
	"evidenceCheck.plan.provenanceMissing":
		"No matching implementation Run or plan provenance was found.",
	"evidenceCheck.plan.summary":
		"{{passed}}/{{total}} steps complete · {{unaligned}} mismatched · {{evidenceLinked}} with evidence refs",
	"evidenceCheck.conditions.title": "Spec Completion Conditions",
	"evidenceCheck.conditions.summary":
		"{{confirmed}}/{{total}} confirmed · {{failed}} failed · {{pending}} pending",
	"evidenceCheck.conditionEvidence": "{{count}} evidence refs",
	"evidenceCheck.conditionStatus.pending": "Pending",
	"evidenceCheck.conditionStatus.running": "Checking",
	"evidenceCheck.conditionStatus.passed": "Verified",
	"evidenceCheck.conditionStatus.failed": "Failed",
	"evidenceCheck.conditionStatus.completed": "Verified",
	"evidenceCheck.conditionStatus.done": "Verified",
	"evidenceCheck.conditionStatus.covered": "Verified",
	"evidenceCheck.conditionStatus.verified_by_gate": "Gate verified",
	"evidenceCheck.conditionStatus.manual": "Manually verified",
	"evidenceCheck.conditionStatus.not_applicable": "Not applicable",
	"evidenceCheck.conditionStatus.missing": "Missing",
	"evidenceCheck.conditionStatus.unknown": "Unknown",
} as const;
