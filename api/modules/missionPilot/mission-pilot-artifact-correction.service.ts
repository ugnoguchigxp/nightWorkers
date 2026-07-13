import crypto from "node:crypto";
import type { PlanModeArtifactCorrectionTarget } from "../../../shared/schemas/plan-mode-artifact-correction.schema";
import { appendActivityEvent } from "../nightworkers/nightworkers.activity.repository";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import {
	missionPilotArtifactTrace,
	missionPilotThoughtTrace,
} from "../nightworkers/nightworkers.trace-provenance";
import { executePlanModeArtifactCorrection } from "../planMode/plan-mode-artifact-correction.service";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import * as missionPilotRepo from "./mission-pilot.repository";
import * as planRepo from "./mission-pilot-plan.repository";

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function validateFocus(
	target: PlanModeArtifactCorrectionTarget,
	metadata: Record<string, unknown>,
) {
	if (target.focus.kind === "artifact") return;
	const blueprint = metadata.mockBlueprint;
	if (!blueprint || typeof blueprint !== "object" || Array.isArray(blueprint)) {
		throw new Error("Focused Blueprint source is missing structured content");
	}
	const screens = Array.isArray((blueprint as Record<string, unknown>).screens)
		? ((blueprint as Record<string, unknown>).screens as Array<
				Record<string, unknown>
			>)
		: [];
	const screenIds = new Set(screens.map((screen) => String(screen.id || "")));
	for (const screenId of target.focus.screenIds) {
		if (!screenIds.has(screenId)) {
			throw new Error(`Focused Blueprint screen is missing: ${screenId}`);
		}
	}
	if (target.focus.kind !== "section") return;
	const sectionIds = new Set(
		screens.flatMap((screen) =>
			Array.isArray(screen.sections)
				? (screen.sections as Array<Record<string, unknown>>).map((section) =>
						String(section.id || ""),
					)
				: [],
		),
	);
	for (const sectionId of target.focus.sectionIds) {
		if (!sectionIds.has(sectionId)) {
			throw new Error(`Focused Blueprint section is missing: ${sectionId}`);
		}
	}
}

function structuredBlueprint(metadata: Record<string, unknown>) {
	const blueprint = metadata.mockBlueprint;
	return blueprint && typeof blueprint === "object" && !Array.isArray(blueprint)
		? (blueprint as Record<string, unknown>)
		: null;
}

export function validateCorrectionResult(
	target: PlanModeArtifactCorrectionTarget,
	sourceMetadata: Record<string, unknown>,
	resultMetadata: Record<string, unknown>,
) {
	if (target.target !== "blueprint" || target.focus.kind === "artifact") return;
	validateFocus(target, resultMetadata);
	if (!target.preserveUnfocusedContent) return;
	const source = structuredBlueprint(sourceMetadata);
	const result = structuredBlueprint(resultMetadata);
	if (!source || !result) {
		throw new Error("Focused Blueprint correction result is missing structure");
	}
	const sourceScreens = Array.isArray(source.screens)
		? (source.screens as Array<Record<string, unknown>>)
		: [];
	const resultScreens = new Map(
		(Array.isArray(result.screens)
			? (result.screens as Array<Record<string, unknown>>)
			: []
		).map((screen) => [String(screen.id || ""), screen]),
	);
	for (const sourceScreen of sourceScreens) {
		const screenId = String(sourceScreen.id || "");
		const resultScreen = resultScreens.get(screenId);
		if (!resultScreen) {
			throw new Error(`Blueprint correction removed screen: ${screenId}`);
		}
		const resultSections = new Map(
			(Array.isArray(resultScreen.sections)
				? (resultScreen.sections as Array<Record<string, unknown>>)
				: []
			).map((section) => [String(section.id || ""), section]),
		);
		for (const sourceSection of Array.isArray(sourceScreen.sections)
			? (sourceScreen.sections as Array<Record<string, unknown>>)
			: []) {
			const sectionId = String(sourceSection.id || "");
			const resultSection = resultSections.get(sectionId);
			if (!resultSection) {
				throw new Error(`Blueprint correction removed section: ${sectionId}`);
			}
		}
	}
}

