import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { DesignQuestionnaireAnswer } from "../../../shared/schemas/design-questionnaire.schema";
import { db } from "../../db/client";
import { missionPilotSessions } from "../../db/mission-pilot-schema";
import { AppError } from "../../lib/errors";
import { getPlanModeTask } from "../nightworkers/nightworkers.plan-mode-core.port";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { getPlanModeRouting } from "../planMode/plan-mode-routing.service";
import {
	getDesignQuestionnaireSession,
	listDesignQuestionnaires,
} from "../questionnaire/questionnaire.service";
import { getSessionQuestions } from "../questionnaire/questionnaire-parser.service";
import { listUnansweredBlockingQuestions } from "../questionnaire/questionnaire-validation";
import { detectProjectStackProfile } from "../techStack";
import type {
	AcceptedQuestionnaireDecision,
	BlockingQuestion,
	PlanArtifactCanonicalInput,
	PlanArtifactGenerationTarget,
	PlanArtifactSourceSelection,
} from "./plan-artifact-input.types";
import { resolvePlanArtifactSources } from "./plan-artifact-source-selection";
import { renderQuestionnaireAnswer } from "./specification-schema-reference-renderer";

export async function resolvePlanArtifactCanonicalInput(input: {
	taskId: string;
	target: PlanArtifactGenerationTarget;
	questionnaireSessionId: string | null;
	sourceSelection: PlanArtifactSourceSelection;
	regenerationRequest: string | null;
	expectedState?: {
		missionPilotSessionId: string;
		contextRevision: number;
		contextDigest: string;
		routingRevision: number;
	};
}): Promise<PlanArtifactCanonicalInput> {
	const task = await getPlanModeTask(input.taskId);
	if (!task) throw new AppError(404, "TASK_NOT_FOUND", "Task not found.");
	const [routing, questionnaire, repository] = await Promise.all([
		getPlanModeRouting(task.id),
		resolveQuestionnaire(task.id, input.questionnaireSessionId),
		nightworkersRepo.getRepository(task.repositoryId),
	]);
	if (!repository)
		throw new AppError(404, "REPOSITORY_NOT_FOUND", "Repository not found.");
	if (
		input.expectedState &&
		(input.expectedState.routingRevision !== routing.revision ||
			input.expectedState.missionPilotSessionId.trim() === "")
	) {
		throw new AppError(
			409,
			"PLAN_ARTIFACT_CONTEXT_STALE",
			"Mission Pilot context or routing revision is stale.",
		);
	}
	let missionPilotInitialPrompt: string | null = null;
	if (input.expectedState) {
		const session = await db.query.missionPilotSessions.findFirst({
			where: eq(
				missionPilotSessions.id,
				input.expectedState.missionPilotSessionId,
			),
		});
		missionPilotInitialPrompt = session?.initialPromptSnapshot ?? null;
		if (
			!session ||
			session.taskId !== task.id ||
			session.contextRevision !== input.expectedState.contextRevision ||
			session.contextDigest !== input.expectedState.contextDigest ||
			session.planRoutingRevision !== input.expectedState.routingRevision
		) {
			throw new AppError(
				409,
				"PLAN_ARTIFACT_CONTEXT_STALE",
				"Mission Pilot context snapshot or routing revision is stale.",
			);
		}
	}
	const sources = await resolvePlanArtifactSources({
		taskId: task.id,
		target: input.target,
		selection: input.sourceSelection,
		currentRoutingRevision: routing.revision,
	});
	const taskInitialPrompt =
		missionPilotInitialPrompt?.trim() ||
		task.objective?.trim() ||
		task.description?.trim() ||
		task.title.trim();
	const projectRoot = repository.localPath;
	const materializationState = materializationStateFor(projectRoot);
	const sessionDecisions = questionnaire
		? buildAcceptedQuestionnaireDecisions(questionnaire)
		: [];
	const questionnaireDigest = questionnaire
		? digestJson({
				status: questionnaire.status,
				questionSets: questionnaire.questionSets,
				answers: questionnaire.answers,
			})
		: null;
	const missionPilotSessionId =
		input.expectedState?.missionPilotSessionId ?? null;
	return {
		target: input.target,
		task: {
			id: task.id,
			title: task.title,
			description: task.description ?? null,
			initialPrompt: taskInitialPrompt,
			acceptanceCriteria: task.acceptanceCriteria ?? null,
		},
		questionnaire: questionnaire
			? {
					sessionId: questionnaire.id,
					digest: questionnaireDigest ?? digestJson(questionnaire),
					status: questionnaire.status,
					decisions: sessionDecisions,
					unresolvedBlocking: listUnansweredBlockingQuestions(
						questionnaire,
					).map(
						(item): BlockingQuestion => ({
							id: item.id,
							decisionKey: item.decisionKey,
							question: item.question,
						}),
					),
				}
			: null,
		project: {
			repositoryId: repository.id,
			name: repository.name,
			root: projectRoot,
			materializationState,
			detectedStack:
				materializationState === "missing"
					? null
					: detectProjectStackProfile(projectRoot),
			packageScripts: readPackageScripts(projectRoot),
		},
		routing: {
			revision: routing.revision,
			includedViews: routing.entries
				.filter((entry) => entry.decision === "include")
				.map((entry) => entry.view),
			omittedViews: routing.entries
				.filter((entry) => entry.decision === "omit")
				.map((entry) => ({ view: entry.view, reason: entry.reason ?? null })),
		},
		sources,
		regenerationRequest: input.regenerationRequest?.trim() || null,
		provenance: {
			missionPilotSessionId,
			contextRevision: input.expectedState?.contextRevision ?? null,
			contextDigest: input.expectedState?.contextDigest ?? null,
			routingRevision: routing.revision,
		},
	};
}

