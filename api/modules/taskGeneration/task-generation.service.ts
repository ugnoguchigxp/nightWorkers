import crypto from "node:crypto";
import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import {
	MISSION_TASK_CANDIDATE_MAX_COUNT,
	type MissionTaskCandidate,
	type MissionTaskCandidatesResult,
	missionTaskCandidatesResultSchema,
	type ProjectSignalSnapshot,
	type TaskGenerationLlmUsage,
} from "../../../shared/schemas/task-generation.schema";
import { db } from "../../db/client";
import { tasks } from "../../db/schema";
import { AppError, NotFoundError, ValidationError } from "../../lib/errors";
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
import {
	p as defaultP,
	type SystemContextP,
} from "../../systemContexts/catalog";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { selectMissionGoalsForGeneration } from "./task-candidate-semantics";
import * as repo from "./task-generation.repository";
import {
	buildTaskGenerationPromptSignal,
	buildTaskGenerationSystemContext,
} from "./task-generation-prompt-context";
import { buildProjectSignalSnapshot } from "./task-generation-signal.service";

export * from "./mission-goal.service";
export { selectMissionGoalsForGeneration } from "./task-candidate-semantics";

const MISSION_TASK_SCHEMA_NAME = "mission_task_candidates";

async function requireRepository(repositoryId: string) {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	return repository;
}

function buildMissionTaskSystemPrompt(
	signal: ProjectSignalSnapshot,
	p: SystemContextP = defaultP,
) {
	return p("taskGeneration.mission-tasks", {
		maxCount: MISSION_TASK_CANDIDATE_MAX_COUNT,
		generationContext: buildTaskGenerationSystemContext(signal),
	});
}

function buildMissionTaskUserPrompt(input: {
	signal: ProjectSignalSnapshot;
	existingCandidates: MissionTaskCandidate[];
	existingTaskTitles: string[];
}) {
	return JSON.stringify(
		{
			projectSignal: buildTaskGenerationPromptSignal(
				input.signal,
				"task_candidates",
			),
			existingUncreatedCandidates: input.existingCandidates.map(
				(candidate) => ({
					id: candidate.id,
					title: candidate.title,
					status: candidate.status,
				}),
			),
			existingTaskTitles: input.existingTaskTitles,
		},
		null,
		2,
	);
}