export async function executeMissionPilotArtifactCorrection(input: {
	taskId: string;
	sessionId: string;
	questionnaireSessionId: string;
	run: Awaited<ReturnType<typeof planRepo.listArtifactCorrectionRuns>>[number];
}) {
	const claimed = await planRepo.claimArtifactCorrectionRun(input.run.id);
	if (!claimed) return input.run;
	try {
		const [session, messages, workspace] = await Promise.all([
			missionPilotRepo.getSessionByTaskId(input.taskId),
			nightworkersRepo.listTaskMessages(input.taskId),
			getPlanModeWorkspace(input.taskId),
		]);
		if (!session || session.id !== input.sessionId) {
			throw new Error("Mission Pilot correction Session is missing");
		}
		if (session.desiredState !== "playing") {
			throw new Error("Mission Pilot stopped during Artifact correction");
		}
		const source = messages.find(
			(message) => message.id === claimed.sourceMessageId,
		);
		if (!source) throw new Error("Correction source message is missing");
		const sourceMetadata = toRecord(source.metadataJson);
		const target: PlanModeArtifactCorrectionTarget = {
			target: claimed.target,
			sourceMessageId: claimed.sourceMessageId,
			focus: claimed.focusJson,
			instruction: claimed.instruction,
			preserveUnfocusedContent: claimed.preserveUnfocusedContent,
		};
		validateFocus(target, sourceMetadata);
		const thoughtTrace = missionPilotThoughtTrace({
			sessionId: input.sessionId,
		});
		const artifactTrace = missionPilotArtifactTrace({
			sessionId: input.sessionId,
		});
		void appendActivityEvent({
			taskId: input.taskId,
			kind: "runtime.state",
			source: "mission_pilot",
			status: "running",
			text: `${claimed.target}へフォーカスした修正をPlan Mode agentへ依頼しました。`,
			payloadJson: {
				missionPilotSessionId: input.sessionId,
				correctionRunId: claimed.id,
				target: claimed.target,
				focus: claimed.focusJson,
				sourceMessageId: claimed.sourceMessageId,
			},
			trace: thoughtTrace,
		}).catch(() => undefined);
		const result = await executePlanModeArtifactCorrection({
			taskId: input.taskId,
			target: claimed.target,
			prompt: claimed.instruction,
			focus: claimed.focusJson,
			correlationId: claimed.id,
			questionnaireSessionId: input.questionnaireSessionId,
			featurePlanMessageId:
				workspace.featurePlanArtifacts.at(-1)?.sourceMessageId ?? null,
			sourceBlueprintMessageId:
				claimed.target === "blueprint"
					? claimed.sourceMessageId
					: (workspace.blueprintArtifacts.at(-1)?.sourceMessageId ?? null),
			sourceDataModelMessageId:
				workspace.dataModelArtifacts.at(-1)?.sourceMessageId ?? null,
			role: "mission_pilot",
			trace: artifactTrace,
			llmUsageTrace: thoughtTrace,
		});
		if (!result.message?.id) {
			throw new Error("Correction agent result message is missing");
		}
		const metadata = toRecord(result.message.metadataJson);
		const artifactRef = toRecord(metadata.artifactRef);
		validateCorrectionResult(target, sourceMetadata, metadata);
		await planRepo.recordArtifactCorrectionResult(claimed.id, {
			resultMessageId: result.message.id,
			resultArtifactId: artifactRef.artifactId
				? String(artifactRef.artifactId)
				: null,
		});
		await planRepo.markArtifactCorrectionValidating(claimed.id);
		const current = await missionPilotRepo.getSessionByTaskId(input.taskId);
		if (!current || current.desiredState !== "playing") {
			throw new Error("Mission Pilot stopped before correction adoption");
		}
		const content = result.message.content || "";
		const updated = await planRepo.appendPlanContext(
			input.sessionId,
			"artifact",
			{
				stepKey: `correction:${claimed.target}`,
				correctionRunId: claimed.id,
				sourceMessageId: result.message.id,
				previousSourceMessageId: claimed.sourceMessageId,
				content,
				metadata,
				digest: crypto.createHash("sha256").update(content).digest("hex"),
				createdAt: new Date().toISOString(),
			},
			{ correctionRunId: claimed.id },
		);
		if (!updated) throw new Error("Correction Context adoption failed");
		const applied = await planRepo.getArtifactCorrectionRun(claimed.id);
		if (!applied) throw new Error("Correction run adoption conflicted");
		void appendActivityEvent({
			taskId: input.taskId,
			kind: "runtime.state",
			source: "mission_pilot",
			status: "completed",
			text: `${claimed.target}の修正結果を確認し、Plan Contextへ反映しました。`,
			payloadJson: {
				missionPilotSessionId: input.sessionId,
				correctionRunId: claimed.id,
				resultMessageId: result.message.id,
				contextRevision: updated.contextRevision,
			},
			trace: thoughtTrace,
		}).catch(() => undefined);
		return applied;
	} catch (error) {
		await planRepo.failArtifactCorrectionRun(claimed.id, errorMessage(error));
		throw error;
	}
}
