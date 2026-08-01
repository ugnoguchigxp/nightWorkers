import crypto from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import {
	EVIDENCE_ASSURANCE_POLICY_STRICT_V1,
	type EvidenceAssuranceSnapshot,
	type EvidenceCheckReadinessSnapshot,
	type EvidenceCheckSnapshot,
} from "../../../../shared/modules/codingAgent";
import {
	type CompletionVerificationScope,
	expectedEvidenceSchema,
	isExpectedEvidenceAllowedByCompletionScope,
	specificationVerificationDocumentSchema,
	workspaceSourceSnapshotSchema,
} from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import {
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceRuns,
} from "../../../db/verification-schema";
import { canonicalDigest } from "../../agentsShare";
import { evaluateAcceptanceConditionAssurance } from "./acceptance-condition-assurance.service";
import {
	evaluateEvidenceMappingReadiness,
	resolveEvidenceTestScope,
	unresolvedEvidenceMapping,
} from "./evidence-mapping-readiness.service";
import {
	type EvidenceConfirmationRecord,
	persistEvidenceConfirmation,
	persistEvidenceSettlement,
	readEvidenceConfirmation,
	readEvidenceSettlement,
} from "./evidence-receipt.repository";
import { captureWorkspaceSourceSnapshot } from "./workspace-source-snapshot";

type SnapshotCore = EvidenceCheckReadinessSnapshot;

type InventoryRow = typeof codingAgentTestInventoryRuns.$inferSelect;
type VerifyRunRow = typeof verificationEvidenceRuns.$inferSelect;

