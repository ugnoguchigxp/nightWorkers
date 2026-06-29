import type { BlueprintSpecificationWorkspace } from '../../../shared/schemas/design-questionnaire.schema';
import { NotFoundError } from '../../lib/errors';
import {
  getBlueprintArtifactAdoption,
  getBlueprintDbDesignAdoption,
} from '../blueprint/blueprint-adoption.service';
import {
  getPlanModeTask,
  listPlanModeTaskMessages,
} from '../nightworkers/nightworkers.plan-mode-core.port';
import { listDesignQuestionnaires } from '../questionnaire/questionnaire.service';
import { getAnswerableSessionQuestions } from '../questionnaire/questionnaire-parser.service';

export async function getBlueprintSpecificationWorkspace(
  taskId: string
): Promise<BlueprintSpecificationWorkspace> {
  const task = await getPlanModeTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const messages = await listPlanModeTaskMessages(taskId);
  const sessions = await listDesignQuestionnaires(taskId);
  const blueprintArtifacts = [];
  const dbDesignArtifacts = [];
  const decisionReviews = [];
  const implementationReferences = [];
  for (const message of messages) {
    if (message.messageType !== 'markdown_document') continue;
    const metadata = (message.metadataJson || {}) as Record<string, unknown>;
    if (metadata.intent === 'app_blueprint' && metadata.appBlueprint) {
      const appBlueprint = isRecord(metadata.appBlueprint) ? metadata.appBlueprint : {};
      const dbDesignTarget = isRecord(metadata.dbDesignTarget) ? metadata.dbDesignTarget : {};
      const isDbDesign = Boolean(
        metadata.source === 'blueprint-db-design' || metadata.dbDesignTarget
      );
      const adoption = isDbDesign
        ? await getBlueprintDbDesignAdoption(taskId, message.id)
        : await getBlueprintArtifactAdoption(taskId, message.id);
      const artifact = {
        id: `${isDbDesign ? 'db-design' : 'blueprint'}-${message.id}`,
        kind: isDbDesign ? ('db-design' as const) : ('blueprint' as const),
        title: String(metadata.title || appBlueprint.name || 'App Blueprint'),
        sourceMessageId: message.id,
        createdAt: message.createdAt,
        adoptionState: adoption
          ? adoption.adopted
            ? ('adopted' as const)
            : ('not_adopted' as const)
          : ('unknown' as const),
        sourceBlueprintMessageId:
          typeof metadata.sourceBlueprintMessageId === 'string'
            ? metadata.sourceBlueprintMessageId
            : typeof dbDesignTarget.sourceBlueprintMessageId === 'string'
              ? dbDesignTarget.sourceBlueprintMessageId
              : undefined,
      };
      if (isDbDesign) dbDesignArtifacts.push(artifact);
      else blueprintArtifacts.push(artifact);
    }
    if (metadata.intent === 'design_decision_review' && metadata.designDecisionReview) {
      decisionReviews.push({
        id: `decision-review-${message.id}`,
        kind: 'decision-review' as const,
        title: String(metadata.title || 'Decision Review'),
        sourceMessageId: message.id,
        createdAt: message.createdAt,
        sourceBlueprintMessageId:
          typeof metadata.sourceBlueprintMessageId === 'string'
            ? metadata.sourceBlueprintMessageId
            : undefined,
      });
    }
    if (metadata.intent === 'implementation_plan' || metadata.intent === 'draft_spec') {
      implementationReferences.push({
        id: `implementation-reference-${message.id}`,
        kind: 'implementation-plan' as const,
        title: String(metadata.title || 'Implementation Plan'),
        sourceMessageId: message.id,
        taskId,
      });
    }
  }
  return {
    taskId,
    repositoryId: task.repositoryId,
    generatedAt: new Date().toISOString(),
    blueprintArtifacts,
    dbDesignArtifacts,
    questionnaireSessions: sessions.map((session) => ({
      id: session.id,
      sourceBlueprintMessageId: session.sourceBlueprintMessageId,
      status: session.status,
      answeredCount: session.answers.length,
      totalQuestionCount: getAnswerableSessionQuestions(session, session.answers).length,
      latestReviewId: session.reviews[0]?.id,
    })),
    decisionReviews,
    implementationReferences,
  };
}

export async function getSpecificationWorkspace(taskId: string) {
  return getBlueprintSpecificationWorkspace(taskId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
