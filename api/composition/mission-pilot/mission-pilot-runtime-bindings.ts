import type {
	MissionPilotPersistenceHostBinding,
	MissionPilotRuntimeHostBindings,
} from "@nightworkers/mission-pilot/backend";
import { logEvent } from "../../lib/logger";
import {
	contentDigest,
	registerTaskRunTerminalListener,
	sliceUtf8ContentPage,
	submitTaskUserIntake,
} from "../../modules/agentsShare";
import { readTaskOperatorCommandReceipt } from "../../modules/commandDelivery";
import { createMissionPilotPersistenceCapability } from "../../modules/missionPilot/persistence/capability";
import { appendActivityEvent } from "../../modules/nightworkers/nightworkers.activity-persistence.repository";
import * as nightworkersRepository from "../../modules/nightworkers/nightworkers.repository";
import {
	buildQuestionnaireStateChange,
	getDesignQuestionnaireSession,
} from "../../modules/questionnaire";
import {
	createDesignQuestionnaireQuestionSet,
	createDesignQuestionnaireSession,
	updateDesignQuestionnaireSessionStatus,
} from "../../modules/questionnaire/questionnaire.repository";
import { registerQuestionnaireStateChangedListener } from "../../modules/questionnaire/questionnaire-events";
import {
	enqueueTaskActivityEvent,
	readTaskActivityEvents,
	registerTaskMessageCreatedListener,
} from "../../modules/task";
import {
	digestTaskOperatorCapabilityGrant,
	executeTaskOperatorCommand,
	getTaskOperatorActionDefinition,
	humanTaskOperatorCommandContext,
	humanTaskOperatorPrincipal,
	humanTaskOperatorQueryContext,
	initializeTaskOperatorExecutionEvents,
	readCurrentTaskOperatorUserCapabilities,
	readTaskOperatorProjection,
	readTaskOperatorResource,
	registerTaskOperatorExecutionEventListener,
	taskOperatorPermissionDenied,
	validateTaskOperatorJsonSchema,
} from "../../modules/taskOperator";
import { recordLlmUsage } from "../../services/llm-usage";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import {
	buildNormalizedSupervisorLlmRequestCandidates,
	callProviderToolTurn,
	normalizeStructuredProviderError,
	providerAdapterKey,
	withStructuredProviderAttempt,
} from "../../services/structured-llm/public";
import { readStructuredLlmProviderSettings } from "../../services/structured-llm/settings";
import {
	bindSystemContextCatalogSnapshot,
	createSystemContextBindingSnapshot,
	p,
	runWithSystemContextBinding,
	systemContextPromptAudit,
} from "../../systemContexts/catalog";
import { createMissionPilotFixtureBindings } from "./mission-pilot-fixture-bindings";

export function createMissionPilotRuntimeBindings(): MissionPilotRuntimeHostBindings &
	MissionPilotPersistenceHostBinding {
	const persistence = createMissionPilotPersistenceCapability({
		async prepareAgentPlay(input) {
			const capabilities = readCurrentTaskOperatorUserCapabilities({
				subjectUserId: input.principal.actorId,
				authorizationRef: input.principal.authorizationRef,
			}).filter(isMissionPilotDelegatedCapability);
			const projection = await readTaskOperatorProjection(input.taskId, {
				principal: input.principal,
			});
			return {
				grantedAt: input.grantedAt,
				task: {
					revision: projection.task.revision,
					title: projection.task.title,
					objective: projection.task.objective?.text ?? null,
					acceptanceCriteria: projection.task.acceptanceCriteria?.text ?? null,
				},
				capabilities,
				capabilityDigest: digestTaskOperatorCapabilityGrant({
					subjectUserId: input.principal.actorId,
					authorizationRef: input.principal.authorizationRef,
					sessionId: input.sessionId,
					taskId: input.taskId,
					grantedAt: input.grantedAt,
					capabilities,
				}),
			};
		},
		async resolveProviderToolCallActions(input) {
			return Object.fromEntries(
				input.toolCalls.map((call) => {
					const selectedActionId =
						call.name === "execute_task_action" &&
						typeof call.arguments.actionId === "string"
							? call.arguments.actionId
							: null;
					const action = selectedActionId
						? getTaskOperatorActionDefinition(selectedActionId)
						: null;
					return [call.id, action?.actionId ?? call.name];
				}),
			);
		},
	});
	return {
		executeMissionPilotPersistence: persistence.execute,
		contentDigest,
		sliceUtf8ContentPage,
		submitTaskUserIntake,
		registerTaskRunTerminalListener,
		readTaskOperatorCommandReceipt,
		getTask: nightworkersRepository.getTask,
		appendActivityEvent,
		createTaskMessage: nightworkersRepository.createTaskMessage,
		buildQuestionnaireStateChange,
		getDesignQuestionnaireSession,
		createDesignQuestionnaireQuestionSet,
		createDesignQuestionnaireSession,
		updateDesignQuestionnaireSessionStatus,
		registerQuestionnaireStateChangedListener,
		enqueueTaskActivityEvent,
		readTaskActivityEvents,
		registerTaskMessageCreatedListener,
		digestTaskOperatorCapabilityGrant,
		executeTaskOperatorCommand,
		getTaskOperatorActionDefinition,
		humanTaskOperatorCommandContext,
		humanTaskOperatorPrincipal,
		humanTaskOperatorQueryContext,
		initializeTaskOperatorExecutionEvents,
		readCurrentTaskOperatorUserCapabilities,
		readTaskOperatorProjection,
		readTaskOperatorResource,
		registerTaskOperatorExecutionEventListener,
		taskOperatorPermissionDenied,
		validateTaskOperatorJsonSchema,
		logEvent,
		recordLlmUsage,
		publishRealtime: (taskId: string, event: unknown) =>
			nightWorkersRealtimeBroker.publish(taskId, event as never),
		buildNormalizedSupervisorLlmRequestCandidates,
		callProviderToolTurn,
		normalizeStructuredProviderError,
		providerAdapterKey,
		withStructuredProviderAttempt,
		readStructuredLlmProviderSettings,
		bindSystemContextCatalogSnapshot,
		createSystemContextBindingSnapshot,
		renderSystemContext: p,
		runWithSystemContextBinding,
		systemContextPromptAudit,
		...createMissionPilotFixtureBindings(),
	};
}

function isMissionPilotDelegatedCapability(
	capability: string,
): capability is
	| "plan"
	| "queue"
	| "implementation"
	| "testMutation"
	| "review"
	| "localCommit"
	| "taskComplete"
	| "taskArchive" {
	return [
		"plan",
		"queue",
		"implementation",
		"testMutation",
		"review",
		"localCommit",
		"taskComplete",
		"taskArchive",
	].includes(capability);
}
