import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TaskMessage } from '../src/modules/nightworkers/types';
import {
  isDataModelMessage,
  isNormalBlueprintMessage,
  isReviewedFeaturePlanMessage,
  mergeWorkspaceTaskMessages,
} from '../src/modules/nightworkers/workbenchSelectors';
import {
  buildVisiblePlanWorkspaceTabs,
  getPlanWorkspaceTabLabel,
  PlanModeWorkspaceViewer,
  resolveInitialPlanWorkspaceTabUpdate,
  WorkspaceBlueprintPreview,
} from '../src/modules/planMode';
import { selectPlanModeWorkspaceMessages } from '../src/modules/specification';
import { representativeMockBlueprint } from './fixtures/mock-blueprint';
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
  it('waits for the reviewed specification before marking the status flow complete', () => {
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
  it('keeps Status before the spec tab when a reviewed specification exists', () => {
    const tabs = buildVisiblePlanWorkspaceTabs({
      questionnaireGateLocked: false,
      hasFeaturePlan: true,
      hasQuestionnaire: true,
      hasBlueprint: true,
      hasDataModel: true,
      includedViews: new Set(),
      planModeCapabilities: {
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
      },
      dedicatedViewArtifacts: [],
    });

    expect(tabs).toEqual(['status', 'feature-plan', 'questionnaire', 'blueprint', 'data-model']);
    expect(tabs.map(getPlanWorkspaceTabLabel)).toEqual([
      'Status',
      'spec',
      'Questionnaire',
      'Blueprint',
      'Data Model',
    ]);
  });

  it('starts on Questionnaire and withholds Status until questionnaire answers are ready', () => {
    const markup = renderToStaticMarkup(
      createElement(PlanModeWorkspaceViewer, {
        sessionId: 'task-1',
        taskMessages: [],
        activityArtifacts: [],
        initialTab: 'status',
      })
    );

    expect(markup).toContain('>Questionnaire</button>');
    expect(markup).toContain('No questionnaire session.');
    expect(markup).not.toContain('>Status</button>');
    expect(markup).not.toContain('>spec</button>');
  });

  it('does not reapply the Questionnaire initial tab after the gate unlocks', () => {
    expect(resolveInitialPlanWorkspaceTabUpdate('questionnaire', true)).toBe('questionnaire');
    expect(resolveInitialPlanWorkspaceTabUpdate('questionnaire', false)).toBeNull();
    expect(resolveInitialPlanWorkspaceTabUpdate('status', false)).toBe('status');
  });
});

