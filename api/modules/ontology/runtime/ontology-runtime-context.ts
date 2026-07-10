import {
	checkOntologyBoundary,
	compileOntologyModuleContext,
} from "../core/ontology.service";

export type OntologyRuntimeContextSnapshot = {
	version: 1;
	available: boolean;
	source: "compile_module_context" | "unavailable";
	runId: string | null;
	taskId: string | null;
	runtimeLane: string | null;
	summaryType: string | null;
	primaryModule: string | null;
	secondaryModules: string[];
	taskCandidateId: string | null;
	taskGenerationEvidence: boolean;
	memoryEvidence: boolean;
	ownedPaths: string[];
	likelyFiles: string[];
	boundaryWarnings: string[];
	invariants: string[];
	focusedVerification: string[];
	warnings: string[];
	llmSummaryPreparation: {
		status: "deterministic_fallback";
		evidenceLayers: string[];
		outputFields: string[];
		unsupportedClaimsPolicy: "warn_or_downgrade";
	};
};

export type OntologyBoundaryAuditSnapshot = {
	version: 1;
	available: boolean;
	source: "check_boundary" | "unavailable";
	decision: string | null;
	primaryModule: string | null;
	touchedFiles: string[];
	ownedPathsTouched: string[];
	boundaryCrossings: Array<{
		module: string | null;
		paths: string[];
		declaredSecondary: boolean;
		reason: string | null;
	}>;
	forbiddenTouched: Array<{ path: string; reason: string | null }>;
	needsConfirmation: Array<{ path: string; reason: string | null }>;
	verificationSelection: {
		focused: string[];
		warnings: string[];
	};
	warnings: string[];
};

export async function buildOntologyRuntimeContextSnapshot(input: {
	repoRoot: string;
	goal: string;
	taskId: string;
	runId: string;
	runtimeLane: string;
}) {
	try {
		const context = (await compileOntologyModuleContext({
			repoPath: input.repoRoot,
			goal: input.goal,
			taskId: input.taskId,
			summaryType: "task_scoped",
		})) as Record<string, unknown>;
		return {
			...normalizeOntologyRuntimeContext(context),
			runId: input.runId,
			taskId: input.taskId,
			runtimeLane: input.runtimeLane,
		};
	} catch (error) {
		return unavailableOntologyRuntimeContext(toErrorMessage(error), {
			runId: input.runId,
			taskId: input.taskId,
			runtimeLane: input.runtimeLane,
		});
	}
}

export function buildOntologyRuntimeContextDisabledSnapshot(input: {
	taskId: string;
	runId: string;
	runtimeLane: string;
	toolProfile: "standard" | "ontology_extended";
	reason: string;
	measuredSourceLoc: number | null;
	thresholdSourceLoc: number;
}) {
	return unavailableOntologyRuntimeContext(
		`Ontology tools are not included in the ${input.toolProfile} profile (${input.reason}; source LOC ${input.measuredSourceLoc ?? "unavailable"}, threshold ${input.thresholdSourceLoc}).`,
		{
			runId: input.runId,
			taskId: input.taskId,
			runtimeLane: input.runtimeLane,
		},
	);
}

export async function buildOntologyBoundaryAuditSnapshot(input: {
	repoRoot: string;
	ontologyContext?: unknown;
	touchedFiles: string[];
}) {
	const ontology = normalizeStoredOntologyContext(input.ontologyContext);
	const touchedFiles = uniqueStrings(input.touchedFiles);
	if (
		!ontology.available ||
		!ontology.primaryModule ||
		touchedFiles.length === 0
	) {
		return unavailableBoundaryAudit({
			ontology,
			touchedFiles,
			warning:
				touchedFiles.length === 0
					? "No touched files were available for ontology boundary audit."
					: "No primary module was available for ontology boundary audit.",
		});
	}

	try {
		const audit = (await checkOntologyBoundary({
			repoPath: input.repoRoot,
			primaryModule: ontology.primaryModule,
			secondaryModules: ontology.secondaryModules,
			plannedFiles: touchedFiles,
		})) as Record<string, unknown>;
		return normalizeBoundaryAudit(audit, ontology, touchedFiles);
	} catch (error) {
		return unavailableBoundaryAudit({
			ontology,
			touchedFiles,
			warning: `Ontology boundary audit failed: ${toErrorMessage(error)}`,
		});
	}
}

