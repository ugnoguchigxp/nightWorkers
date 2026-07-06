import type { TFunction } from "i18next";
import {
	AlertTriangle,
	CheckCircle2,
	ClipboardCheck,
	LoaderCircle,
	Play,
	Save,
	ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	ReviewArtifact,
	ReviewModeFinding,
	ReviewSectionKind,
	ReviewSessionDetail,
} from "../types";

type ReviewStatusViewerProps = {
	detail: ReviewSessionDetail | null;
	onRunSection?: (section: ReviewSectionKind) => Promise<ReviewSessionDetail>;
	onUpdateFindingDisposition?: (
		reviewSessionId: string,
		findingId: string,
		input: {
			disposition: NonNullable<ReviewModeFinding["disposition"]>;
			note?: string;
			evidenceRefs?: unknown[];
		},
	) => Promise<ReviewSessionDetail>;
	onCreatePromptSuggestions?: (
		reviewSessionId: string,
	) => Promise<ReviewSessionDetail>;
	onUpdatePromptSuggestion?: (
		reviewSessionId: string,
		suggestionId: string,
		input: { status: "dismissed" },
	) => Promise<ReviewSessionDetail>;
	onUsePromptSuggestion?: (
		reviewSessionId: string,
		suggestionId: string,
		prompt: string,
	) => Promise<ReviewSessionDetail>;
	onInsertPromptSuggestion?: (prompt: string) => void;
	onFinalAction?: (
		reviewSessionId: string,
		input: {
			action: "approve" | "request_changes" | "needs_human" | "exit_review";
			note?: string;
		},
	) => Promise<ReviewSessionDetail>;
};

const requirementOrder = [
	"required",
	"recommended",
	"optional",
	"omitted",
] as const;
const findingDispositions: NonNullable<ReviewModeFinding["disposition"]>[] = [
	"human_callout",
	"agent_followup",
	"prompt_suggestion",
	"security_plugin_handoff",
	"accepted_risk",
	"ignored",
];

type BusyPromptSuggestion =
	| { id: "sync"; action: "sync" }
	| { id: string; action: "use" | "dismiss" };

type SectionArtifactPayload = {
	summary?: string;
	mode?: "precheck_only" | "agentic_review";
	degradedReason?: string;
	result?: TestEvidencePrecheckResult;
	agenticReview?: TestEvidenceReviewResult | null;
	findings?: unknown[];
};

type TestEvidencePrecheckResult = {
	planFound?: boolean;
	planTitle?: string | null;
	criteria?: string[];
	testFilesScanned?: number;
	testNamesScanned?: number;
	matches?: Array<{
		criterion?: string;
		matched?: boolean;
		testNames?: string[];
	}>;
};

type TestEvidenceReviewResult = {
	summary?: string;
	criteria?: Array<{
		criterion?: string;
		status?: "confirmed" | "not_found" | "unclear" | "not_applicable";
		confidence?: string;
		evidence?: Array<{
			kind?: string;
			filePath?: string;
			testName?: string;
			command?: string;
			excerpt?: string;
			note?: string;
		}>;
		improvementPrompt?: string;
	}>;
	commandsRun?: Array<{
		command?: string;
		exitCode?: number | null;
		summary?: string;
	}>;
};

type TestEvidenceItem = NonNullable<
	NonNullable<
		NonNullable<TestEvidenceReviewResult["criteria"]>[number]["evidence"]
	>[number]
>;

type ReviewStatusSection =
	ReviewSessionDetail["statusArtifact"]["sections"][number];

function reviewStatusLabel(t: TFunction, key: string, fallback: string) {
	return t(key, { defaultValue: fallback });
}

function reviewStatusValueLabel(t: TFunction, group: string, value: string) {
	return reviewStatusLabel(t, `reviewStatus.${group}.${value}`, value);
}

