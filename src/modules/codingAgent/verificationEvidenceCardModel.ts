import {
	type EvidenceCheckReadinessSnapshot,
	evidenceCheckConfirmationStatusSchema,
	evidenceCheckMappingStatusSchema,
	evidenceCheckReadinessSnapshotSchema,
	evidenceCheckVerifyStatusSchema,
} from "../../../shared/modules/codingAgent";
import { sanitizeTerminalText } from "../agentsShare";

type EvidenceCheckCardSummary = {
	confirmation:
		| EvidenceCheckReadinessSnapshot["confirmation"]["status"]
		| "checking"
		| "unknown";
	verify: EvidenceCheckReadinessSnapshot["verify"]["status"] | "unknown";
	suggestedAction:
		| EvidenceCheckReadinessSnapshot["suggestedAction"]
		| "wait"
		| "unknown";
	reason?: string;
	mapping?: {
		status: EvidenceCheckReadinessSnapshot["mapping"]["status"];
		matched: number;
		total: number;
	};
};

export type VerificationToolLifecycle =
	| "started"
	| "progress"
	| "result"
	| "failed";

export type VerificationEvidenceSummary = {
	checkKind: string;
	label: string;
	headline: string;
	state: "running" | "passed" | "failed" | "needs_action" | "unknown";
	command?: string;
	resultText?: string;
	exitCode?: number | null;
	evidence: "saved" | "not_saved" | "unknown";
	conditionIds: string[];
	checklist?: {
		complete: boolean;
		failedRequired: number;
		unknownRequired: number;
	} | null;
	qualityGate?: {
		passed: boolean;
		inventory: string;
		testExecution: string;
		fullVerify: string;
	};
	evidenceCheck?: EvidenceCheckCardSummary;
};

export function isCompletedVerificationEvidence(
	lifecycle: VerificationToolLifecycle,
) {
	return lifecycle === "result" || lifecycle === "failed";
}

export function buildManagedVerificationEvidenceSummary(input: {
	args: Record<string, unknown>;
	result: Record<string, unknown>;
	lifecycle: VerificationToolLifecycle;
	defaultCheckKind?: string;
}): VerificationEvidenceSummary {
	const resultView = parseMcpWorkerResult(input.result);
	const payload = resultView.payload;
	const completionResult = record(payload.result);
	const checkKind =
		stringValue(payload.checkKind) ||
		stringValue(input.args.checkKind) ||
		input.defaultCheckKind ||
		"other";
	const exitCode = numberOrNull(payload.exitCode);
	const evidenceCheck =
		checkKind === "completion_check"
			? parseEvidenceCheckSummary({
					completionResult,
					lifecycle: input.lifecycle,
				})
			: undefined;
	const state = evidenceCheck
		? evidenceCheckState(evidenceCheck, input.lifecycle)
		: resolveVerificationState({
				lifecycle: input.lifecycle,
				ok: resultView.ok,
				exitCode,
			});
	const checklist = record(payload.checklist);
	const qualityGate = record(completionResult.qualityGate);
	return buildSummary({
		checkKind,
		state,
		command:
			stringValue(payload.command) ||
			stringValue(input.args.command) ||
			undefined,
		exitCode,
		evidence:
			evidenceCheck?.confirmation === "confirmed" ||
			evidenceCheck?.confirmation === "settled" ||
			payload.managedEvidence === true ||
			stringValue(payload.evidenceRunId)
				? "saved"
				: payload.managedEvidence === false
					? "not_saved"
					: "unknown",
		conditionIds: stringArray(payload.conditionIds ?? input.args.conditionIds),
		checklist:
			typeof checklist.complete === "boolean"
				? {
						complete: checklist.complete,
						failedRequired: numberValue(checklist.failedRequired) ?? 0,
						unknownRequired: numberValue(checklist.unknownRequired) ?? 0,
					}
				: null,
		qualityGate:
			typeof qualityGate.passed === "boolean"
				? {
						passed: qualityGate.passed,
						inventory:
							stringValue(record(qualityGate.inventory).status) || "unknown",
						testExecution:
							stringValue(record(qualityGate.testExecution).status) ||
							"unknown",
						fullVerify:
							stringValue(record(qualityGate.fullVerify).status) || "unknown",
					}
				: undefined,
		evidenceCheck,
		headline: evidenceCheck
			? evidenceCheckHeadline(evidenceCheck, state)
			: undefined,
		llmSummary: stringValue(payload.llmSummary),
		stdout: stringValue(payload.stdout),
		stderr: stringValue(payload.stderr),
	});
}