export function formatOntologyRuntimeContextForPrompt(input: unknown) {
	const snapshot = normalizeStoredOntologyContext(input);
	if (!snapshot.available) {
		return [
			"Ontology runtime snapshot:",
			`- available: false${snapshot.warnings.length > 0 ? ` (${snapshot.warnings.join(" / ")})` : ""}`,
			"- fallback: use nightworkers.classify_goal and nightworkers.compile_module_context before broad exploration when the task is not trivial.",
		].join("\n");
	}
	return [
		"Ontology runtime snapshot:",
		`- primary module: ${snapshot.primaryModule ?? "unknown"}`,
		`- secondary modules: ${snapshot.secondaryModules.length > 0 ? snapshot.secondaryModules.join(", ") : "none"}`,
		`- summary type: ${snapshot.summaryType ?? "unknown"}`,
		`- task generation evidence: ${snapshot.taskGenerationEvidence ? "present" : "absent"}`,
		snapshot.taskCandidateId
			? `- task candidate id: ${snapshot.taskCandidateId}`
			: null,
		snapshot.ownedPaths.length > 0
			? `- owned paths: ${snapshot.ownedPaths.slice(0, 6).join(", ")}`
			: null,
		snapshot.invariants.length > 0
			? `- invariants: ${snapshot.invariants.slice(0, 6).join(", ")}`
			: null,
		snapshot.focusedVerification.length > 0
			? `- focused verification candidates: ${snapshot.focusedVerification.join(" | ")}`
			: "- focused verification candidates: none",
		snapshot.boundaryWarnings.length > 0
			? `- boundary warnings: ${snapshot.boundaryWarnings.join(" ")}`
			: null,
		snapshot.warnings.length > 0
			? `- warnings: ${snapshot.warnings.join(" / ")}`
			: null,
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}

export function formatOntologyCloseoutRequirementsForPrompt() {
	return [
		"Ontology closeout requirements:",
		"- Use the ontology runtime snapshot as the run boundary contract when it is available.",
		"- Before finalReport, report primary module, secondary modules, boundary crossings, invariants checked, verification run, and skipped verification reasons.",
		"- If touched files are outside owned paths, record the crossing reason instead of silently treating it as in-module work.",
	].join("\n");
}

export function ontologySnapshotEventSeverity(
	snapshot: OntologyRuntimeContextSnapshot,
) {
	if (
		!snapshot.available &&
		snapshot.warnings.some((warning) =>
			warning.includes(
				"Ontology tools are not included in the standard profile",
			),
		)
	) {
		return "info";
	}
	return snapshot.available ? "info" : "warning";
}

export function boundaryAuditEventSeverity(
	snapshot: OntologyBoundaryAuditSnapshot,
) {
	if (!snapshot.available)
		return snapshot.touchedFiles.length === 0 ? "info" : "warning";
	return snapshot.decision === "reject" || snapshot.needsConfirmation.length > 0
		? "warning"
		: "info";
}

function normalizeOntologyRuntimeContext(
	context: Record<string, unknown>,
): OntologyRuntimeContextSnapshot {
	const moduleManifest = asRecord(context.moduleManifest);
	const taskEvidence = asRecord(context.taskGenerationEvidence);
	const evidenceSources = asRecord(context.evidenceSources);
	const telemetry = asRecord(context.telemetry);
	return {
		version: 1,
		available: true,
		source: "compile_module_context",
		runId: null,
		taskId: null,
		runtimeLane: null,
		summaryType: stringOrNull(context.summaryType),
		primaryModule:
			stringOrNull(context.module) ?? stringOrNull(telemetry.primaryModule),
		secondaryModules: uniqueStrings(
			arrayOfStrings(asRecord(context.routing).secondaryModules).concat(
				arrayOfStrings(telemetry.secondaryModules),
			),
		),
		taskCandidateId:
			stringOrNull(taskEvidence.taskCandidateId) ??
			stringOrNull(telemetry.taskCandidateId),
		taskGenerationEvidence: Boolean(evidenceSources.taskGenerationEvidence),
		memoryEvidence: Boolean(evidenceSources.memoryEvidence),
		ownedPaths: arrayOfStrings(moduleManifest.ownedPaths),
		likelyFiles: arrayOfStrings(context.likelyFiles),
		boundaryWarnings: arrayOfStrings(context.boundaryWarnings),
		invariants: arrayOfStrings(context.relevantInvariants),
		focusedVerification: uniqueStrings(
			arrayOfStrings(context.verificationPlan).concat(
				arrayOfStrings(telemetry.focusedVerificationCommands),
			),
		),
		warnings: arrayOfStrings(context.warnings),
		llmSummaryPreparation: buildLlmSummaryPreparation(),
	};
}

function normalizeStoredOntologyContext(
	input: unknown,
): OntologyRuntimeContextSnapshot {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return unavailableOntologyRuntimeContext(
			"Ontology runtime snapshot is absent.",
		);
	}
	const record = input as Partial<OntologyRuntimeContextSnapshot>;
	return {
		version: 1,
		available: Boolean(record.available),
		source: record.available ? "compile_module_context" : "unavailable",
		runId: stringOrNull(record.runId),
		taskId: stringOrNull(record.taskId),
		runtimeLane: stringOrNull(record.runtimeLane),
		summaryType: stringOrNull(record.summaryType),
		primaryModule: stringOrNull(record.primaryModule),
		secondaryModules: arrayOfStrings(record.secondaryModules),
		taskCandidateId: stringOrNull(record.taskCandidateId),
		taskGenerationEvidence: Boolean(record.taskGenerationEvidence),
		memoryEvidence: Boolean(record.memoryEvidence),
		ownedPaths: arrayOfStrings(record.ownedPaths),
		likelyFiles: arrayOfStrings(record.likelyFiles),
		boundaryWarnings: arrayOfStrings(record.boundaryWarnings),
		invariants: arrayOfStrings(record.invariants),
		focusedVerification: arrayOfStrings(record.focusedVerification),
		warnings: arrayOfStrings(record.warnings),
		llmSummaryPreparation: buildLlmSummaryPreparation(),
	};
}