function reviewStatusSectionReason(t: TFunction, reason: string) {
	switch (reason) {
		case "No acceptance review signal was detected.":
			return t("reviewStatus.sectionReason.noAcceptanceSignal");
		case "No acceptance criteria test-name check is needed.":
			return t("reviewStatus.sectionReason.noTestCoverageNeeded");
		case "Compare implementation-plan acceptance criteria with describe/it/test names.":
			return t("reviewStatus.sectionReason.testCoverage");
		case "No test evidence review is needed.":
			return t("reviewStatus.sectionReason.noTestCoverageNeeded");
		case "Check test evidence for implementation-plan acceptance criteria.":
			return t("reviewStatus.sectionReason.testCoverage");
		case "Sensitive, schema, or public contract paths changed.":
			return t("reviewStatus.sectionReason.sensitivePathsChanged");
		case "No security-sensitive change was detected.":
			return t("reviewStatus.sectionReason.noSecuritySignal");
		case "No findings consolidation is needed.":
			return t("reviewStatus.sectionReason.noFindingsNeeded");
		case "Consolidate section findings and route dispositions.":
			return t("reviewStatus.sectionReason.consolidateFindings");
		case "Create additional prompts when findings should be handled by continuing this session.":
			return t("reviewStatus.sectionReason.createFollowupPrompts");
		default:
			return reason;
	}
}