function buildAcceptedQuestionnaireDecisions(
	session: Awaited<ReturnType<typeof getDesignQuestionnaireSession>>,
): AcceptedQuestionnaireDecision[] {
	const answerByQuestionId = new Map(
		session.answers.map((item) => [item.questionId, item.answer]),
	);
	return getSessionQuestions(session)
		.map((question, index) => ({
			question,
			index,
			answer: answerByQuestionId.get(String(question.id)),
		}))
		.filter((item) => Boolean(item.answer))
		.sort((left, right) => left.index - right.index)
		.map(({ question, answer }) => ({
			questionId: String(question.id),
			question: question.question,
			answer: renderQuestionnaireAnswer(
				question,
				answer as DesignQuestionnaireAnswer,
			),
			why: question.why ?? null,
			outputSection: question.outputSection ?? null,
			deferred: Boolean(
				(answer as DesignQuestionnaireAnswer | undefined)?.deferred,
			),
		}));
}

async function resolveQuestionnaire(taskId: string, sessionId: string | null) {
	if (sessionId) return getDesignQuestionnaireSession(taskId, sessionId);
	const sessions = await listDesignQuestionnaires(taskId);
	return (
		sessions.find((session) => session.status === "accepted") ??
		sessions.find((session) => session.status === "review_ready") ??
		null
	);
}

function materializationStateFor(
	root: string,
): "materialized" | "empty" | "missing" {
	try {
		const stat = fs.statSync(root);
		if (!stat.isDirectory()) return "missing";
		return fs.readdirSync(root).length > 0 ? "materialized" : "empty";
	} catch {
		return "missing";
	}
}

function readPackageScripts(root: string) {
	try {
		const packageJson = JSON.parse(
			fs.readFileSync(path.join(root, "package.json"), "utf8"),
		) as Record<string, unknown>;
		const scripts = packageJson.scripts;
		if (!scripts || typeof scripts !== "object" || Array.isArray(scripts))
			return [];
		return Object.entries(scripts)
			.filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			)
			.map(([name, command]) => ({ name, command }));
	} catch {
		return [];
	}
}

function digestJson(value: unknown) {
	return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
