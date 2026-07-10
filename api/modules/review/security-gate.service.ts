import path from "node:path";
import {
	type SecurityGateResult,
	securityGateResultSchema,
} from "../../../shared/schemas/security-oracle.schema";
import * as repo from "../nightworkers/nightworkers.repository";
import {
	runVulnWorkbenchSecurityDiagnostic,
	type VulnWorkbenchSecurityResult,
	type VulnWorkbenchTopFinding,
} from "./review-vulnworkbench.service";

const SECURITY_GATE_ACTION = "security.oracle_gate_finished";
const SECURITY_FIX_PROCEDURE = "security_oracle_fix";

export async function runSecurityOracleGate(input: {
	runId: string;
	taskId: string;
	repoRoot: string;
	maxIterations: number;
}): Promise<SecurityGateResult> {
	const [todos, history] = await Promise.all([
		repo.listTaskRunTodosForRun(input.runId),
		listSecurityGateHistory(input.taskId),
	]);
	const previous = history.at(-1) ?? null;
	const iteration = nextSecurityGateIteration(previous);
	const maxIterations = input.maxIterations;

	if (!hasSuccessfulRepositoryVerifyEvidence(todos)) {
		return persistGateResult(input, {
			version: 1,
			status: "needs_human",
			allowFinalize: false,
			scanRunId: null,
			previousScanRunId: previous?.scanRunId ?? null,
			blockingFingerprints: [],
			previousBlockingFingerprints: previous?.blockingFingerprints ?? [],
			comparison: "scanner_failed",
			iteration,
			maxIterations,
			message:
				"Security Oracle cannot finalize because repository verification has no successful quality_gate_verify evidence.",
			findingCount: 0,
			highOrCriticalCount: 0,
			securityFixTodoId: null,
		});
	}

	const diagnostic = await runVulnWorkbenchSecurityDiagnostic({
		target: { repoRoot: input.repoRoot, targetFiles: [] },
		artifactDir: "",
	});
	const comparison = compareSecurityFingerprints(previous, diagnostic);
	const base = {
		version: 1 as const,
		scanRunId: diagnostic.scanRunId,
		previousScanRunId: previous?.scanRunId ?? null,
		blockingFingerprints: diagnostic.blockingFingerprints,
		previousBlockingFingerprints: previous?.blockingFingerprints ?? [],
		comparison,
		iteration,
		maxIterations,
		findingCount: diagnostic.findingCount,
		highOrCriticalCount: diagnostic.highOrCriticalCount,
		securityFixTodoId: null,
	};

	if (isCleanSecurityDiagnostic(diagnostic)) {
		const passed = await persistGateResult(input, {
			...base,
			status: "passed",
			allowFinalize: true,
			message:
				comparison === "resolved"
					? "Security Oracle rerun confirmed that all previous blocking fingerprints are resolved."
					: "Security Oracle completed without blocking findings.",
		});
		if (comparison === "resolved") {
			await persistResolvedSecurityKnowledgeCandidate(input);
		}
		return passed;
	}

	if (diagnostic.status === "security_action_required") {
		const scopedFindings = blockingScopedSecurityFindings(diagnostic);
		const completeBlockingIdentity =
			diagnostic.blockingFingerprints.length === diagnostic.highOrCriticalCount;
		const allBlockingFindingsHaveScope =
			scopedFindings.length === diagnostic.highOrCriticalCount;
		if (
			!completeBlockingIdentity ||
			!allBlockingFindingsHaveScope ||
			diagnostic.blockingFingerprints.length === 0
		) {
			return persistGateResult(input, {
				...base,
				status: "needs_human",
				allowFinalize: false,
				message:
					"Security Oracle reported blocking findings without a complete, repository-scoped fingerprint/location set.",
			});
		}
		if (!hasSecurityFixIterationBudget(iteration, maxIterations)) {
			return persistGateResult(input, {
				...base,
				status: "needs_human",
				allowFinalize: false,
				message: `Security Oracle still reports blocking findings at iteration ${iteration}/${maxIterations}.`,
			});
		}
		const todo = await createSecurityFixTodo({
			...input,
			iteration,
			maxIterations,
			diagnostic,
			findings: scopedFindings,
		});
		return persistGateResult(input, {
			...base,
			status: "continue",
			allowFinalize: false,
			message: `Security Oracle requires a scoped security fix before finalization (iteration ${iteration}/${maxIterations}).`,
			securityFixTodoId: todo.id,
		});
	}

	return persistGateResult(input, {
		...base,
		status: "needs_human",
		allowFinalize: false,
		comparison: "scanner_failed",
		message:
			diagnostic.error ||
			`Security Oracle returned ${diagnostic.status}; finalization is blocked.`,
	});
}

