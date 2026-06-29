import { toDeepRecord } from '../../../shared/json-record';
import type {
  ActivityArtifact,
  BlueprintSpecificationWorkspace,
  DesignQuestionnaireSession,
  GeneralSettings,
  TaskMessage,
} from '../nightworkers/types';
import {
  isDbDesignBlueprintMessage,
  isNormalBlueprintMessage,
  isReviewedSpecificationMessage,
  mergeWorkspaceTaskMessages,
} from '../nightworkers/workbenchSelectors';

export type WorkspaceTab =
  | 'blueprints'
  | 'db-design'
  | 'questionnaire'
  | 'status'
  | 'specification';

export function selectSpecificationWorkspaceMessages(input: {
  taskMessages: TaskMessage[];
  activityArtifacts: ActivityArtifact[];
  generatedMessages: TaskMessage[];
  workspace: BlueprintSpecificationWorkspace | null;
}) {
  const combinedTaskMessages = mergeWorkspaceTaskMessages({
    taskMessages: input.taskMessages,
    activityArtifacts: input.activityArtifacts,
    generatedMessages: input.generatedMessages,
  });
  const blueprintMessages = combinedTaskMessages.filter(isNormalBlueprintMessage);
  const dbDesignMessages = combinedTaskMessages.filter(isDbDesignBlueprintMessage);
  const designDocMessages = combinedTaskMessages.filter(
    (message) =>
      message.messageType === 'markdown_document' &&
      String(toDeepRecord(message.metadataJson).intent) === 'draft_spec'
  );
  const reviewedDesignDocMessages = designDocMessages.filter(isReviewedSpecificationMessage);
  const activeBlueprintMessage = blueprintMessages.at(-1) || null;
  const activeDbDesignMessage = dbDesignMessages.at(-1) || null;
  const latestWorkspaceBlueprintMessageId =
    input.workspace?.blueprintArtifacts.at(-1)?.sourceMessageId || null;
  const activeBlueprintSourceMessageId = activeBlueprintMessage?.id?.startsWith('artifact-')
    ? latestWorkspaceBlueprintMessageId
    : activeBlueprintMessage?.id || latestWorkspaceBlueprintMessageId;

  return {
    combinedTaskMessages,
    blueprintMessages,
    dbDesignMessages,
    designDocMessages,
    reviewedDesignDocMessages,
    activeBlueprintMessage,
    activeDbDesignMessage,
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
      blueprint: true,
      dbDesign: true,
      specification: true,
    }
  );
}
