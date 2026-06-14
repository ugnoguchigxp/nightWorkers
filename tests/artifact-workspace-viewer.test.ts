import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BlueprintSpecificationWorkspaceViewer } from '../src/modules/nightworkers/components/ArtifactWorkspaceViewer';
import {
  isDbDesignBlueprintMessage,
  isNormalBlueprintMessage,
  isReviewedSpecificationMessage,
  mergeWorkspaceTaskMessages,
} from '../src/modules/nightworkers/workbenchSelectors';
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

describe('isReviewedSpecificationMessage', () => {
  it('waits for the reviewed specification before marking the status flow complete', () => {
    const createdAt = new Date().toISOString();
    const initialSpec = buildTaskMessage({
      id: 'message-spec-1',
      taskId: 'task-1',
      content: '# Specification',
      messageType: 'markdown_document',
      metadataJson: { intent: 'draft_spec', source: 'status' },
      createdAt,
    });
    const reviewedSpec: TaskMessage = {
      ...initialSpec,
      id: 'message-spec-2',
      metadataJson: {
        intent: 'draft_spec',
        source: 'status_document_review',
        reviewedSourceMessageId: initialSpec.id,
      },
    };

    expect(isReviewedSpecificationMessage(initialSpec)).toBe(false);
    expect(isReviewedSpecificationMessage(reviewedSpec)).toBe(true);
  });
});

describe('Blueprint message classification', () => {
  it('keeps DB Design messages out of normal Blueprint surfaces', () => {
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
    const dbDesignBlueprint: TaskMessage = {
      ...normalBlueprint,
      id: 'message-db-design',
      metadataJson: {
        intent: 'app_blueprint',
        artifactType: 'blueprint_db_design',
        source: 'blueprint-db-design',
        dbDesignTarget: { sourceBlueprintMessageId: normalBlueprint.id },
        appBlueprint: { name: 'DB Design' },
      },
    };

    expect(isNormalBlueprintMessage(normalBlueprint)).toBe(true);
    expect(isDbDesignBlueprintMessage(normalBlueprint)).toBe(false);
    expect(isNormalBlueprintMessage(dbDesignBlueprint)).toBe(false);
    expect(isDbDesignBlueprintMessage(dbDesignBlueprint)).toBe(true);
  });
});

describe('BlueprintSpecificationWorkspaceViewer', () => {
  it('keeps Status selectable while an active questionnaire is still incomplete', () => {
    const markup = renderToStaticMarkup(
      createElement(BlueprintSpecificationWorkspaceViewer, {
        sessionId: 'task-1',
        taskMessages: [],
        activityArtifacts: [],
        initialTab: 'questionnaire',
      })
    );

    expect(markup).toContain('>Status</button>');
    expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>Status<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Specification<\/button>/);
  });
});
