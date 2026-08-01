export const enEvidenceCheck = {
	"evidenceCheck.title": "Evidence Check",
	"evidenceCheck.openArtifact": "Open Evidence Check",
	"evidenceCheck.artifact.summary":
		"Implementation plan traceability, Spec conditions, and current evidence status",
	"evidenceCheck.unavailable":
		"No verification document is linked to this Spec.",
	"evidenceCheck.loading": "Loading the latest evidence.",
	"evidenceCheck.loadFailed": "The latest evidence could not be loaded.",
	"evidenceCheck.assurance.title": "Test assurance",
	"evidenceCheck.assurance.summary":
		"Safe Pass {{safePass}}/{{automated}} · {{failed}} failed · {{attention}} need attention",
	"evidenceCheck.assurance.evaluatedAt": "Evaluated",
	"evidenceCheck.assurance.source": "Source",
	"evidenceCheck.assurance.unavailable": "Unavailable",
	"evidenceCheck.assurance.yes": "Yes",
	"evidenceCheck.assurance.no": "No",
	"evidenceCheck.gateStatus.passed": "Passed",
	"evidenceCheck.gateStatus.failed": "Failed",
	"evidenceCheck.gateStatus.unknown": "Unknown",
	"evidenceCheck.assuranceStatus.safe_pass": "Safe Pass",
	"evidenceCheck.assuranceStatus.failed": "Failed",
	"evidenceCheck.assuranceStatus.stale": "Re-run required",
	"evidenceCheck.assuranceStatus.not_run": "Not run",
	"evidenceCheck.assuranceStatus.unmapped": "Test not mapped",
	"evidenceCheck.assuranceStatus.details_missing": "Details missing",
	"evidenceCheck.assuranceStatus.manual": "Manual",
	"evidenceCheck.assuranceStatus.not_applicable": "Not applicable",
	"evidenceCheck.assuranceStatus.pending": "Pending",
	"evidenceCheck.assuranceReason.missing_test_definition_mapping":
		"No test definition is mapped to this condition.",
	"evidenceCheck.assuranceReason.test_execution_failed":
		"A mapped test failed.",
	"evidenceCheck.assuranceReason.source_snapshot_changed":
		"The source changed after the test run.",
	"evidenceCheck.assuranceReason.missing_successful_test_execution":
		"No successful test execution was observed.",
	"evidenceCheck.assuranceReason.missing_exact_test_case_result":
		"No successful result was found for this exact test case.",
	"evidenceCheck.assuranceReason.full_verify_failed":
		"The full verification gate failed.",
	"evidenceCheck.assuranceReason.missing_successful_full_verify":
		"No successful full verification gate was observed.",
	"evidenceCheck.assuranceReason.assurance_not_evaluated":
		"Test assurance has not been evaluated yet.",
	"evidenceCheck.test.execution": "Execution",
	"evidenceCheck.test.currentSource": "Current source",
	"evidenceCheck.testStatus.passed": "Passed",
	"evidenceCheck.testStatus.failed": "Failed",
	"evidenceCheck.testStatus.skipped": "Skipped",
	"evidenceCheck.testStatus.unknown": "Unknown",
	"evidenceCheck.testStatus.not_run": "Not run",
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
