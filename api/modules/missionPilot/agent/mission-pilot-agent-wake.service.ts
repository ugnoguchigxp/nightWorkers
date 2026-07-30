import { runMissionPilotAgentWake } from "./mission-pilot-agent-runtime";
import {
	getMissionPilotAgentSessionById,
	getMissionPilotSessionById,
} from "./mission-pilot-agent-session.repository";
import {
	cancelMissionPilotProviderRetryEvents,
	getNextMissionPilotTaskEventAt,
	listPendingMissionPilotTaskEvents,
} from "./mission-pilot-task-event.repository";

type ImmediateWakeState = {
	generation: number;
};
type FutureWakeState = {
	generation: number;
	timer: ReturnType<typeof setTimeout> | null;
};
const immediateWakeStates = new Map<string, ImmediateWakeState>();
const futureWakeStates = new Map<string, FutureWakeState>();
const sessionWakeGenerations = new Map<string, number>();
export function scheduleMissionPilotAgentWake(input: {
	sessionId: string;
	providerEndpointId?: string | null;
	model?: string | null;
	thinkingDepth?: string | null;
}) {
	if (immediateWakeStates.has(input.sessionId)) return false;
	const state: ImmediateWakeState = {
		generation: currentWakeGeneration(input.sessionId),
	};
	immediateWakeStates.set(input.sessionId, state);
	queueMicrotask(() => {
		if (!isCurrentImmediateWake(input.sessionId, state)) return;
		void getNextMissionPilotTaskEventAt(input.sessionId)
			.then((availableAt) => {
				if (!isCurrentImmediateWake(input.sessionId, state)) return null;
				if (!availableAt) return null;
				if (availableAt && availableAt.getTime() > Date.now()) {
					immediateWakeStates.delete(input.sessionId);
					scheduleMissionPilotAgentWakeAtNextEvent(input);
					return null;
				}
				return runMissionPilotAgentWake(input);
			})
			.then((wakeResult) => {
				if (wakeResult === null) return;
				return wakeResult;
			})
			.finally(async () => {
				if (immediateWakeStates.get(input.sessionId) === state)
					immediateWakeStates.delete(input.sessionId);
				if (!isCurrentWakeGeneration(input.sessionId, state.generation)) return;
				const [session, agent, pendingEvents] = await Promise.all([
					getMissionPilotSessionById(input.sessionId),
					getMissionPilotAgentSessionById(input.sessionId),
					listPendingMissionPilotTaskEvents(input.sessionId),
				]);
				if (!isCurrentWakeGeneration(input.sessionId, state.generation)) return;
				if (
					session?.desiredState === "playing" &&
					agent?.runtimeState !== "running" &&
					agent?.runtimeState !== "completed" &&
					pendingEvents.length > 0
				)
					scheduleMissionPilotAgentWake(input);
				else if (
					session?.desiredState === "playing" &&
					agent?.runtimeState !== "completed"
				)
					scheduleMissionPilotAgentWakeAtNextEvent(input);
			})
			.catch(() => {
				if (immediateWakeStates.get(input.sessionId) === state)
					immediateWakeStates.delete(input.sessionId);
			});
	});
	return true;
}

export function scheduleMissionPilotAgentWakeAtNextEvent(input: {
	sessionId: string;
	providerEndpointId?: string | null;
	model?: string | null;
	thinkingDepth?: string | null;
}) {
	if (futureWakeStates.has(input.sessionId)) return false;
	const state: FutureWakeState = {
		generation: currentWakeGeneration(input.sessionId),
		timer: null,
	};
	futureWakeStates.set(input.sessionId, state);
	void getNextMissionPilotTaskEventAt(input.sessionId)
		.then((availableAt) => {
			if (!isCurrentFutureWake(input.sessionId, state)) return;
			if (!availableAt) {
				futureWakeStates.delete(input.sessionId);
				return;
			}
			const delay = Math.max(0, availableAt.getTime() - Date.now());
			state.timer = setTimeout(() => {
				if (!isCurrentFutureWake(input.sessionId, state)) return;
				futureWakeStates.delete(input.sessionId);
				scheduleMissionPilotAgentWake(input);
			}, delay);
		})
		.catch(() => {
			if (futureWakeStates.get(input.sessionId) === state)
				futureWakeStates.delete(input.sessionId);
		});
	return true;
}

export async function cancelScheduledMissionPilotAgentWake(sessionId: string) {
	sessionWakeGenerations.set(sessionId, currentWakeGeneration(sessionId) + 1);
	const immediateState = immediateWakeStates.get(sessionId);
	immediateWakeStates.delete(sessionId);
	const state = futureWakeStates.get(sessionId);
	futureWakeStates.delete(sessionId);
	if (state?.timer) clearTimeout(state.timer);
	await cancelMissionPilotProviderRetryEvents(sessionId);
	return Boolean(immediateState || state);
}

function currentWakeGeneration(sessionId: string) {
	return sessionWakeGenerations.get(sessionId) ?? 0;
}

function isCurrentWakeGeneration(sessionId: string, generation: number) {
	return currentWakeGeneration(sessionId) === generation;
}

function isCurrentImmediateWake(sessionId: string, state: ImmediateWakeState) {
	return (
		immediateWakeStates.get(sessionId) === state &&
		isCurrentWakeGeneration(sessionId, state.generation)
	);
}

function isCurrentFutureWake(sessionId: string, state: FutureWakeState) {
	return (
		futureWakeStates.get(sessionId) === state &&
		isCurrentWakeGeneration(sessionId, state.generation)
	);
}
export async function runMissionPilotAgentWakeAndPublish(
	input: Parameters<typeof runMissionPilotAgentWake>[0],
) {
	return runMissionPilotAgentWake(input);
}