export function buildCommandVerificationEvidenceSummary(input: {
	data: Record<string, unknown>;
	command: string;
	commandClass: string;
	lifecycle: VerificationToolLifecycle;
}): VerificationEvidenceSummary | undefined {
	if (
		input.commandClass !== "verification" &&
		input.commandClass !== "broad_verification"
	) {
		return undefined;
	}
	const checkKind =
		input.commandClass === "broad_verification"
			? "verify"
			: stringValue(input.data.checkKind) || "other";
	const exitCode = numberOrNull(input.data.exitCode);
	return buildSummary({
		checkKind,
		state: resolveVerificationState({
			lifecycle: input.lifecycle,
			exitCode,
		}),
		command: input.command,
		exitCode,
		evidence: "unknown",
		conditionIds: stringArray(input.data.conditionIds),
		checklist: null,
		llmSummary: "",
		stdout: stringValue(input.data.aggregatedOutput),
		stderr: "",
	});
}

function buildSummary(input: {
	checkKind: string;
	state: VerificationEvidenceSummary["state"];
	command?: string;
	exitCode?: number | null;
	evidence: VerificationEvidenceSummary["evidence"];
	conditionIds: string[];
	checklist: VerificationEvidenceSummary["checklist"];
	qualityGate?: VerificationEvidenceSummary["qualityGate"];
	evidenceCheck?: VerificationEvidenceSummary["evidenceCheck"];
	headline?: string;
	llmSummary: string;
	stdout: string;
	stderr: string;
}): VerificationEvidenceSummary {
	const label = verificationLabel(input.checkKind);
	return {
		checkKind: input.checkKind,
		label,
		headline: input.headline ?? `${label}が${stateLabel(input.state)}`,
		state: input.state,
		command: input.command,
		resultText: buildVerificationResultText(input),
		exitCode: input.exitCode,
		evidence: input.evidence,
		conditionIds: input.conditionIds,
		checklist: input.checklist,
		qualityGate: input.qualityGate,
		evidenceCheck: input.evidenceCheck,
	};
}

function parseEvidenceCheckSummary(input: {
	completionResult: Record<string, unknown>;
	lifecycle: VerificationToolLifecycle;
}): VerificationEvidenceSummary["evidenceCheck"] | undefined {
	if (input.lifecycle === "started" || input.lifecycle === "progress") {
		return {
			confirmation: "checking",
			verify: "unknown",
			suggestedAction: "wait",
		};
	}
	const parsedConfirmation = evidenceCheckConfirmationStatusSchema.safeParse(
		record(input.completionResult.confirmation).status,
	);
	const parsedVerify = evidenceCheckVerifyStatusSchema.safeParse(
		record(input.completionResult.verify).status,
	);
	const parsedSuggestedAction =
		evidenceCheckReadinessSnapshotSchema.shape.suggestedAction.safeParse(
			input.completionResult.suggestedAction,
		);
	const confirmation = parsedConfirmation.success
		? parsedConfirmation.data
		: "";
	const verify = parsedVerify.success ? parsedVerify.data : "";
	const suggestedAction = parsedSuggestedAction.success
		? parsedSuggestedAction.data
		: "";
	if (!confirmation && !verify && !suggestedAction) return undefined;
	const mapping = record(input.completionResult.mapping);
	const parsedMappingStatus = evidenceCheckMappingStatusSchema.safeParse(
		mapping.status,
	);
	const mappingStatus = parsedMappingStatus.success
		? parsedMappingStatus.data
		: "";
	const matched = numberValue(mapping.matched);
	const total = numberValue(mapping.total);
	return {
		confirmation: confirmation || "unknown",
		verify: verify || "unknown",
		suggestedAction: suggestedAction || "unknown",
		...(stringValue(input.completionResult.reason)
			? { reason: stringValue(input.completionResult.reason) }
			: {}),
		...(mappingStatus && matched !== null && total !== null
			? {
					mapping: {
						status: mappingStatus,
						matched,
						total,
					},
				}
			: {}),
	};
}

function evidenceCheckState(
	evidenceCheck: NonNullable<VerificationEvidenceSummary["evidenceCheck"]>,
	lifecycle: VerificationToolLifecycle,
): VerificationEvidenceSummary["state"] {
	if (lifecycle === "started" || lifecycle === "progress") return "running";
	if (
		evidenceCheck.confirmation === "settled" ||
		evidenceCheck.suggestedAction === "write_final_report"
	) {
		return "passed";
	}
	if (evidenceCheck.suggestedAction === "fix_verify") return "failed";
	return "needs_action";
}