export async function evaluateEvidenceReadiness(
	input: {
		taskId: string;
		runId?: string | null;
		verificationDocumentId: string;
		repoRoot: string;
	},
	options: { confirmEvidenceCheck?: boolean } = {},
): Promise<SnapshotCore> {
	const document = await db
		.select()
		.from(verificationDocuments)
		.where(
			and(
				eq(verificationDocuments.id, input.verificationDocumentId),
				eq(verificationDocuments.taskId, input.taskId),
				eq(verificationDocuments.status, "active"),
			),
		)
		.then((rows) => rows[0]);
	if (!document) throw new Error("active_verification_document_not_found");
	const verificationDocumentDigest = canonicalDigest({
		schemaVersion: document.schemaVersion,
		document: document.documentJson,
	});
	const settled = await readEvidenceSettlement(input);
	if (settled) return settled;

	const [current, confirmation, checklist, inventories, verifyRuns] =
		await Promise.all([
			captureWorkspaceSourceSnapshot(input.repoRoot),
			readEvidenceConfirmation(input),
			db
				.select()
				.from(verificationChecklistItems)
				.where(
					and(
						eq(
							verificationChecklistItems.verificationDocumentId,
							input.verificationDocumentId,
						),
						eq(verificationChecklistItems.taskId, input.taskId),
					),
				)
				.orderBy(verificationChecklistItems.conditionId),
			input.runId
				? db
						.select()
						.from(codingAgentTestInventoryRuns)
						.where(
							and(
								eq(codingAgentTestInventoryRuns.taskId, input.taskId),
								eq(codingAgentTestInventoryRuns.runId, input.runId),
							),
						)
						.orderBy(desc(codingAgentTestInventoryRuns.createdAt))
				: Promise.resolve([] as InventoryRow[]),
			input.runId
				? db
						.select()
						.from(verificationEvidenceRuns)
						.where(
							and(
								eq(verificationEvidenceRuns.taskId, input.taskId),
								eq(verificationEvidenceRuns.runId, input.runId),
								eq(
									verificationEvidenceRuns.verificationDocumentId,
									input.verificationDocumentId,
								),
								eq(verificationEvidenceRuns.checkKind, "verify"),
							),
						)
						.orderBy(
							asc(verificationEvidenceRuns.finishedAt),
							asc(verificationEvidenceRuns.createdAt),
							asc(verificationEvidenceRuns.id),
						)
				: Promise.resolve([]),
		]);

	const parsedDocument = specificationVerificationDocumentSchema.safeParse(
		document.documentJson,
	);
	const testScope = resolveEvidenceTestScope(
		parsedDocument.success ? parsedDocument.data.testScope : undefined,
		checklist,
	);
	const explicitTestScope = parsedDocument.success
		? parsedDocument.data.testScope
		: undefined;
	const eligibleVerifyRuns = verifyRuns.filter((run) =>
		verifyEvidenceIsAllowedByScope(run.evidenceKindsJson, explicitTestScope),
	);
	const plannedCommand =
		parsedDocument.success &&
		parsedDocument.data.commands.length === 1 &&
		verifyEvidenceIsAllowedByScope(
			parsedDocument.data.commands[0]?.evidenceKinds ?? [],
			explicitTestScope,
		)
			? parsedDocument.data.commands[0]
			: null;
	const plannedVerifyCommand = plannedCommand
		? {
				id: plannedCommand.id,
				command: plannedCommand.command,
				cwd: plannedCommand.cwd ?? null,
			}
		: null;

	if (confirmation) {
		const strictConfirmation =
			confirmation.policyVersion === EVIDENCE_ASSURANCE_POLICY_STRICT_V1;
		if (
			strictConfirmation &&
			(confirmation.sourceStateHash !== current.sourceStateHash ||
				confirmation.verificationDocumentDigest !== verificationDocumentDigest)
		) {
			const reason =
				confirmation.verificationDocumentDigest !== verificationDocumentDigest
					? "VERIFICATION_DOCUMENT_CHANGED"
					: "EVIDENCE_CONFIRMATION_SOURCE_CHANGED";
			return {
				...confirmation.snapshot,
				sourceStateHash: current.sourceStateHash,
				verify: {
					...confirmation.snapshot.verify,
					status: "stale",
				},
				assurance: {
					...confirmation.snapshot.assurance,
					status: "stale",
					reasonCodes: Array.from(
						new Set([...confirmation.snapshot.assurance.reasonCodes, reason]),
					),
				},
				ready: false,
				suggestedAction: "start_new_run",
				readinessDigest: digest({
					confirmationDigest: confirmation.snapshot.readinessDigest,
					reason,
					currentSourceStateHash: current.sourceStateHash,
					verificationDocumentDigest,
				}),
			};
		}
		const observedIds = new Set(confirmation.observedEvidenceRunIds);
		const followupRuns = eligibleVerifyRuns.filter((run) => {
			if (observedIds.has(run.id)) return false;
			if (!strictConfirmation) return true;
			return followupMatchesStrictConfirmation(run, confirmation);
		});
		const passedFollowup = followupRuns.find(isStablePassedVerify);
		if (passedFollowup && input.runId) {
			const verify = verifySnapshot(passedFollowup, "passed");
			const result: SnapshotCore = {
				...confirmation.snapshot,
				sourceStateHash: confirmation.snapshot.sourceStateHash,
				verify,
				confirmation: {
					...confirmation.snapshot.confirmation,
					status: "settled",
				},
				ready: true,
				suggestedAction: "write_final_report",
				readinessDigest: digest({
					confirmationDigest: confirmation.snapshot.readinessDigest,
					followupEvidenceRunId: passedFollowup.id,
					sourceStateHash: verify.sourceStateHash,
				}),
			};
			return persistEvidenceSettlement({
				taskId: input.taskId,
				runId: input.runId,
				verificationDocumentId: input.verificationDocumentId,
				evidenceRunId: passedFollowup.id,
				confirmationId: confirmation.id,
				receiptDigest: confirmation.receiptDigest,
				result,
			});
		}
		const latestFollowup = followupRuns[followupRuns.length - 1] ?? null;
		if (!latestFollowup) return confirmation.snapshot;
		const followupStatus = verifyAttemptStatus(
			latestFollowup,
			current.sourceStateHash,
		);
		const verify = verifySnapshot(latestFollowup, followupStatus);
		return {
			...confirmation.snapshot,
			sourceStateHash: current.sourceStateHash,
			verify,
			ready: false,
			suggestedAction:
				followupStatus === "failed" ? "fix_verify" : "run_verify",
			readinessDigest: digest({
				confirmationDigest: confirmation.snapshot.readinessDigest,
				followupEvidenceRunId: latestFollowup.id,
				followupStatus,
				sourceStateHash: current.sourceStateHash,
			}),
		};
	}

	const currentVerifyRuns = eligibleVerifyRuns.filter(
		(run) => snapshotHash(run.sourceSnapshotJson) === current.sourceStateHash,
	);
	const latestCurrentVerify =
		currentVerifyRuns[currentVerifyRuns.length - 1] ?? null;
	const initialPassedVerify =
		latestCurrentVerify && isStablePassedVerify(latestCurrentVerify)
			? latestCurrentVerify
			: null;
	const latestVerify =
		latestCurrentVerify ??
		eligibleVerifyRuns[eligibleVerifyRuns.length - 1] ??
		null;
	const verifyStatus = verifyAttemptStatus(
		latestVerify,
		current.sourceStateHash,
	);
	const verify = verifySnapshot(latestVerify, verifyStatus);
	const [mapping, assuranceEvaluation] = await Promise.all([
		input.runId
			? evaluateEvidenceMappingReadiness({
					...input,
					checklist,
					inventories,
					sourceStateHash: current.sourceStateHash,
					testScope,
					settledEvidence: true,
				})
			: Promise.resolve(unresolvedEvidenceMapping(checklist, testScope)),
		input.runId
			? evaluateAcceptanceConditionAssurance({
					taskId: input.taskId,
					runId: input.runId,
					verificationDocumentId: input.verificationDocumentId,
					repoRoot: input.repoRoot,
				})
			: Promise.resolve(null),
	]);
	const assurance = strictAssuranceSnapshot({
		evaluation: assuranceEvaluation,
		verificationDocumentDigest,
	});
	const awaitingConfirmation =
		verifyStatus === "passed" && assurance.status === "passed";
	const result: SnapshotCore = {
		runId: input.runId ?? null,
		sourceStateHash: current.sourceStateHash,
		scope: {
			testScope,
			e2eAllowed:
				testScope === "e2e_if_ui" || testScope === "unit_and_e2e_if_ui",
			authorizedVerifyCommand: latestVerify
				? { id: null, command: latestVerify.command, cwd: latestVerify.cwd }
				: plannedVerifyCommand,
		},
		mapping,
		verify,
		confirmation: {
			status: awaitingConfirmation
				? "awaiting_confirmation"
				: "awaiting_initial_verify",
			initialEvidenceRunId: initialPassedVerify?.id ?? null,
			confirmedAt: null,
		},
		assurance,
		ready: false,
		suggestedAction: awaitingConfirmation
			? "confirm_evidence_check"
			: strictSuggestedAction({ assurance, mapping, verifyStatus }),
		readinessDigest: digest({
			phase: awaitingConfirmation
				? "awaiting_confirmation"
				: "awaiting_initial_verify",
			sourceStateHash: current.sourceStateHash,
			testScope,
			verifyStatus,
			verifyEvidenceId: latestVerify?.id ?? null,
			assuranceStatus: assurance.status,
			assuranceReasons: assurance.reasonCodes,
		}),
	};
	if (
		!options.confirmEvidenceCheck ||
		!initialPassedVerify ||
		!input.runId ||
		assurance.status !== "passed"
	) {
		return result;
	}

	const confirmationSource = await captureWorkspaceSourceSnapshot(
		input.repoRoot,
	);
	if (confirmationSource.sourceStateHash !== current.sourceStateHash) {
		return {
			...result,
			assurance: {
				...result.assurance,
				status: "stale",
				reasonCodes: ["EVIDENCE_CONFIRMATION_SOURCE_CHANGED"],
			},
			suggestedAction: "start_new_run",
			readinessDigest: digest({
				phase: "confirmation_source_changed",
				expected: current.sourceStateHash,
				actual: confirmationSource.sourceStateHash,
			}),
		};
	}
	const confirmedAt = new Date().toISOString();
	const authorizedVerifyDigest = canonicalDigest({
		command: initialPassedVerify.command,
		cwd: initialPassedVerify.cwd,
	});
	const receiptDigest = canonicalDigest({
		policyVersion: EVIDENCE_ASSURANCE_POLICY_STRICT_V1,
		taskId: input.taskId,
		runId: input.runId,
		verificationDocumentId: input.verificationDocumentId,
		verificationDocumentDigest,
		sourceStateHash: current.sourceStateHash,
		initialEvidenceRunId: initialPassedVerify.id,
		authorizedVerifyDigest,
		mapping,
		conditions: assurance.conditions,
	});
	const confirmedResult: SnapshotCore = {
		...result,
		confirmation: {
			status: "confirmed",
			initialEvidenceRunId: initialPassedVerify.id,
			confirmedAt,
		},
		assurance: {
			...assurance,
			receiptDigest,
		},
		suggestedAction: "run_verify",
		readinessDigest: digest({
			phase: "confirmed",
			initialEvidenceRunId: initialPassedVerify.id,
			confirmedAt,
			receiptDigest,
		}),
	};
	return persistEvidenceConfirmation({
		taskId: input.taskId,
		runId: input.runId,
		verificationDocumentId: input.verificationDocumentId,
		initialEvidenceRunId: initialPassedVerify.id,
		observedEvidenceRunIds: eligibleVerifyRuns.map((run) => run.id),
		policyVersion: EVIDENCE_ASSURANCE_POLICY_STRICT_V1,
		sourceStateHash: current.sourceStateHash,
		verificationDocumentDigest,
		authorizedVerifyDigest,
		receiptDigest,
		result: confirmedResult,
	});
}