function reviewStatusBlockingReason(t: TFunction, reason: string) {
	switch (reason) {
		case "Required review sections are not complete.":
			return t("reviewStatus.blockingReason.requiredSectionsIncomplete");
		case "Unresolved blocking findings remain.":
			return t("reviewStatus.blockingReason.unresolvedBlockingFindings");
		default:
			return reason;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePrecheckResult(value: unknown): TestEvidencePrecheckResult {
	const result = isRecord(value) ? value : {};
	const matches = Array.isArray(result.matches)
		? result.matches.filter(isRecord).map((match) => ({
				criterion:
					typeof match.criterion === "string" ? match.criterion : undefined,
				matched: typeof match.matched === "boolean" ? match.matched : undefined,
				testNames: Array.isArray(match.testNames)
					? match.testNames.filter(
							(value): value is string => typeof value === "string",
						)
					: undefined,
			}))
		: undefined;
	return {
		planFound:
			typeof result.planFound === "boolean" ? result.planFound : undefined,
		planTitle: typeof result.planTitle === "string" ? result.planTitle : null,
		criteria: Array.isArray(result.criteria)
			? result.criteria.filter(
					(value): value is string => typeof value === "string",
				)
			: undefined,
		testFilesScanned:
			typeof result.testFilesScanned === "number"
				? result.testFilesScanned
				: undefined,
		testNamesScanned:
			typeof result.testNamesScanned === "number"
				? result.testNamesScanned
				: undefined,
		matches,
	};
}

function parseAgenticReview(value: unknown): TestEvidenceReviewResult | null {
	if (!isRecord(value)) return null;
	return {
		summary: typeof value.summary === "string" ? value.summary : undefined,
		criteria: Array.isArray(value.criteria)
			? value.criteria.filter(isRecord).map((criterion) => ({
					criterion:
						typeof criterion.criterion === "string"
							? criterion.criterion
							: undefined,
					status: isTestEvidenceStatus(criterion.status)
						? criterion.status
						: undefined,
					confidence:
						typeof criterion.confidence === "string"
							? criterion.confidence
							: undefined,
					evidence: Array.isArray(criterion.evidence)
						? criterion.evidence.filter(isRecord).map((evidence) => ({
								kind:
									typeof evidence.kind === "string" ? evidence.kind : undefined,
								filePath:
									typeof evidence.filePath === "string"
										? evidence.filePath
										: undefined,
								testName:
									typeof evidence.testName === "string"
										? evidence.testName
										: undefined,
								command:
									typeof evidence.command === "string"
										? evidence.command
										: undefined,
								excerpt:
									typeof evidence.excerpt === "string"
										? evidence.excerpt
										: undefined,
								note:
									typeof evidence.note === "string" ? evidence.note : undefined,
							}))
						: undefined,
					improvementPrompt:
						typeof criterion.improvementPrompt === "string"
							? criterion.improvementPrompt
							: undefined,
				}))
			: undefined,
		commandsRun: Array.isArray(value.commandsRun)
			? value.commandsRun.filter(isRecord).map((command) => ({
					command:
						typeof command.command === "string" ? command.command : undefined,
					exitCode:
						typeof command.exitCode === "number" ? command.exitCode : null,
					summary:
						typeof command.summary === "string" ? command.summary : undefined,
				}))
			: undefined,
	};
}

function isTestEvidenceStatus(
	value: unknown,
): value is NonNullable<
	NonNullable<TestEvidenceReviewResult["criteria"]>[number]["status"]
> {
	return (
		value === "confirmed" ||
		value === "not_found" ||
		value === "unclear" ||
		value === "not_applicable"
	);
}

function sectionArtifactPayload(
	artifact: ReviewArtifact | undefined,
): SectionArtifactPayload {
	if (!artifact || !isRecord(artifact.artifact)) return {};
	const payload = artifact.artifact;
	const mode =
		payload.mode === "precheck_only" || payload.mode === "agentic_review"
			? payload.mode
			: undefined;
	const precheck = mode
		? parsePrecheckResult(payload.precheck)
		: parsePrecheckResult(payload.result);
	return {
		summary: typeof payload.summary === "string" ? payload.summary : undefined,
		mode: mode ?? "precheck_only",
		degradedReason:
			typeof payload.degradedReason === "string"
				? payload.degradedReason
				: undefined,
		result: precheck,
		agenticReview: parseAgenticReview(payload.agenticReview),
		findings: Array.isArray(payload.findings) ? payload.findings : undefined,
	};
}

function reviewArtifactSummary(t: TFunction, summary: string | undefined) {
	if (!summary) return null;
	if (summary === "No findings were produced by deterministic review.") {
		return t("reviewStatus.result.noFindings");
	}
	const findingCount = /^(\d+) deterministic finding/.exec(summary);
	if (findingCount?.[1]) {
		return t("reviewStatus.result.findingsProduced", {
			count: Number(findingCount[1]),
		});
	}
	return summary;
}

function reviewArtifactTestCoverageLines(
	t: TFunction,
	payload: SectionArtifactPayload,
) {
	const result = payload.result;
	if (!result) return [];
	const criteriaCount = result.criteria?.length ?? 0;
	const matchedCount =
		result.matches?.filter((match) => match.matched).length ?? 0;
	return [
		result.planFound
			? t("reviewStatus.result.planFound", {
					title: result.planTitle || t("reviewStatus.result.untitledPlan"),
				})
			: t("reviewStatus.result.planMissing"),
		t("reviewStatus.result.criteriaMatched", {
			matchedCount,
			criteriaCount,
		}),
		t("reviewStatus.result.testNamesScanned", {
			fileCount: result.testFilesScanned ?? 0,
			testNameCount: result.testNamesScanned ?? 0,
		}),
	];
}

function reviewArtifactMissingCriteria(payload: SectionArtifactPayload) {
	return (
		payload.result?.matches
			?.filter((match) => match.matched === false && match.criterion)
			.map((match) => match.criterion as string) ?? []
	);
}

function agenticStatusCount(payload: SectionArtifactPayload, status: string) {
	return (
		payload.agenticReview?.criteria?.filter((item) => item.status === status)
			.length ?? 0
	);
}

function testEvidenceModeLabel(t: TFunction, payload: SectionArtifactPayload) {
	return payload.mode === "agentic_review"
		? t("reviewStatus.result.agenticReview")
		: t("reviewStatus.result.testCoverageOnly");
}

function evidenceLine(evidence: TestEvidenceItem) {
	const source = [evidence.filePath, evidence.testName, evidence.command]
		.filter(Boolean)
		.join(" · ");
	return [source, evidence.note].filter(Boolean).join(" - ");
}

function reviewArtifactUpdatedAt(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "short",
		timeStyle: "short",
	}).format(date);
}

