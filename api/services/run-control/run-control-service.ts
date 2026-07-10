import type { WorkerToolResult } from "../worker-tools/types";
import { digestJson } from "./action-identity";
import type {
	PreparedRunAction,
	PrepareRunActionResult,
	RunControlState,
	RunEffect,
	ToolOutcomeEnvelope,
} from "./contracts";
import { reduceRunControlState } from "./run-control-reducer";
import {
	createEphemeralPreparedAction,
	RunControlRepository,
} from "./run-control-repository";
import {
	buildToolOutcomeEnvelope,
	classifyRunEffect,
	deriveWorkerDomainOutcome,
} from "./tool-outcome-envelope";

export class RunControlService {
	constructor(private readonly repository = new RunControlRepository()) {}

	async prepare(input: {
		runId: string;
		toolName: string;
		arguments: unknown;
		workspaceIdentity?: string | null;
	}): Promise<PrepareRunActionResult & { persisted: boolean }> {
		const effect = classifyRunEffect(input.toolName, input.arguments);
		if (!input.runId) {
			const ephemeral = createEphemeralPreparedAction({ ...input, effect });
			return { kind: "execute", ...ephemeral, persisted: false };
		}
		try {
			const prepared = await this.repository.prepareAction({
				...input,
				effect,
			});
			return { ...prepared, persisted: true };
		} catch {
			const ephemeral = createEphemeralPreparedAction({ ...input, effect });
			return { kind: "execute", ...ephemeral, persisted: false };
		}
	}

	async completeWorkerAction(input: {
		prepared: {
			state: RunControlState;
			action: PreparedRunAction;
			persisted: boolean;
		};
		result: WorkerToolResult<unknown>;
		modelView: unknown;
		evidenceRefs?: string[];
		artifactRefs?: string[];
	}): Promise<ToolOutcomeEnvelope> {
		const domainOutcome = deriveWorkerDomainOutcome(input.result);
		const evidenceRefs = input.evidenceRefs ?? [];
		const artifactRefs = input.artifactRefs ?? [];
		let stateAfter = reduceRunControlState(input.prepared.state, {
			type: "action_completed",
			sequence: input.prepared.action.sequence,
			effect: input.prepared.action.effect,
			domainOutcome,
			evidenceCount: evidenceRefs.length,
			artifactCount: artifactRefs.length,
		});
		const resultDigest = digestJson(input.result);
		if (input.prepared.persisted) {
			try {
				stateAfter = await this.repository.completeAction({
					action: input.prepared.action,
					transportStatus: "completed",
					domainOutcome,
					resultDigest,
					evidenceRefs,
					artifactRefs,
					modelView: input.modelView,
				});
			} catch {
				// Action control is fail-open. Finalization uses a separate fail-closed path.
			}
		}
		return buildToolOutcomeEnvelope({
			runId: input.prepared.action.runId,
			invocationId: input.prepared.action.id,
			toolName: input.prepared.action.toolName,
			actionKey: input.prepared.action.actionKey,
			invocationDigest: input.prepared.action.normalizedArgsDigest,
			stateBefore: input.prepared.state,
			stateAfter,
			effect: input.prepared.action.effect,
			domainOutcome,
			result: input.result,
			modelView: input.modelView,
			evidenceRefs,
			artifactRefs,
		});
	}

	async observeProgress(input: {
		runId: string;
		effect: RunEffect;
		sequence?: number | null;
	}) {
		if (!input.runId) return null;
		try {
			return await this.repository.observeProgress(input);
		} catch {
			return null;
		}
	}

	async rotateContext(runId: string) {
		if (!runId) return null;
		try {
			return await this.repository.transition({
				runId,
				type: "rotate_context",
			});
		} catch {
			return null;
		}
	}
}

export const runControlService = new RunControlService();
