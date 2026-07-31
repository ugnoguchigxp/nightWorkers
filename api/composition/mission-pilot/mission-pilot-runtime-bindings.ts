import type { MissionPilotRuntimeHostBindings } from "@nightworkers/mission-pilot/backend";
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

export function createMissionPilotRuntimeBindings(): MissionPilotRuntimeHostBindings {
	const persistence = createMissionPilotPersistenceCapability();
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