function evidenceCheckHeadline(
	evidenceCheck: NonNullable<VerificationEvidenceSummary["evidenceCheck"]>,
	state: VerificationEvidenceSummary["state"],
) {
	if (state === "running") return "Evidence Checkを確認しています";
	if (state === "passed") return "Evidence Checkが完了しました";
	if (evidenceCheck.suggestedAction === "fix_verify") {
		return "Follow-up Verifyの修正が必要です";
	}
	if (evidenceCheck.confirmation === "confirmed") {
		return "Evidence Checkを確認しました";
	}
	if (evidenceCheck.confirmation === "awaiting_confirmation") {
		return "Evidence Checkの確認が必要です";
	}
	if (evidenceCheck.confirmation === "awaiting_initial_verify") {
		return "初回Verifyが必要です";
	}
	return "Evidence Checkの確認結果を受け取りました";
}

function buildVerificationResultText(input: {
	state: VerificationEvidenceSummary["state"];
	checkKind: string;
	exitCode?: number | null;
	llmSummary: string;
	stdout: string;
	stderr: string;
}) {
	const status =
		input.state === "passed"
			? "OK"
			: input.state === "failed"
				? "ERROR"
				: input.state === "running"
					? "RUNNING"
					: "RESULT";
	const rawOutput = [
		sanitizeTerminalText(input.stdout).trim(),
		input.stderr.trim()
			? `stderr\n${sanitizeTerminalText(input.stderr).trim()}`
			: "",
	]
		.filter(Boolean)
		.join("\n\n");
	return [
		`${status} ${input.checkKind}`,
		input.exitCode === undefined
			? ""
			: `exitCode=${input.exitCode ?? "pending"}`,
		sanitizeTerminalText(input.llmSummary).trim(),
		rawOutput,
	]
		.filter(Boolean)
		.join("\n");
}

function resolveVerificationState(input: {
	lifecycle: VerificationToolLifecycle;
	ok?: boolean;
	exitCode?: number | null;
}): VerificationEvidenceSummary["state"] {
	if (input.lifecycle === "started" || input.lifecycle === "progress")
		return "running";
	if (
		input.ok === false ||
		(input.exitCode !== undefined && input.exitCode !== 0)
	)
		return "failed";
	if (input.ok === true || input.exitCode === 0) return "passed";
	if (input.lifecycle === "failed") return "failed";
	return "unknown";
}

function stateLabel(state: VerificationEvidenceSummary["state"]) {
	if (state === "passed") return "完了しました";
	if (state === "failed") return "失敗しました";
	if (state === "running") return "実行中です";
	if (state === "needs_action") return "次の操作が必要です";
	return "結果を受け取りました";
}

function verificationLabel(checkKind: string) {
	const labels: Record<string, string> = {
		lint: "Lintチェック",
		format_check: "フォーマットチェック",
		typecheck: "型チェック",
		test: "テスト",
		coverage: "カバレッジチェック",
		build: "ビルドチェック",
		verify: "総合検証",
		completion_check: "完了条件の確認",
	};
	return labels[checkKind] || "検証チェック";
}

function parseMcpWorkerResult(result: Record<string, unknown>) {
	const structured = record(
		result.structuredContent ?? result.structured_content,
	);
	const structuredPayload = record(structured.payload);
	const parsedText = firstJsonContent(result);
	const parsedPayload = record(parsedText?.payload);
	const payload = Object.keys(structuredPayload).length
		? structuredPayload
		: Object.keys(parsedPayload).length
			? parsedPayload
			: record(result.payload);
	const domainOutcome = stringValue(record(structured.outcome).domainOutcome);
	const ok =
		typeof parsedText?.ok === "boolean"
			? parsedText.ok
			: domainOutcome === "failed"
				? false
				: typeof result.ok === "boolean"
					? result.ok
					: undefined;
	return { payload, ok };
}

function firstJsonContent(result: Record<string, unknown>) {
	if (!Array.isArray(result.content)) return null;
	for (const item of result.content) {
		const text = stringValue(record(item).text).trim();
		if (!text) continue;
		try {
			const parsed = record(JSON.parse(text));
			if (Object.keys(parsed).length) return parsed;
		} catch {
			// Some MCP results contain human-readable text instead of JSON.
		}
	}
	return null;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringValue(value: unknown) {
	return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrNull(value: unknown): number | null | undefined {
	return typeof value === "number" || value === null
		? (value as number | null)
		: undefined;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}