function strictAssuranceSnapshot(input: {
	evaluation: Awaited<
		ReturnType<typeof evaluateAcceptanceConditionAssurance>
	> | null;
	verificationDocumentDigest: string;
}): EvidenceAssuranceSnapshot {
	const reasonCodes = Array.from(
		new Set(
			input.evaluation
				? [
						...input.evaluation.conditions.flatMap((condition) =>
							condition.reasonCode ? [condition.reasonCode] : [],
						),
						...(input.evaluation.qualityGate.fullVerify.reason
							? [input.evaluation.qualityGate.fullVerify.reason]
							: []),
					]
				: (["FULL_VERIFY_MISSING"] as const),
		),
	);
	return {
		policyVersion: EVIDENCE_ASSURANCE_POLICY_STRICT_V1,
		status: input.evaluation?.passed ? "passed" : "failed",
		verificationDocumentDigest: input.verificationDocumentDigest,
		receiptDigest: null,
		conditions: input.evaluation?.conditions ?? [],
		reasonCodes,
	};
}

function strictSuggestedAction(input: {
	assurance: EvidenceAssuranceSnapshot;
	mapping: EvidenceCheckSnapshot["mapping"];
	verifyStatus: EvidenceCheckSnapshot["verify"]["status"];
}): EvidenceCheckSnapshot["suggestedAction"] {
	if (input.verifyStatus === "failed") return "fix_verify";
	if (input.verifyStatus !== "passed") return "run_verify";
	if (
		input.mapping.status === "missing" ||
		input.mapping.status === "stale" ||
		input.mapping.status === "ambiguous" ||
		input.assurance.reasonCodes.includes("TEST_INVENTORY_MISSING") ||
		input.assurance.reasonCodes.includes("CONDITION_MAPPING_MISSING")
	) {
		return "record_mapping";
	}
	if (input.assurance.reasonCodes.includes("MANUAL_CONFIRMATION_MISSING")) {
		return "request_human_confirmation";
	}
	return "run_structured_tests";
}

