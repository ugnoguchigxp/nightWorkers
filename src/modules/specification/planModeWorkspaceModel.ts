import { toDeepRecord } from '../../../shared/json-record';
import type {
  ActivityArtifact,
  DesignQuestionnaireSession,
  GeneralSettings,
  PlanModeWorkspace,
  TaskMessage,
} from '../nightworkers/types';
import {
  isDataModelMessage,
  isNormalBlueprintMessage,
  isReviewedFeaturePlanMessage,
  mergeWorkspaceTaskMessages,
} from '../nightworkers/workbenchSelectors';
import { toMs } from '../nightworkers/workbenchSelectorUtils';

export type PlanWorkspaceTab =
  | 'feature-plan'
  | 'blueprint'
  | 'data-model'
  | 'user-flow'
  | 'api-io-contract'
  | 'state-model'
  | 'activity-flow'
  | 'sequence-flow'
  | 'zod-schema-design'
  | 'questionnaire'
  | 'status';

export function selectPlanModeWorkspaceMessages(input: {
  taskMessages: TaskMessage[];
  activityArtifacts: ActivityArtifact[];
  generatedMessages: TaskMessage[];
  workspace: PlanModeWorkspace | null;
}) {
  const combinedTaskMessages = mergeWorkspaceTaskMessages({
    taskMessages: input.taskMessages,
    activityArtifacts: input.activityArtifacts,
    generatedMessages: input.generatedMessages,
  });
  const blueprintMessages = combinedTaskMessages.filter(isNormalBlueprintMessage);
  const dataModelMessages = combinedTaskMessages.filter(isDataModelMessage);
  const designDocMessages = combinedTaskMessages.filter((message) => {
    const intent = String(toDeepRecord(message.metadataJson).intent);
    return message.messageType === 'markdown_document' && intent === 'feature_plan';
  });
  const reviewedDesignDocMessages = designDocMessages.filter(isReviewedFeaturePlanMessage);
  const activeBlueprintMessage = latestMessageByCreatedAt(blueprintMessages);
  const activeDataModelMessage = latestMessageByCreatedAt(dataModelMessages);
  const latestWorkspaceBlueprintMessageId =
    input.workspace?.blueprintArtifacts.at(-1)?.sourceMessageId || null;
  const activeBlueprintSourceMessageId = activeBlueprintMessage?.id?.startsWith('artifact-')
    ? latestWorkspaceBlueprintMessageId
    : activeBlueprintMessage?.id || latestWorkspaceBlueprintMessageId;

  return {
    combinedTaskMessages,
    blueprintMessages,
    dataModelMessages,
    designDocMessages,
    reviewedDesignDocMessages,
    activeBlueprintMessage,
    activeDataModelMessage,
    activeBlueprintSourceMessageId,
  };
}

function latestMessageByCreatedAt(messages: TaskMessage[]) {
  return [...messages].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))[0] || null;
}

export function isDesignAssemblyReady(
  session: DesignQuestionnaireSession | null,
  assemblyReadySessionIds: Set<string>
) {
  return Boolean(
    session &&
      (session.status === 'review_ready' ||
        session.status === 'accepted' ||
        assemblyReadySessionIds.has(session.id))
  );
}

export function getPlanModeCapabilities(settings: GeneralSettings | null) {
  return (
    settings?.planMode.capabilities ?? {
      questionnaire: true,
      feature_plan: true,
      user_flow: true,
      blueprint: true,
      data_model: true,
      api_io_contract: true,
      state_model: true,
      activity_flow: true,
      sequence_flow: true,
      zod_schema_design: true,
    }
  );
}