export async function readLatestSecurityGateResult(runId: string) {
	const events = await repo.listTaskEventsForRun(runId);
	return (
		events
			.map(readSecurityGateResultFromEvent)
			.filter((item): item is SecurityGateResult => item !== null)
			.at(-1) ?? null
	);
}

export function hasSuccessfulRepositoryVerifyEvidence(
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>,
) {
	return todos.some(
		(todo) =>
			todo.procedureId === "quality_gate_verify" &&
			["passed", "done", "completed"].includes(todo.status),
	);
}

async function listSecurityGateHistory(taskId: string) {
	const runs = await repo.listTaskRunsForTask(taskId);
	const results: SecurityGateResult[] = [];
	for (const run of [...runs].reverse()) {
		const events = await repo.listTaskEventsForRun(run.id);
		for (const event of events) {
			const result = readSecurityGateResultFromEvent(event);
			if (result) results.push(result);
		}
	}
	return results;
}

function readSecurityGateResultFromEvent(event: { payloadJson?: unknown }) {
	const payload = asRecord(event.payloadJson);
	const runEvent = asRecord(payload.runEvent);
	const data = {
		...asRecord(payload.data),
		...asRecord(runEvent.data),
	};
	if (data.action !== SECURITY_GATE_ACTION) return null;
	const parsed = securityGateResultSchema.safeParse(data.securityGate);
	return parsed.success ? parsed.data : null;
}

async function persistGateResult(
	input: { runId: string; taskId: string },
	result: SecurityGateResult,
) {
	const parsed = securityGateResultSchema.parse(result);
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "system.info",
		severity: parsed.status === "passed" ? "checkpoint" : "warning",
		actor: "system",
		message: parsed.message,
		data: { action: SECURITY_GATE_ACTION, securityGate: parsed },
	});
	return parsed;
}

export function isCleanSecurityDiagnostic(result: VulnWorkbenchSecurityResult) {
	return (
		result.status === "completed" &&
		result.ok &&
		result.highOrCriticalCount === 0 &&
		result.blockingFingerprints.length === 0
	);
}

export function compareSecurityFingerprints(
	previous: SecurityGateResult | null,
	current: VulnWorkbenchSecurityResult,
): SecurityGateResult["comparison"] {
	if (!current.ok || current.status === "inconclusive") return "scanner_failed";
	if (!previous || previous.blockingFingerprints.length === 0) return "initial";
	if (current.blockingFingerprints.length === 0) return "resolved";
	const currentSet = new Set(current.blockingFingerprints);
	return previous.blockingFingerprints.some((item) => currentSet.has(item))
		? "still_present"
		: "changed";
}

export function nextSecurityGateIteration(previous: SecurityGateResult | null) {
	return previous &&
		!previous.allowFinalize &&
		previous.blockingFingerprints.length > 0
		? previous.iteration + 1
		: 1;
}

export function hasSecurityFixIterationBudget(
	iteration: number,
	maxIterations: number,
) {
	return iteration <= maxIterations;
}

export function blockingScopedSecurityFindings(
	result: VulnWorkbenchSecurityResult,
) {
	const blocking = new Set(result.blockingFingerprints);
	return result.topFindings.filter(
		(finding) =>
			blocking.has(finding.fingerprint) &&
			isSafeRepositoryRelativePath(finding.location?.path),
	);
}

function isSafeRepositoryRelativePath(value: string | null | undefined) {
	if (!value || path.isAbsolute(value)) return false;
	const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
	return normalized !== ".." && !normalized.startsWith("../");
}