describe('WorkspaceBlueprintPreview', () => {
  it('renders a Mock Blueprint preview from message metadata', () => {
    const message = buildBlueprintMessage({
      id: 'message-mock-blueprint-1',
      content: '# Mock Blueprint Summary\n\nShould not be primary.',
      metadataJson: {
        intent: 'mock_blueprint',
        mockBlueprint: representativeMockBlueprint,
      },
    });

    const markup = renderToStaticMarkup(
      createElement(WorkspaceBlueprintPreview, {
        sessionId: 'task-1',
        message,
        activityArtifacts: [],
      })
    );

    expect(markup).toContain('data-blueprint-preview="true"');
    expect(markup).toMatch(/see meta|blueprint\.preview\.seeMeta/);
    expect(markup).not.toContain('Blueprint:');
    expect(markup).not.toContain('Not adopted');
    expect(markup).not.toContain('No Blueprint artifact.');
    expect(markup).not.toContain('Mock Blueprint Summary');
  });

  it('renders a Mock Blueprint preview from a linked activity artifact', () => {
    const message = buildBlueprintMessage({
      id: 'message-mock-blueprint-1',
      content: '# Mock Blueprint Summary\n\nShould not be primary.',
      metadataJson: {
        intent: 'mock_blueprint',
        artifactRef: { artifactId: 'artifact-mock-blueprint-1', kind: 'app_blueprint', version: 1 },
      },
    });
    const activityArtifact = buildActivityArtifact({
      id: 'artifact-mock-blueprint-1',
      contentText: JSON.stringify(representativeMockBlueprint),
      metadataJson: {
        schemaName: 'mock_blueprint',
        mockBlueprint: representativeMockBlueprint,
      },
    });

    const markup = renderToStaticMarkup(
      createElement(WorkspaceBlueprintPreview, {
        sessionId: 'task-1',
        message,
        activityArtifacts: [activityArtifact],
      })
    );

    expect(markup).toContain('data-blueprint-preview="true"');
    expect(markup).not.toContain('No Blueprint artifact.');
    expect(markup).not.toContain('Mock Blueprint Summary');
  });

  it('renders a Mock Blueprint preview from activity artifact JSON content', () => {
    const message = buildBlueprintMessage({
      id: 'message-mock-blueprint-1',
      content: '# Mock Blueprint Summary\n\nShould not be primary.',
      metadataJson: {
        intent: 'mock_blueprint',
        artifactRef: { artifactId: 'artifact-mock-blueprint-1', kind: 'app_blueprint', version: 1 },
      },
    });
    const activityArtifact = buildActivityArtifact({
      id: 'artifact-mock-blueprint-1',
      contentText: JSON.stringify(representativeMockBlueprint),
      metadataJson: { schemaName: 'mock_blueprint' },
    });

    const markup = renderToStaticMarkup(
      createElement(WorkspaceBlueprintPreview, {
        sessionId: 'task-1',
        message,
        activityArtifacts: [activityArtifact],
      })
    );

    expect(markup).toContain('data-blueprint-preview="true"');
    expect(markup).not.toContain('No Blueprint artifact.');
    expect(markup).not.toContain('Mock Blueprint Summary');
  });

  it('renders the latest Blueprint activity artifact when no message is selected', () => {
    const activityArtifact = buildActivityArtifact({
      id: 'artifact-mock-blueprint-1',
      contentText: JSON.stringify(representativeMockBlueprint),
      metadataJson: { schemaName: 'mock_blueprint' },
      createdAt: '1800000000',
    });

    const markup = renderToStaticMarkup(
      createElement(WorkspaceBlueprintPreview, {
        sessionId: 'task-1',
        message: null,
        activityArtifacts: [activityArtifact],
      })
    );

    expect(markup).toContain('data-blueprint-preview="true"');
    expect(markup).not.toContain('No Blueprint artifact.');
  });

  it('does not render Markdown fallback when Mock Blueprint conversion fails', () => {
    const message = buildBlueprintMessage({
      id: 'message-broken-mock-blueprint',
      content: '# Mock Blueprint Summary\n\nShould not be primary.',
      metadataJson: {
        intent: 'mock_blueprint',
        mockBlueprint: {
          artifactKind: 'mock_blueprint',
          id: 'broken',
          name: 'Broken',
          version: 1,
        },
      },
    });

    const markup = renderToStaticMarkup(
      createElement(WorkspaceBlueprintPreview, {
        sessionId: 'task-1',
        message,
        activityArtifacts: [],
      })
    );

    expect(markup).toContain('Blueprint preview is unavailable.');
    expect(markup).not.toContain('Mock Blueprint Summary');
  });

  it('uses a linked activity artifact when message Mock Blueprint metadata is incomplete', () => {
    const message = buildBlueprintMessage({
      id: 'message-broken-linked-mock-blueprint',
      content: '# Mock Blueprint Summary\n\nShould not be primary.',
      metadataJson: {
        intent: 'mock_blueprint',
        artifactRef: {
          artifactId: 'artifact-valid-mock-blueprint',
          kind: 'app_blueprint',
          version: 1,
        },
        mockBlueprint: {
          artifactKind: 'mock_blueprint',
          id: 'broken',
          name: 'Broken',
          version: 1,
        },
      },
    });
    const activityArtifact = buildActivityArtifact({
      id: 'artifact-valid-mock-blueprint',
      contentText: JSON.stringify(representativeMockBlueprint),
      metadataJson: { schemaName: 'mock_blueprint' },
    });

    const markup = renderToStaticMarkup(
      createElement(WorkspaceBlueprintPreview, {
        sessionId: 'task-1',
        message,
        activityArtifacts: [activityArtifact],
      })
    );

    expect(markup).toContain('data-blueprint-preview="true"');
    expect(markup).not.toContain('Blueprint preview is unavailable.');
    expect(markup).not.toContain('Mock Blueprint Summary');
  });

  it('selects the newest Blueprint message by numeric createdAt instead of array order', () => {
    const newerMessage = buildBlueprintMessage({
      id: 'message-mock-blueprint-newer',
      createdAt: '1800000000',
      metadataJson: {
        intent: 'mock_blueprint',
        mockBlueprint: representativeMockBlueprint,
      },
    });
    const olderMessage = buildBlueprintMessage({
      id: 'message-blueprint-older',
      createdAt: '2026-06-02T00:00:00.000Z',
      metadataJson: {
        intent: 'app_blueprint',
        appBlueprint: { id: 'older-blueprint', name: 'Older Blueprint', screens: [] },
      },
    });

    const workspaceMessages = selectPlanModeWorkspaceMessages({
      taskMessages: [newerMessage, olderMessage],
      activityArtifacts: [],
      generatedMessages: [],
      workspace: null,
    });

    expect(workspaceMessages.activeBlueprintMessage?.id).toBe(newerMessage.id);
  });
});
