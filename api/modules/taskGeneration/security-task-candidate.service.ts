import crypto from "node:crypto";
import { z } from "@hono/zod-openapi";
import {
	type SecurityScanTaskCandidatesResult,
	securityScanTaskCandidatesResultSchema,
} from "../../../shared/schemas/security-task-generation.schema";
import {
	MISSION_TASK_CANDIDATE_MAX_COUNT,
	type TaskGenerationLlmUsage,
} from "../../../shared/schemas/task-generation.schema";
import { AppError } from "../../lib/errors";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import type { SupervisorLlmDebugEvent } from "../../services/structured-llm";
import {
	buildNormalizedSupervisorLlmRequest,
	createStructuredOutputContract,
	mergeStructuredLlmCallUsage,
	type StructuredLlmIssue,
	structuredLlmAttemptValueText,
	structuredLlmCallUsageFromEvent,
} from "../../services/structured-llm";
import { StructuredLlmResponseError } from "../../services/structured-llm/contract";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import { p } from "../../systemContexts/catalog";
import { loadSecurityScanTaskGenerationEvidence } from "../securityScan/security-scan-evidence.service";
import * as securityRepo from "./security-task-candidate.repository";
import * as repo from "./task-generation.repository";

const SECURITY_TASK_SCHEMA_NAME = "security_task_candidates";
const MAX_SECURITY_TASK_PROMPT_CHARS = 180_000;
const generationQueues = new Map<string, Promise<void>>();

export function buildSecurityTaskCandidatesResponseJsonSchema() {
	return normalizeStructuredOutputJsonSchema(
		z.toJSONSchema(securityScanTaskCandidatesResultSchema),
	);
}

function selectedModelForPrompt(systemPrompt: string, userPrompt: string) {
	const normalized = buildNormalizedSupervisorLlmRequest({
		systemPrompt,
		userPrompt,
		label: SECURITY_TASK_SCHEMA_NAME,
		role: "mission_task_generation",
		jsonSchema: {
			name: SECURITY_TASK_SCHEMA_NAME,
			schema: buildSecurityTaskCandidatesResponseJsonSchema(),
		},
	});
	return {
		role: "mission_task_generation",
		providerId: normalized.providerId,
		providerEndpointId: normalized.providerEndpointId ?? null,
		routeSource: normalized.routeSource ?? null,
		modelOrDeployment: normalized.modelOrDeployment,
		thinkingDepth: normalized.thinkingDepth ?? null,
	};
}

function selectionFromLlmEvent(event: SupervisorLlmDebugEvent) {
	if (event.type !== "model.request_started") return null;
	const data = event.data || {};
	return {
		role: "mission_task_generation",
		providerId: typeof data.provider === "string" ? data.provider : "unknown",
		providerEndpointId:
			typeof data.providerEndpointId === "string"
				? data.providerEndpointId
				: null,
		routeSource: typeof data.routeSource === "string" ? data.routeSource : null,
		modelOrDeployment: typeof data.model === "string" ? data.model : null,
		thinkingDepth:
			typeof data.thinkingDepth === "string" ? data.thinkingDepth : null,
	};
}

function attachLlmUsage(
	selectedModel: unknown,
	llmUsage: TaskGenerationLlmUsage | null,
) {
	return selectedModel && typeof selectedModel === "object"
		? { ...selectedModel, llmUsage }
		: { selection: selectedModel ?? null, llmUsage };
}

export function validateSecurityTaskCandidateFacts(
	value: SecurityScanTaskCandidatesResult,
	selectedFindingRefs: ReadonlySet<string>,
): StructuredLlmIssue[] {
	const issues: StructuredLlmIssue[] = [];
	const assigned = new Map<string, string>();
	const candidateTitles = new Set<string>();
	for (const [candidateIndex, candidate] of value.candidates.entries()) {
		const normalizedTitle = candidate.title.toLocaleLowerCase();
		if (candidateTitles.has(normalizedTitle)) {
			issues.push({
				stage: "fact",
				path: ["candidates", candidateIndex, "title"],
				code: "duplicate_candidate_title",
				message: `同じtitleのTask候補が複数あります: ${candidate.title}`,
			});
		}
		candidateTitles.add(normalizedTitle);
		for (const [findingIndex, findingRef] of candidate.findingRefs.entries()) {
			if (!selectedFindingRefs.has(findingRef)) {
				issues.push({
					stage: "fact",
					path: ["candidates", candidateIndex, "findingRefs", findingIndex],
					code: "unknown_finding_reference",
					message: `選択されていないFindingを参照しています: ${findingRef}`,
				});
			}
			const prior = assigned.get(findingRef);
			if (prior) {
				issues.push({
					stage: "fact",
					path: ["candidates", candidateIndex, "findingRefs", findingIndex],
					code: "duplicate_finding_assignment",
					message: `Findingが複数箇所に割り当てられています: ${findingRef} (${prior})`,
				});
			}
			assigned.set(findingRef, `candidate:${candidateIndex}`);
		}
	}
	for (const [index, item] of value.needsHuman.entries()) {
		if (!selectedFindingRefs.has(item.findingRef)) {
			issues.push({
				stage: "fact",
				path: ["needsHuman", index, "findingRef"],
				code: "unknown_finding_reference",
				message: `選択されていないFindingを参照しています: ${item.findingRef}`,
			});
		}
		const prior = assigned.get(item.findingRef);
		if (prior) {
			issues.push({
				stage: "fact",
				path: ["needsHuman", index, "findingRef"],
				code: "duplicate_finding_assignment",
				message: `Findingが複数箇所に割り当てられています: ${item.findingRef} (${prior})`,
			});
		}
		assigned.set(item.findingRef, `needsHuman:${index}`);
	}
	for (const findingRef of selectedFindingRefs) {
		if (assigned.has(findingRef)) continue;
		issues.push({
			stage: "fact",
			path: ["candidates"],
			code: "missing_finding_assignment",
			message: `選択されたFindingが候補にも要確認にも含まれていません: ${findingRef}`,
		});
	}
	return issues;
}

