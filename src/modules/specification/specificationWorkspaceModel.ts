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
  isReviewedSpecificationMessage,
  mergeWorkspaceTaskMessages,
} from '../nightworkers/workbenchSelectors';

export type WorkspaceTab =
  | 'blueprints'
  | 'data-model'
  | 'questionnaire'
  | 'status'
  | 'specification';

export function selectSpecificationWorkspaceMessages(input: {
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
    return (
      message.messageType === 'markdown_document' &&
      (intent === 'feature_plan' || intent === 'draft_spec')
    );
  });
  const reviewedDesignDocMessages = designDocMessages.filter(isReviewedSpecificationMessage);
  const activeBlueprintMessage = blueprintMessages.at(-1) || null;
  const activeDataModelMessage = dataModelMessages.at(-1) || null;
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
