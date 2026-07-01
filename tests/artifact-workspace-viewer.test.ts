import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  isDataModelMessage,
  isNormalBlueprintMessage,
  isReviewedFeaturePlanMessage,
  mergeWorkspaceTaskMessages,
} from '../src/modules/nightworkers/workbenchSelectors';
import { PlanModeWorkspaceViewer } from '../src/modules/planMode';
import {
  buildActivityArtifact,
  buildBlueprintMessage,
  buildTaskMessage,
} from './helpers/nightworkers-fixtures';

describe('mergeWorkspaceTaskMessages', () => {
  it('does not let synthetic activity artifact messages override persisted Blueprint messages', () => {
    const createdAt = new Date().toISOString();
    const taskMessage = buildBlueprintMessage({
      id: 'message-blueprint-1',
      taskId: 'task-1',
      content: '# Blueprint',
      metadataJson: {
        intent: 'app_blueprint',
        artifactRef: { artifactId: 'artifact-blueprint-1', kind: 'app_blueprint', version: 1 },
        appBlueprint: { id: 'blueprint-1', name: 'Blueprint', screens: [] },
      },
      createdAt,
    });
    const activityArtifact = buildActivityArtifact({
      id: 'artifact-blueprint-1',
      taskId: 'task-1',
      title: 'Blueprint',
      contentText: JSON.stringify({ id: 'blueprint-1', name: 'Blueprint', screens: [] }),
      metadataJson: {
        intent: 'app_blueprint',
        appBlueprint: { id: 'blueprint-1', name: 'Blueprint', screens: [] },
      },
      createdAt,
    });

    const messages = mergeWorkspaceTaskMessages({
      taskMessages: [taskMessage],
      activityArtifacts: [activityArtifact],
      generatedMessages: [],
    });

    expect(messages.map((message) => message.id)).toEqual(['message-blueprint-1']);
  });
});

describe('isReviewedFeaturePlanMessage', () => {
  it('waits for the reviewed Feature Plan before marking the status flow complete', () => {
    const createdAt = new Date().toISOString();
    const initialSpec = buildTaskMessage({
      id: 'message-spec-1',
      taskId: 'task-1',
      content: '# Specification',
      messageType: 'markdown_document',
      metadataJson: { intent: 'feature_plan', source: 'status' },
      createdAt,
    });
    const reviewedSpec: TaskMessage = {
      ...initialSpec,
      id: 'message-spec-2',
      metadataJson: {
        intent: 'feature_plan',
        source: 'status_document_review',
        reviewedSourceMessageId: initialSpec.id,
      },
    };

    expect(isReviewedFeaturePlanMessage(initialSpec)).toBe(false);
    expect(isReviewedFeaturePlanMessage(reviewedSpec)).toBe(true);
  });
});

describe('Blueprint message classification', () => {
  it('keeps Data Model messages out of normal Blueprint surfaces', () => {
    const createdAt = new Date().toISOString();
    const normalBlueprint = buildBlueprintMessage({
      id: 'message-blueprint',
      taskId: 'task-1',
      content: '# App Blueprint',
      metadataJson: {
        intent: 'app_blueprint',
        appBlueprint: { name: 'App Blueprint' },
      },
      createdAt,
    });
    const dataModelBlueprint: TaskMessage = {
      ...normalBlueprint,
      id: 'message-data-model',
      metadataJson: {
        intent: 'app_blueprint',
        artifactType: 'data_model',
        source: 'data-model',
        dataModelTarget: { sourceBlueprintMessageId: normalBlueprint.id },
        appBlueprint: { name: 'Data Model' },
      },
    };

    expect(isNormalBlueprintMessage(normalBlueprint)).toBe(true);
    expect(isDataModelMessage(normalBlueprint)).toBe(false);
    expect(isNormalBlueprintMessage(dataModelBlueprint)).toBe(false);
    expect(isDataModelMessage(dataModelBlueprint)).toBe(true);
  });
});

describe('PlanModeWorkspaceViewer', () => {
  it('keeps Status selectable while omitting empty Feature Plan tabs', () => {
    const markup = renderToStaticMarkup(
      createElement(PlanModeWorkspaceViewer, {
        sessionId: 'task-1',
        taskMessages: [],
        activityArtifacts: [],
        initialTab: 'questionnaire',
      })
    );

    expect(markup).toContain('>Status</button>');
    expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>Status<\/button>/);
    expect(markup).not.toContain('>Feature Plan</button>');
  });
});