function followupMatchesStrictConfirmation(
	run: VerifyRunRow,
	confirmation: EvidenceConfirmationRecord,
) {
	const authorized = confirmation.snapshot.scope.authorizedVerifyCommand;
	const confirmedAt = confirmation.snapshot.confirmation.confirmedAt;
	if (
		!authorized ||
		!confirmedAt ||
		!confirmation.sourceStateHash ||
		run.command !== authorized.command ||
		run.cwd !== authorized.cwd ||
		run.finishedAt.getTime() <= Date.parse(confirmedAt) ||
		snapshotHash(run.sourceSnapshotJson) !== confirmation.sourceStateHash
	) {
		return false;
	}
	return (
		!confirmation.authorizedVerifyDigest ||
		confirmation.authorizedVerifyDigest ===
			canonicalDigest({ command: run.command, cwd: run.cwd })
	);
}

function verifyEvidenceIsAllowedByScope(
	evidenceKinds: string[],
	testScope: CompletionVerificationScope | undefined,
): boolean {
	// Legacy aggregate verify evidence has no granular evidenceKinds. checkKind
	// already identifies it as the Project gate, so keep it completion-eligible.
	if (evidenceKinds.length === 0) return true;
	return evidenceKinds.every((kind) => {
		const parsed = expectedEvidenceSchema.safeParse(kind);
		return (
			parsed.success &&
			isExpectedEvidenceAllowedByCompletionScope(parsed.data, testScope)
		);
	});
}

function isStablePassedVerify(run: VerifyRunRow) {
	return (
		run.exitCode === 0 &&
		!run.sourceMutatedDuringCheck &&
		Boolean(snapshotHash(run.sourceSnapshotJson))
	);
}

function verifyAttemptStatus(
	run: VerifyRunRow | null,
	currentSourceStateHash: string,
): EvidenceCheckSnapshot["verify"]["status"] {
	if (!run) return "not_run";
	const sourceStateHash = snapshotHash(run.sourceSnapshotJson);
	if (
		!sourceStateHash ||
		sourceStateHash !== currentSourceStateHash ||
		run.sourceMutatedDuringCheck
	) {
		return "stale";
	}
	return run.exitCode === 0 ? "passed" : "failed";
}

function verifySnapshot(
	run: VerifyRunRow | null,
	status: EvidenceCheckSnapshot["verify"]["status"],
): EvidenceCheckSnapshot["verify"] {
	return {
		status,
		command: run?.command ?? null,
		cwd: run?.cwd ?? null,
		exitCode: run?.exitCode ?? null,
		sourceStateHash: run ? snapshotHash(run.sourceSnapshotJson) : null,
		finishedAt: run?.finishedAt.toISOString() ?? null,
		logRefs: run ? [run.rawStdoutArtifactId, run.rawStderrArtifactId] : [],
	};
}

function snapshotHash(value: unknown) {
	const parsed = workspaceSourceSnapshotSchema.safeParse(value);
	return parsed.success ? parsed.data.sourceStateHash : null;
}

function digest(value: unknown) {
	return `sha256:${crypto
		.createHash("sha256")
		.update(JSON.stringify(value))
		.digest("hex")}`;
}