export function generateSecurityScanTaskCandidates(input: {
	repositoryId: string;
	scanRunRef: string;
	findingRefs: string[];
}) {
	return serializeSecurityTaskGeneration(input.repositoryId, () =>
		generateSecurityScanTaskCandidatesSerialized(input),
	);
}

async function generateSecurityScanTaskCandidatesSerialized(input: {
	repositoryId: string;
	scanRunRef: string;
	findingRefs: string[];
}) {
	const evidence = await loadSecurityScanTaskGenerationEvidence(input);
	await repo.reactivateDeletedTaskMissionCandidates(input.repositoryId);
	const matches = await securityRepo.listActiveSecurityFindingMatches({
		repositoryId: input.repositoryId,
		fingerprintHashes: evidence.snapshot.findings.map(
			(finding) => finding.fingerprintHash,
		),
	});
	const matchByFingerprint = new Map(
		matches.map((match) => [match.fingerprintHash, match]),
	);
	const duplicates = evidence.snapshot.findings.flatMap((finding) => {
		const match = matchByFingerprint.get(finding.fingerprintHash);
		return match
			? [
					{
						findingRef: finding.ref,
						candidateId: match.candidateId,
						taskId: match.taskId,
					},
				]
			: [];
	});
	const findings = evidence.snapshot.findings.filter(
		(finding) => !matchByFingerprint.has(finding.fingerprintHash),
	);
	if (findings.length === 0) {
		return {
			batchId: null,
			status: "completed" as const,
			candidates: [],
			duplicates,
			needsHuman: [],
			coverageWarnings: evidence.coverageWarnings,
			llmUsage: null,
		};
	}

	const generationSnapshot = { ...evidence.snapshot, findings };
	const userPrompt = JSON.stringify(generationSnapshot, null, 2);
	if (userPrompt.length > MAX_SECURITY_TASK_PROMPT_CHARS) {
		throw new AppError(
			422,
			"SECURITY_TASK_GENERATION_CONTEXT_TOO_LARGE",
			"選択したFindingの情報量が大きすぎます。選択件数を減らして再実行してください。",
		);
	}
	const batch = await repo.createRunningMissionBatch({
		repositoryId: input.repositoryId,
		requestedGoalIds: [],
		signalSnapshot: generationSnapshot,
	});
	const systemPrompt = p("taskGeneration.security-remediation", {
		maxCount: MISSION_TASK_CANDIDATE_MAX_COUNT,
	});
	const contract = createStructuredOutputContract({
		name: SECURITY_TASK_SCHEMA_NAME,
		runtimeSchema: securityScanTaskCandidatesResultSchema,
		providerJsonSchema: buildSecurityTaskCandidatesResponseJsonSchema(),
	});
	let selectedModel: unknown = selectedModelForPrompt(systemPrompt, userPrompt);
	let llmUsage: TaskGenerationLlmUsage | null = null;
	try {
		const selectedFindingRefs = new Set(findings.map((finding) => finding.ref));
		const generated = await callStructuredOutputWithRepair({
			systemPrompt,
			userPrompt,
			options: {
				role: "mission_task_generation",
				contract,
				emitEvent: async (event) => {
					const nextSelection = selectionFromLlmEvent(event);
					if (nextSelection) selectedModel = nextSelection;
					const usage = structuredLlmCallUsageFromEvent(event);
					if (usage) {
						llmUsage = {
							stage: "task_candidates",
							...mergeStructuredLlmCallUsage(llmUsage, usage),
						};
					}
				},
			},
			validateFacts: (value) =>
				validateSecurityTaskCandidateFacts(value, selectedFindingRefs),
		});
		const acceptedAttempt = generated.attempts.at(-1);
		const rawOutput = JSON.parse(
			acceptedAttempt
				? structuredLlmAttemptValueText(acceptedAttempt)
				: JSON.stringify(generated.value),
		) as unknown;
		const findingByRef = new Map(
			findings.map((finding) => [finding.ref, finding]),
		);
		const now = new Date();
		const candidateRows = generated.value.candidates.map((candidate) => {
			const sourceFindings = candidate.findingRefs.map((findingRef) => {
				const finding = findingByRef.get(findingRef);
				if (!finding) {
					throw new AppError(
						500,
						"SECURITY_TASK_CANDIDATE_FINDING_NOT_FOUND",
						`候補が参照するFindingを解決できません: ${findingRef}`,
					);
				}
				return finding;
			});
			const source = {
				kind: "security_scan" as const,
				scanRunRef: evidence.snapshot.scan.scanRunRef,
				targetDigest: evidence.snapshot.scan.target.digest,
				sourceRevision: evidence.snapshot.scan.target.sourceRevision,
				findings: sourceFindings.map((finding) => ({
					ref: finding.ref,
					fingerprintHash: finding.fingerprintHash,
					severity: finding.severity,
					title: finding.title,
				})),
			};
			return {
				id: crypto.randomUUID(),
				createdAt: now,
				updatedAt: now,
				batchId: batch.id,
				repositoryId: input.repositoryId,
				goalId: null,
				sourceKind: source.kind,
				sourceRefJson: source,
				candidateKind: candidate.candidateKind,
				primaryModule: candidate.moduleRouting.primaryModule,
				secondaryModulesJson: candidate.moduleRouting.secondaryModules,
				routingConfidencePercent: candidate.moduleRouting.confidencePercent,
				routingReason: candidate.moduleRouting.reason,
				constraintGoalIdsJson: [],
				planModeOpenQuestionsJson: candidate.planModeOpenQuestions,
				title: candidate.title,
				summary: candidate.summary,
				rationale: candidate.rationale,
				evidenceJson: [
					{
						source: "security_scan" as const,
						label: "Security scan",
						value: evidence.snapshot.scan.scanRunRef,
					},
					{
						source: "security_scan" as const,
						label: "Finding refs",
						value: candidate.findingRefs.join(", ").slice(0, 280),
					},
				],
				evaluationContribution: null,
				importancePercent: candidate.importancePercent,
				confidencePercent: candidate.confidencePercent,
				tokenSize: candidate.tokenSize,
				complexity: candidate.complexity,
				taskPrompt: candidate.taskPrompt,
				acceptanceCriteria: candidate.acceptanceCriteria,
				verificationPlan: candidate.verificationPlan,
				status: "candidate",
			};
		});
		const candidates =
			await securityRepo.completeSecurityScanCandidateGeneration({
				batchId: batch.id,
				candidates: candidateRows,
				links: candidateRows.flatMap((candidate) => {
					const source = candidate.sourceRefJson;
					return source.findings.map((finding) => ({
						candidateId: candidate.id,
						repositoryId: candidate.repositoryId,
						scanRunRef: source.scanRunRef,
						findingRef: finding.ref,
						fingerprintHash: finding.fingerprintHash,
					}));
				}),
				rawOutput,
				selectedModel: attachLlmUsage(selectedModel, llmUsage),
			});
		return {
			batchId: batch.id,
			status: "completed" as const,
			candidates,
			duplicates,
			needsHuman: generated.value.needsHuman,
			coverageWarnings: evidence.coverageWarnings,
			llmUsage,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await repo.failMissionBatch({
			batchId: batch.id,
			errorMessage: message,
			rawOutput:
				error instanceof StructuredLlmResponseError ? error.rawText : undefined,
			selectedModel: attachLlmUsage(selectedModel, llmUsage),
		});
		if (error instanceof StructuredLlmResponseError) {
			throw new AppError(
				502,
				"SECURITY_TASK_CANDIDATE_RESPONSE_INVALID",
				error.rawText,
				{
					responseTextOrigin: "llm",
					issues: error.issues,
					attempts: error.attempts,
					validationByAttempt: error.validationByAttempt,
				},
			);
		}
		throw error;
	}
}

function serializeSecurityTaskGeneration<T>(
	repositoryId: string,
	operation: () => Promise<T>,
) {
	const previous = generationQueues.get(repositoryId) ?? Promise.resolve();
	const result = previous.then(operation);
	const settled = result.then(
		() => undefined,
		() => undefined,
	);
	generationQueues.set(repositoryId, settled);
	void settled.then(() => {
		if (generationQueues.get(repositoryId) === settled) {
			generationQueues.delete(repositoryId);
		}
	});
	return result;
}