function normalizeBoundaryAudit(
	audit: Record<string, unknown>,
	ontology: OntologyRuntimeContextSnapshot,
	touchedFiles: string[],
): OntologyBoundaryAuditSnapshot {
	const ownedPathsTouched = arrayOfRecords(audit.allowed)
		.filter((item) => stringOrNull(item.reason) === "owned path")
		.map((item) => stringOrNull(item.path))
		.filter((path): path is string => Boolean(path));
	const needsConfirmation = arrayOfRecords(audit.needsConfirmation)
		.map((item) => ({
			path: stringOrNull(item.path) ?? "",
			reason: stringOrNull(item.reason),
		}))
		.filter((item) => item.path);
	const forbiddenTouched = arrayOfRecords(audit.forbiddenTouched)
		.map((item) => ({
			path: stringOrNull(item.path) ?? "",
			reason: stringOrNull(item.reason),
		}))
		.filter((item) => item.path);
	const boundaryCrossings = arrayOfRecords(audit.crossings)
		.map((item) => ({
			module: stringOrNull(item.module),
			paths: arrayOfStrings(item.paths),
			declaredSecondary: Boolean(item.declaredSecondary),
			reason: stringOrNull(item.reason),
		}))
		.filter((item) => item.paths.length > 0);
	const warnings = [
		...ontology.warnings,
		...arrayOfStrings(audit.warnings),
		...(needsConfirmation.length > 0
			? [
					"Unknown or read-mostly paths require crossing reason or confirmation evidence.",
				]
			: []),
		...(forbiddenTouched.length > 0 ? ["Forbidden paths were touched."] : []),
	];
	return {
		version: 1,
		available: true,
		source: "check_boundary",
		decision: stringOrNull(audit.decision),
		primaryModule: ontology.primaryModule,
		touchedFiles,
		ownedPathsTouched,
		boundaryCrossings,
		forbiddenTouched,
		needsConfirmation,
		verificationSelection: {
			focused: ontology.focusedVerification,
			warnings:
				needsConfirmation.length > 0
					? [
							"Unknown crossing requires explicit skipped reason or broader verification.",
						]
					: [],
		},
		warnings,
	};
}

function unavailableOntologyRuntimeContext(
	warning: string,
	metadata: {
		runId?: string | null;
		taskId?: string | null;
		runtimeLane?: string | null;
	} = {},
): OntologyRuntimeContextSnapshot {
	return {
		version: 1,
		available: false,
		source: "unavailable",
		runId: metadata.runId ?? null,
		taskId: metadata.taskId ?? null,
		runtimeLane: metadata.runtimeLane ?? null,
		summaryType: null,
		primaryModule: null,
		secondaryModules: [],
		taskCandidateId: null,
		taskGenerationEvidence: false,
		memoryEvidence: false,
		ownedPaths: [],
		likelyFiles: [],
		boundaryWarnings: [],
		invariants: [],
		focusedVerification: [],
		warnings: [warning],
		llmSummaryPreparation: buildLlmSummaryPreparation(),
	};
}

function unavailableBoundaryAudit(input: {
	ontology: OntologyRuntimeContextSnapshot;
	touchedFiles: string[];
	warning: string;
}): OntologyBoundaryAuditSnapshot {
	return {
		version: 1,
		available: false,
		source: "unavailable",
		decision: null,
		primaryModule: input.ontology.primaryModule,
		touchedFiles: input.touchedFiles,
		ownedPathsTouched: [],
		boundaryCrossings: [],
		forbiddenTouched: [],
		needsConfirmation: [],
		verificationSelection: {
			focused: input.ontology.focusedVerification,
			warnings: [input.warning],
		},
		warnings: [input.warning],
	};
}

function buildLlmSummaryPreparation() {
	return {
		status: "deterministic_fallback" as const,
		evidenceLayers: [
			"moduleManifest",
			"codeEvidence",
			"taskGenerationEvidence",
			"memoryEvidence",
		],
		outputFields: [
			"summaryType",
			"domainSummary",
			"relevantConcepts",
			"relevantInvariants",
			"likelyFiles",
			"boundaryWarnings",
			"verificationPlan",
			"unsupportedClaims",
		],
		unsupportedClaimsPolicy: "warn_or_downgrade" as const,
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.map(asRecord) : [];
}

function arrayOfStrings(value: unknown): string[] {
	return Array.isArray(value)
		? value
				.map((item) => stringOrNull(item))
				.filter((item): item is string => Boolean(item))
		: [];
}

function uniqueStrings(values: string[]) {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