async function createSecurityFixTodo(input: {
	runId: string;
	taskId: string;
	iteration: number;
	maxIterations: number;
	diagnostic: VulnWorkbenchSecurityResult;
	findings: VulnWorkbenchTopFinding[];
}) {
	const todos = await repo.listTaskRunTodosForRun(input.runId);
	const openFinalReportTodo = todos.find(
		(todo) =>
			["pending", "running"].includes(todo.status) &&
			todo.procedureId === "final_completion_report",
	);
	let nextSeq = Math.max(0, ...todos.map((todo) => todo.seq)) + 1;
	const findingLines = input.findings.flatMap((finding) => [
		`- [${finding.severity}] ${finding.title}`,
		`  fingerprint: ${finding.fingerprint}`,
		`  rule: ${finding.tool}/${finding.ruleId}`,
		`  location: ${finding.location?.path}${finding.location?.line ? `:${finding.location.line}` : ""}`,
		`  recommendation: ${finding.recommendation}`,
	]);
	const todoData = {
		title: "Security Oracle の blocking finding を解消する",
		description: [
			`iteration: ${input.iteration}/${input.maxIterations}`,
			...findingLines,
			"Non-goals: repository 外の変更、scanner rule の無効化、検出結果の隠蔽。",
			"Acceptance: 対象修正後に repo-native verify を成功させ、同じ oracle-security command を再実行して blocking fingerprint の消失を確認する。",
		].join("\n"),
		taskType: "security_fix",
		status: "pending",
		procedureId: SECURITY_FIX_PROCEDURE,
		contextSnapshot: {
			iteration: input.iteration,
			maxIterations: input.maxIterations,
			scanRunId: input.diagnostic.scanRunId,
			blockingFingerprints: input.diagnostic.blockingFingerprints,
			findings: input.findings,
		},
		evidenceRequirementsJson: {
			repositoryVerify: true,
			oracleRerun: true,
			blockingFingerprintsResolved: input.diagnostic.blockingFingerprints,
		},
	};
	const securityFixTodo = openFinalReportTodo
		? await repo.updateTaskRunTodo(
				openFinalReportTodo.id,
				{
					...todoData,
					status: "pending",
					startedAt: null,
					completedAt: null,
				},
				{ notifyTaskId: input.taskId, notifyRunId: input.runId },
			)
		: await repo.createTaskRunTodo({
				...todoData,
				runId: input.runId,
				seq: nextSeq++,
				status: "pending",
			});
	if (!securityFixTodo) {
		throw new Error("Failed to create Security Oracle remediation Todo.");
	}
	const securityFixSeq = securityFixTodo.seq;
	await repo.createTaskRunTodo({
		runId: input.runId,
		seq: nextSeq++,
		title: "Security fix 後の repository verify を実行する",
		description:
			"Security fix の変更後に repo-native broad verification を成功させる。",
		taskType: "verification",
		status: "pending",
		procedureId: "quality_gate_verify",
		dependsOn: [securityFixSeq],
		evidenceRequirementsJson: {
			repositoryVerify: true,
			afterSecurityFix: true,
		},
	});
	await repo.createTaskRunTodo({
		runId: input.runId,
		seq: nextSeq,
		title: "完了報告を行う",
		description: "Security Oracle rerun が pass した後に最終報告を確定する。",
		taskType: "completion_report",
		status: "pending",
		procedureId: "final_completion_report",
		dependsOn: [nextSeq - 1],
	});
	return securityFixTodo;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

async function persistResolvedSecurityKnowledgeCandidate(input: {
	runId: string;
	taskId: string;
}) {
	const securityTodo = await findLatestSecurityFixTodo(input);
	const context = asRecord(securityTodo?.contextSnapshot);
	const reusableRules = Array.isArray(context.findings)
		? context.findings
				.map(asRecord)
				.map((finding) => ({
					tool: typeof finding.tool === "string" ? finding.tool : null,
					ruleId: typeof finding.ruleId === "string" ? finding.ruleId : null,
					recommendation:
						typeof finding.recommendation === "string"
							? finding.recommendation
							: null,
				}))
				.filter((item) => item.tool && item.ruleId && item.recommendation)
		: [];
	if (reusableRules.length === 0) return;
	const artifact = await repo.createArtifact({
		runId: input.runId,
		kind: "security_knowledge_candidate",
		path: `nightworkers://knowledge-candidate/security/${input.runId}`,
		metadataJson: {
			status: "pending_registration",
			candidateKind: "verified_security_remediation",
			rules: reusableRules,
			verification: {
				repositoryVerify: "passed",
				oracleRerun: "resolved",
			},
			redaction: {
				fingerprintsIncluded: false,
				repositoryPathsIncluded: false,
				rawScannerOutputIncluded: false,
			},
		},
	});
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "system.info",
		severity: "info",
		actor: "system",
		message:
			"Verified and redacted security remediation candidate is ready for explicit knowledge registration.",
		data: {
			action: "security.knowledge_candidate_created",
			artifactId: artifact.id,
			status: "pending_registration",
		},
	});
}

async function findLatestSecurityFixTodo(input: {
	runId: string;
	taskId: string;
}) {
	const runs = await repo.listTaskRunsForTask(input.taskId);
	const orderedRunIds = [
		input.runId,
		...runs.map((run) => run.id).filter((runId) => runId !== input.runId),
	];
	for (const runId of orderedRunIds) {
		const todos = await repo.listTaskRunTodosForRun(runId);
		const securityTodo = [...todos]
			.reverse()
			.find((todo) => todo.procedureId === SECURITY_FIX_PROCEDURE);
		if (securityTodo) return securityTodo;
	}
	return null;
}