function reviewArtifactTimeValue(artifact: ReviewArtifact) {
	const timestamp = new Date(artifact.updatedAt).getTime();
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

function latestSectionArtifact(
	artifacts: ReviewArtifact[],
	section: ReviewStatusSection,
): ReviewArtifact | undefined {
	return artifacts
		.filter((artifact) => artifact.kind === section.kind)
		.sort((a, b) => reviewArtifactTimeValue(b) - reviewArtifactTimeValue(a))[0];
}

export function ReviewStatusViewer({
	detail,
	onRunSection,
	onUpdateFindingDisposition,
	onCreatePromptSuggestions,
	onUpdatePromptSuggestion,
	onUsePromptSuggestion,
	onInsertPromptSuggestion,
	onFinalAction,
}: ReviewStatusViewerProps) {
	const { t } = useTranslation();
	const [busySection, setBusySection] = useState<string | null>(null);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [busyFinding, setBusyFinding] = useState<string | null>(null);
	const [busyPromptSuggestion, setBusyPromptSuggestion] =
		useState<BusyPromptSuggestion | null>(null);
	const [findingEdits, setFindingEdits] = useState<
		Record<
			string,
			{
				disposition: NonNullable<ReviewModeFinding["disposition"]>;
				note: string;
			}
		>
	>({});
	const [error, setError] = useState<string | null>(null);
	if (!detail) {
		return (
			<div className="flex h-full items-center justify-center text-xs text-slate-500">
				{t("reviewStatus.unavailable")}
			</div>
		);
	}
	const status = detail.statusArtifact;
	const level = status.recommendation.level;
	const activePromptSuggestions = detail.promptSuggestions
		.filter((suggestion) => suggestion.status === "draft")
		.slice(0, 5);
	const levelClass =
		level === "required"
			? "border-red-500/60 bg-red-950/30 text-red-100"
			: level === "recommended"
				? "border-amber-500/60 bg-amber-950/30 text-amber-100"
				: "border-cyan-500/60 bg-cyan-950/30 text-cyan-100";
	return (
		<div className="nightworkers-review-status h-full overflow-auto bg-slate-950 p-5 text-slate-100">
			<div className="mx-auto grid max-w-5xl gap-5">
				<div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
					<div>
						<div className="flex items-center gap-2 text-sm font-semibold">
							<ClipboardCheck className="h-4 w-4 text-cyan-200" />
							{t("reviewStatus.title")}
						</div>
						<div className="mt-2 text-xs leading-5 text-slate-400">
							{t("reviewStatus.runRemains")}{" "}
							{detail.session.status === "approved"
								? t("reviewStatus.sessionState.approved")
								: t("reviewStatus.sessionState.executionUnchanged")}
							.
						</div>
					</div>
					<span
						className={`rounded border px-2.5 py-1 text-xs font-medium ${levelClass}`}
					>
						{reviewStatusValueLabel(t, "level", level)}
					</span>
				</div>

				<div className="grid gap-2">
					<div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
						{t("reviewStatus.reasons")}
					</div>
					<div className="grid gap-2">
						{status.recommendation.reasons.slice(0, 6).map((reason) => (
							<div
								key={`${reason.code}-${reason.label}`}
								className="flex items-start gap-2 rounded border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs"
							>
								{reason.severity === "blocking" ? (
									<ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-red-300" />
								) : (
									<AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-amber-300" />
								)}
								<div>
									<div
										className="font-medium text-slate-100"
										title={reason.code}
									>
										{reviewStatusValueLabel(t, "reason", reason.code)}
									</div>
								</div>
							</div>
						))}
					</div>
				</div>

				<div className="grid gap-4">
					{requirementOrder.map((requirement) => {
						const sections = status.sections.filter(
							(section) => section.requirement === requirement,
						);
						if (sections.length === 0) return null;
						return (
							<div key={requirement} className="grid gap-2">
								<div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
									{reviewStatusValueLabel(t, "requirement", requirement)}
								</div>
								<div className="grid gap-2">
									{sections.map((section) => {
										const runnable =
											section.requirement !== "omitted" &&
											Boolean(onRunSection);
										const isSectionBusy = busySection === section.kind;
										const artifact = latestSectionArtifact(
											detail.artifacts,
											section,
										);
										const artifactPayload = sectionArtifactPayload(artifact);
										const artifactSummary = reviewArtifactSummary(
											t,
											artifactPayload.summary,
										);
										const artifactEvidenceLines =
											reviewArtifactTestCoverageLines(t, artifactPayload);
										const missingCriteria =
											reviewArtifactMissingCriteria(artifactPayload);
										return (
											<div
												key={section.kind}
												className="grid gap-3 rounded border border-slate-800 bg-slate-900/50 p-3 md:grid-cols-[minmax(0,1fr)_auto]"
											>
												<div className="min-w-0">
													<div className="flex flex-wrap items-center gap-2">
														<span className="text-sm font-medium text-slate-100">
															{reviewStatusValueLabel(
																t,
																"section",
																section.kind,
															)}
														</span>
														<span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
															{reviewStatusValueLabel(
																t,
																"progress",
																section.progress,
															)}
														</span>
														{section.findingCounts.blocking > 0 ? (
															<span className="rounded border border-red-700 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-100">
																{t("reviewStatus.findingCount.blocking", {
																	count: section.findingCounts.blocking,
																})}
															</span>
														) : null}
													</div>
													<div className="mt-1 text-xs leading-5 text-slate-400">
														{reviewStatusSectionReason(t, section.reason)}
													</div>
													{artifact ? (
														<div className="mt-3 grid gap-2 rounded border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs">
															<div className="flex flex-wrap items-center gap-2 text-slate-300">
																<span className="font-medium text-slate-100">
																	{t("reviewStatus.result.title")}
																</span>
																<span className="text-slate-500">
																	{t("reviewStatus.result.updatedAt", {
																		value: reviewArtifactUpdatedAt(
																			artifact.updatedAt,
																		),
																	})}
																</span>
															</div>
															<div className="text-slate-400">
																{testEvidenceModeLabel(t, artifactPayload)}
															</div>
															{artifactPayload.degradedReason ? (
																<div className="rounded border border-amber-800/70 bg-amber-950/30 px-2 py-1 text-amber-100">
																	{t("reviewStatus.result.degraded")}{" "}
																	{artifactPayload.degradedReason}
																</div>
															) : null}
															{artifactSummary ? (
																<div className="text-slate-200">
																	{artifactSummary}
																</div>
															) : null}
															{artifactEvidenceLines.length > 0 ? (
																<div className="flex flex-wrap gap-1.5">
																	{artifactEvidenceLines.map((line) => (
																		<span
																			key={line}
																			className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300"
																		>
																			{line}
																		</span>
																	))}
																</div>
															) : null}
															{artifactPayload.agenticReview ? (
																<div className="flex flex-wrap gap-1.5">
																	<span className="rounded border border-emerald-700/70 px-2 py-0.5 text-[11px] text-emerald-100">
																		{t("reviewStatus.result.confirmedCount", {
																			count: agenticStatusCount(
																				artifactPayload,
																				"confirmed",
																			),
																		})}
																	</span>
																	<span className="rounded border border-amber-700/70 px-2 py-0.5 text-[11px] text-amber-100">
																		{t("reviewStatus.result.notFoundCount", {
																			count: agenticStatusCount(
																				artifactPayload,
																				"not_found",
																			),
																		})}
																	</span>
																	<span className="rounded border border-sky-700/70 px-2 py-0.5 text-[11px] text-sky-100">
																		{t("reviewStatus.result.unclearCount", {
																			count: agenticStatusCount(
																				artifactPayload,
																				"unclear",
																			),
																		})}
																	</span>
																	<span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
																		{t("reviewStatus.result.commandCount", {
																			count:
																				artifactPayload.agenticReview
																					.commandsRun?.length ?? 0,
																		})}
																	</span>
																	{agenticStatusCount(
																		artifactPayload,
																		"not_applicable",
																	) > 0 ? (
																		<span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
																			{t(
																				"reviewStatus.result.notApplicableCount",
																				{
																					count: agenticStatusCount(
																						artifactPayload,
																						"not_applicable",
																					),
																				},
																			)}
																		</span>
																	) : null}
																</div>
															) : null}
															{missingCriteria.length > 0 ? (
																<div className="grid gap-1">
																	<div className="font-medium text-amber-100">
																		{t("reviewStatus.result.missingCriteria")}
																	</div>
																	{missingCriteria
																		.slice(0, 5)
																		.map((criterion) => (
																			<div
																				key={criterion}
																				className="text-slate-300"
																			>
																				{criterion}
																			</div>
																		))}
																</div>
															) : null}
															{artifactPayload.agenticReview?.criteria
																?.length ? (
																<div className="grid gap-2">
																	{artifactPayload.agenticReview.criteria
																		.slice(0, 5)
																		.map((item) => (
																			<div
																				key={`${item.status}-${item.criterion}`}
																				className="grid gap-1 rounded border border-slate-800 bg-slate-950/60 p-2"
																			>
																				<div className="flex flex-wrap items-center gap-2">
																					<span className="font-medium text-slate-100">
																						{item.criterion}
																					</span>
																					{item.status ? (
																						<span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
																							{t(
																								`reviewStatus.result.status.${item.status}`,
																							)}
																						</span>
																					) : null}
																					{item.confidence ? (
																						<span className="text-[11px] text-slate-500">
																							{t(
																								"reviewStatus.result.confidence",
																								{
																									value: item.confidence,
																								},
																							)}
																						</span>
																					) : null}
																				</div>
																				{item.evidence?.length ? (
																					<div className="grid gap-1 text-slate-400">
																						<div className="font-medium text-slate-300">
																							{t(
																								"reviewStatus.result.checkedScope",
																							)}
																						</div>
																						{item.evidence
																							.slice(0, 3)
																							.map((evidence, _index) => (
																								<div
																									key={`${item.criterion}-${evidence.kind}-${JSON.stringify(evidence)}`}
																									className="font-mono text-[11px] text-slate-400"
																								>
																									{evidenceLine(evidence)}
																								</div>
																							))}
																					</div>
																				) : null}
																				{item.improvementPrompt ? (
																					<details className="text-slate-300">
																						<summary className="cursor-pointer text-[11px] font-medium text-slate-400">
																							{t(
																								"reviewStatus.result.improvementPrompt",
																							)}
																						</summary>
																						<div className="mt-1 whitespace-pre-wrap text-xs text-slate-300">
																							{item.improvementPrompt}
																						</div>
																					</details>
																				) : null}
																			</div>
																		))}
																</div>
															) : null}
														</div>
													) : null}
												</div>
												<button
													type="button"
													className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
													disabled={!runnable || isSectionBusy}
													onClick={async () => {
														if (!onRunSection) return;
														setBusySection(section.kind);
														setError(null);
														try {
															await onRunSection(section.kind);
														} catch (err) {
															setError(
																err instanceof Error
																	? err.message
																	: t("reviewStatus.error.sectionRunFailed"),
															);
														} finally {
															setBusySection(null);
														}
													}}
												>
													{isSectionBusy ? (
														<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
													) : (
														<Play className="h-3.5 w-3.5" />
													)}
													{t("reviewStatus.action.run")}
												</button>
											</div>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>

				{detail.findings.length > 0 ? (
					<div className="grid gap-3">
						<div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
							{t("reviewStatus.findings")}
						</div>
						<div className="grid gap-2">
							{detail.findings.map((finding) => {
								const findingEdit = findingEdits[finding.id] ?? {
									disposition: finding.disposition ?? "human_callout",
									note: finding.dispositionNote ?? "",
								};
								const setFindingEdit = (
									patch: Partial<{
										disposition: NonNullable<ReviewModeFinding["disposition"]>;
										note: string;
									}>,
								) => {
									setFindingEdits((prev) => ({
										...prev,
										[finding.id]: { ...findingEdit, ...patch },
									}));
								};
								return (
									<div
										key={finding.id}
										className="grid gap-3 rounded border border-slate-800 bg-slate-900/50 p-3"
									>
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-2">
												<span className="text-sm font-medium text-slate-100">
													{finding.title}
												</span>
												<span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
													{reviewStatusValueLabel(
														t,
														"findingSeverity",
														finding.severity,
													)}
												</span>
												<span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
													{reviewStatusValueLabel(
														t,
														"dispositionStatus",
														finding.dispositionStatus,
													)}
												</span>
											</div>
											{finding.body ? (
												<div className="mt-1 text-xs leading-5 text-slate-400">
													{finding.body}
												</div>
											) : null}
										</div>
										<div className="grid gap-2 md:grid-cols-[190px_minmax(0,1fr)_auto]">
											<select
												className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100"
												value={findingEdit.disposition}
												onChange={(event) =>
													setFindingEdit({
														disposition: event.target.value as NonNullable<
															ReviewModeFinding["disposition"]
														>,
													})
												}
											>
												{findingDispositions.map((disposition) => (
													<option key={disposition} value={disposition}>
														{reviewStatusValueLabel(
															t,
															"findingDisposition",
															disposition,
														)}
													</option>
												))}
											</select>
											<input
												className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100"
												value={findingEdit.note}
												placeholder={t(
													"reviewStatus.placeholder.dispositionNote",
												)}
												onChange={(event) =>
													setFindingEdit({ note: event.target.value })
												}
											/>
											<button
												type="button"
												className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
												disabled={
													!onUpdateFindingDisposition ||
													busyFinding === finding.id
												}
												onClick={async () => {
													if (!onUpdateFindingDisposition) return;
													setBusyFinding(finding.id);
													setError(null);
													try {
														await onUpdateFindingDisposition(
															detail.session.id,
															finding.id,
															{
																disposition: findingEdit.disposition,
																note: findingEdit.note,
																evidenceRefs: finding.evidenceRefs,
															},
														);
													} catch (err) {
														setError(
															err instanceof Error
																? err.message
																: t(
																		"reviewStatus.error.findingDispositionFailed",
																	),
														);
													} finally {
														setBusyFinding(null);
													}
												}}
											>
												<Save className="h-3.5 w-3.5" />
												{t("reviewStatus.action.save")}
											</button>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				) : null}

				{activePromptSuggestions.length > 0 ? (
					<div className="grid gap-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
								{t("reviewStatus.promptSuggestions")}
							</div>
							<button
								type="button"
								className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
								disabled={
									!onCreatePromptSuggestions ||
									busyPromptSuggestion?.action === "sync"
								}
								onClick={async () => {
									if (!onCreatePromptSuggestions) return;
									setBusyPromptSuggestion({ id: "sync", action: "sync" });
									setError(null);
									try {
										await onCreatePromptSuggestions(detail.session.id);
									} catch (err) {
										setError(
											err instanceof Error
												? err.message
												: t("reviewStatus.error.promptSuggestionSyncFailed"),
										);
									} finally {
										setBusyPromptSuggestion(null);
									}
								}}
							>
								{busyPromptSuggestion?.action === "sync" ? (
									<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
								) : (
									<ClipboardCheck className="h-3.5 w-3.5" />
								)}
								{t("reviewStatus.action.sync")}
							</button>
						</div>
						<div className="grid gap-3">
							{activePromptSuggestions.map((suggestion) => (
								<div
									key={suggestion.id}
									className="grid gap-3 rounded border border-slate-800 bg-slate-900/60 p-3"
								>
									<div className="flex flex-wrap items-start justify-between gap-2">
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-2">
												<span className="text-sm font-medium text-slate-100">
													{suggestion.title}
												</span>
												<span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
													{reviewStatusValueLabel(
														t,
														"promptSuggestionStatus",
														suggestion.status,
													)}
												</span>
											</div>
											<div className="mt-1 text-xs leading-5 text-slate-400">
												{suggestion.expectedOutcome}
											</div>
											<pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950/70 p-3 text-xs leading-5 text-slate-200">
												{suggestion.prompt}
											</pre>
										</div>
										<div className="flex flex-wrap gap-2">
											<button
												type="button"
												className="inline-flex h-8 items-center justify-center rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
												disabled={
													suggestion.status !== "draft" ||
													!onInsertPromptSuggestion ||
													busyPromptSuggestion?.id === suggestion.id
												}
												onClick={() =>
													onInsertPromptSuggestion?.(suggestion.prompt)
												}
											>
												{t("reviewStatus.action.insertPrompt")}
											</button>
											<button
												type="button"
												className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
												disabled={
													suggestion.status !== "draft" ||
													!onUsePromptSuggestion ||
													busyPromptSuggestion?.id === suggestion.id
												}
												onClick={async () => {
													if (!onUsePromptSuggestion) return;
													setBusyPromptSuggestion({
														id: suggestion.id,
														action: "use",
													});
													setError(null);
													try {
														await onUsePromptSuggestion(
															detail.session.id,
															suggestion.id,
															suggestion.prompt,
														);
													} catch (err) {
														setError(
															err instanceof Error
																? err.message
																: t(
																		"reviewStatus.error.promptSuggestionUseFailed",
																	),
														);
													} finally {
														setBusyPromptSuggestion(null);
													}
												}}
											>
												{busyPromptSuggestion?.id === suggestion.id &&
												busyPromptSuggestion.action === "use" ? (
													<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
												) : null}
												{t("reviewStatus.action.continueWithPrompt")}
											</button>
											<button
												type="button"
												className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
												disabled={
													suggestion.status !== "draft" ||
													!onUpdatePromptSuggestion ||
													busyPromptSuggestion?.id === suggestion.id
												}
												onClick={async () => {
													if (!onUpdatePromptSuggestion) return;
													setBusyPromptSuggestion({
														id: suggestion.id,
														action: "dismiss",
													});
													setError(null);
													try {
														await onUpdatePromptSuggestion(
															detail.session.id,
															suggestion.id,
															{
																status: "dismissed",
															},
														);
													} catch (err) {
														setError(
															err instanceof Error
																? err.message
																: t(
																		"reviewStatus.error.promptSuggestionUpdateFailed",
																	),
														);
													} finally {
														setBusyPromptSuggestion(null);
													}
												}}
											>
												{busyPromptSuggestion?.id === suggestion.id &&
												busyPromptSuggestion.action === "dismiss" ? (
													<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
												) : null}
												{t("reviewStatus.action.discard")}
											</button>
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				) : null}

				{detail.securityHandoffs.length > 0 ? (
					<div className="grid gap-3">
						<div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
							{t("reviewStatus.securityHandoffs")}
						</div>
						<div className="grid gap-2">
							{detail.securityHandoffs.map((handoff) => (
								<div
									key={handoff.id}
									className="grid gap-2 rounded border border-slate-800 bg-slate-900/60 p-3"
								>
									<div className="flex flex-wrap items-center gap-2">
										<ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
										<span className="text-sm font-medium text-slate-100">
											{handoff.title}
										</span>
										<span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
											{reviewStatusValueLabel(
												t,
												"securityHandoffStatus",
												handoff.status,
											)}
										</span>
									</div>
									<div className="text-xs leading-5 text-slate-400">
										{handoff.summary}
									</div>
									{handoff.changedPaths.length > 0 ? (
										<div className="font-mono text-[11px] text-slate-500">
											{handoff.changedPaths.join(", ")}
										</div>
									) : null}
								</div>
							))}
						</div>
					</div>
				) : null}

				<div className="grid gap-3 rounded border border-slate-800 bg-slate-900/60 p-4">
					<div className="flex items-center gap-2 text-sm font-semibold">
						<CheckCircle2 className="h-4 w-4 text-emerald-300" />
						{t("reviewStatus.finalAction")}
					</div>
					{status.finalActionGate.blockingReason ? (
						<div className="rounded border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
							{reviewStatusBlockingReason(
								t,
								status.finalActionGate.blockingReason,
							)}
						</div>
					) : null}
					<div className="flex flex-wrap gap-2">
						{(
							[
								"approve",
								"request_changes",
								"needs_human",
								"exit_review",
							] as const
						).map((action) => (
							<button
								key={action}
								type="button"
								className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-3 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
								disabled={
									busyAction === action ||
									(action === "approve" &&
										!status.finalActionGate.canApprove) ||
									(action === "exit_review" && level === "required") ||
									!onFinalAction
								}
								onClick={async () => {
									if (!onFinalAction) return;
									setBusyAction(action);
									setError(null);
									try {
										await onFinalAction(detail.session.id, { action });
									} catch (err) {
										setError(
											err instanceof Error
												? err.message
												: t("reviewStatus.error.finalActionFailed"),
										);
									} finally {
										setBusyAction(null);
									}
								}}
							>
								{busyAction === action ? (
									<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
								) : null}
								{reviewStatusValueLabel(t, "finalActionType", action)}
							</button>
						))}
					</div>
					<div className="text-xs text-slate-500">
						{t("reviewStatus.finalCounts", {
							promptSuggestionCount: status.promptSuggestionCount,
							securityHandoffCount:
								status.securityHandoffCount ?? detail.securityHandoffs.length,
						})}
					</div>
					{error ? (
						<div className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-100">
							{error}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