function selectedModelForMissionPrompt(
	systemPrompt: string,
	userPrompt: string,
) {
	const schema = buildMissionTaskCandidatesResponseJsonSchema();
	const normalized = buildNormalizedSupervisorLlmRequest({
		systemPrompt,
		userPrompt,
		label: MISSION_TASK_SCHEMA_NAME,
		role: "mission_task_generation",
		jsonSchema: { name: MISSION_TASK_SCHEMA_NAME, schema },
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

export function buildMissionTaskCandidatesResponseJsonSchema() {
	return normalizeStructuredOutputJsonSchema(
		z.toJSONSchema(missionTaskCandidatesResultSchema),
	);
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

export async function listMissionTaskCandidates(input: {
	repositoryId: string;
	status?: string;
}) {
	await requireRepository(input.repositoryId);
	await repo.reactivateDeletedTaskMissionCandidates(input.repositoryId);
	return repo.listMissionCandidates(input);
}

export async function getMissionTaskCandidate(candidateId: string) {
	const candidate = await repo.getMissionCandidate(candidateId);
	if (!candidate) throw new NotFoundError("Mission task candidate not found");
	return candidate;
}

export async function updateMissionTaskCandidate(
	candidateId: string,
	input: { status?: string },
) {
	const existing = await repo.getMissionCandidate(candidateId);
	if (!existing) throw new NotFoundError("Mission task candidate not found");
	if (input.status === "task_created") {
		throw new ValidationError(
			"Task-created status is only set by create-tasks",
		);
	}
	if (
		existing.status === "task_created" &&
		input.status &&
		input.status !== "task_created"
	) {
		throw new ValidationError(
			"Task-created candidates cannot be moved back to another status",
		);
	}
	const updated = await repo.updateMissionCandidate(candidateId, input);
	if (!updated) throw new NotFoundError("Mission task candidate not found");
	return updated;
}

export async function generateMissionTaskCandidates(input: {
	repositoryId: string;
	goalIds?: string[];
	includeInactiveGoals?: boolean;
	signal?: ProjectSignalSnapshot;
	priorLlmUsage?: TaskGenerationLlmUsage[];
}) {
	const repository = await requireRepository(input.repositoryId);
	const allGoals = await repo.listMissionGoals(repository.id);
	const selectedGoals = selectMissionGoalsForGeneration(allGoals, input);
	if (selectedGoals.length === 0)
		throw new ValidationError("At least one mission goal is required");
	await repo.reactivateDeletedTaskMissionCandidates(repository.id);
	const signal =
		input.signal ??
		(await buildProjectSignalSnapshot({
			repository,
			goals: selectedGoals,
		}));
	const batch = await repo.createRunningMissionBatch({
		repositoryId: repository.id,
		requestedGoalIds: selectedGoals.map((goal) => goal.id),
		signalSnapshot: signal,
	});

	const existingCandidates = await repo.listMissionCandidates({
		repositoryId: repository.id,
		status: "candidate",
	});
	const existingTasks = await db
		.select({ title: tasks.title })
		.from(tasks)
		.where(eq(tasks.repositoryId, repository.id));
	const contract = createStructuredOutputContract({
		name: MISSION_TASK_SCHEMA_NAME,
		runtimeSchema: missionTaskCandidatesResultSchema,
		providerJsonSchema: buildMissionTaskCandidatesResponseJsonSchema(),
	});
	const systemPrompt = buildMissionTaskSystemPrompt(signal, defaultP);
	const userPrompt = buildMissionTaskUserPrompt({
		signal,
		existingCandidates,
		existingTaskTitles: existingTasks.map((task) => task.title),
	});
	let selectedModel: unknown = selectedModelForMissionPrompt(
		systemPrompt,
		userPrompt,
	);
	let llmUsage: TaskGenerationLlmUsage | null = null;
	try {
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
				validateMissionTaskCandidateFacts(value.candidates, {
					selectedGoalIds: new Set(selectedGoals.map((goal) => goal.id)),
					blockedTitles: new Set([
						...existingCandidates.map((candidate) => candidate.title),
						...existingTasks.map((task) => task.title),
					]),
				}),
		});
		const acceptedAttempt = generated.attempts.at(-1);
		const rawOutput = JSON.parse(
			acceptedAttempt
				? structuredLlmAttemptValueText(acceptedAttempt)
				: JSON.stringify(generated.value),
		) as unknown;
		await repo.completeMissionBatch({
			batchId: batch.id,
			rawOutput,
			selectedModel: attachLlmUsage(
				selectedModel,
				llmUsage,
				input.priorLlmUsage,
			),
		});
		const candidates = await repo.createMissionCandidates(
			generated.value.candidates.map((candidate) => {
				return {
					id: crypto.randomUUID(),
					createdAt: new Date(),
					updatedAt: new Date(),
					batchId: batch.id,
					repositoryId: repository.id,
					goalId: candidate.goalId ?? null,
					candidateKind: candidate.candidateKind,
					primaryModule: candidate.moduleRouting.primaryModule,
					secondaryModulesJson: candidate.moduleRouting.secondaryModules,
					routingConfidencePercent: candidate.moduleRouting.confidencePercent,
					routingReason: candidate.moduleRouting.reason,
					constraintGoalIdsJson: candidate.constraintGoalIds,
					planModeOpenQuestionsJson: candidate.planModeOpenQuestions,
					title: candidate.title,
					summary: candidate.summary,
					rationale: candidate.rationale,
					evidenceJson: candidate.evidence,
					evaluationContribution: candidate.evaluationContribution ?? null,
					importancePercent: candidate.importancePercent,
					confidencePercent: candidate.confidencePercent,
					tokenSize: candidate.tokenSize,
					complexity: candidate.complexity,
					taskPrompt: candidate.taskPrompt,
					acceptanceCriteria: candidate.acceptanceCriteria,
					verificationPlan: candidate.verificationPlan,
					status: "candidate",
				};
			}),
		);
		return {
			batchId: batch.id,
			status: "completed" as const,
			candidates,
			llmUsage,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await repo.failMissionBatch({
			batchId: batch.id,
			errorMessage: message,
			selectedModel: attachLlmUsage(
				selectedModel,
				llmUsage,
				input.priorLlmUsage,
			),
		});
		if (error instanceof StructuredLlmResponseError) {
			throw new AppError(
				502,
				"MISSION_TASK_CANDIDATE_RESPONSE_INVALID",
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

function attachLlmUsage(
	selectedModel: unknown,
	llmUsage: TaskGenerationLlmUsage | null,
	priorLlmUsage: TaskGenerationLlmUsage[] = [],
) {
	if (!llmUsage && priorLlmUsage.length === 0) return selectedModel;
	const usageMetadata = {
		priorLlmUsage,
		llmUsage,
	};
	return selectedModel && typeof selectedModel === "object"
		? { ...selectedModel, ...usageMetadata }
		: { selection: selectedModel ?? null, ...usageMetadata };
}

function validateMissionTaskCandidateFacts(
	candidates: MissionTaskCandidatesResult["candidates"],
	input: {
		selectedGoalIds: ReadonlySet<string>;
		blockedTitles: ReadonlySet<string>;
	},
): StructuredLlmIssue[] {
	const issues: StructuredLlmIssue[] = [];
	const seenTitles = new Set<string>();
	for (const [index, candidate] of candidates.entries()) {
		if (candidate.goalId && !input.selectedGoalIds.has(candidate.goalId)) {
			issues.push({
				stage: "fact",
				path: ["candidates", index, "goalId"],
				code: "unknown_goal_reference",
				message: `選択されていないGoalを参照しています: ${candidate.goalId}`,
			});
		}
		for (const goalId of candidate.constraintGoalIds) {
			if (input.selectedGoalIds.has(goalId)) continue;
			issues.push({
				stage: "fact",
				path: ["candidates", index, "constraintGoalIds"],
				code: "unknown_goal_reference",
				message: `選択されていないGoalを参照しています: ${goalId}`,
			});
		}
		if (
			seenTitles.has(candidate.title) ||
			input.blockedTitles.has(candidate.title)
		) {
			issues.push({
				stage: "fact",
				path: ["candidates", index, "title"],
				code: "duplicate_candidate_title",
				message: `既存または同じ応答内の候補とtitleが重複しています: ${candidate.title}`,
			});
		}
		seenTitles.add(candidate.title);
	}
	return issues;
}

export async function createTasksFromMissionCandidates(input: {
	repositoryId: string;
	candidateIds: string[];
	mode: "draft" | "ready";
}) {
	await requireRepository(input.repositoryId);
	return db.transaction(async (tx) => {
		const candidates = await repo.listMissionCandidatesByIds(
			input.candidateIds,
			tx,
		);
		validateTaskCreationCandidates(candidates, input);
		const createdTasks = [];
		const updatedCandidates = [];
		for (const candidate of candidates) {
			const claimed = await repo.claimMissionCandidate(candidate.id, tx);
			if (!claimed) {
				throw new ValidationError(
					"Mission task candidate is no longer available",
					{ candidateId: candidate.id },
				);
			}
			const task = await repo.createTaskFromMissionCandidate(
				candidate,
				input.mode,
				tx,
			);
			const updated = await repo.updateMissionCandidate(
				candidate.id,
				{ status: "task_created", taskId: task.id },
				tx,
			);
			createdTasks.push(task);
			if (updated) updatedCandidates.push(updated);
		}
		return { tasks: createdTasks, candidates: updatedCandidates };
	});
}

function validateTaskCreationCandidates(
	candidates: MissionTaskCandidate[],
	input: { repositoryId: string; candidateIds: string[] },
) {
	if (candidates.length !== input.candidateIds.length) {
		throw new NotFoundError("Mission task candidate not found");
	}
	for (const candidate of candidates) {
		if (candidate.repositoryId !== input.repositoryId) {
			throw new NotFoundError("Mission task candidate not found");
		}
		if (candidate.status === "task_created" || candidate.taskId) {
			throw new ValidationError(
				"Mission task candidate already has a linked task",
				{ candidateId: candidate.id },
			);
		}
		if (candidate.status === "dismissed") {
			throw new ValidationError(
				"Dismissed candidates cannot be converted to tasks",
				{ candidateId: candidate.id },
			);
		}
	}
}
