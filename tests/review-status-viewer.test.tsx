import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { i18next } from '../src/i18n/setup';
import { ReviewStatusViewer } from '../src/modules/nightworkers/components/ReviewStatusViewer';
import type { ReviewSessionDetail } from '../src/modules/nightworkers/types';

function visibleText(markup: string) {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

function reviewSessionDetail(): ReviewSessionDetail {
  const now = '2026-07-06T00:00:00.000Z';
  return {
    session: {
      id: '11111111-1111-4111-8111-111111111111',
      runId: '22222222-2222-4222-8222-222222222222',
      taskId: '33333333-3333-4333-8333-333333333333',
      repositoryId: '44444444-4444-4444-8444-444444444444',
      status: 'in_progress',
      recommendationId: '55555555-5555-4555-8555-555555555555',
      startedAt: now,
      completedAt: null,
      finalAction: null,
      finalNote: null,
      createdAt: now,
      updatedAt: now,
    },
    recommendation: {
      version: 1,
      id: '55555555-5555-4555-8555-555555555555',
      runId: '22222222-2222-4222-8222-222222222222',
      taskId: '33333333-3333-4333-8333-333333333333',
      repositoryId: '44444444-4444-4444-8444-444444444444',
      level: 'required',
      defaultAction: 'require_review',
      reasons: [
        {
          code: 'verification_missing',
          severity: 'blocking',
          label: 'Changed run has no completed verification evidence.',
          evidenceRefs: [],
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
    statusArtifact: {
      version: 1,
      reviewSessionId: '11111111-1111-4111-8111-111111111111',
      runId: '22222222-2222-4222-8222-222222222222',
      taskId: '33333333-3333-4333-8333-333333333333',
      recommendation: {
        version: 1,
        id: '55555555-5555-4555-8555-555555555555',
        runId: '22222222-2222-4222-8222-222222222222',
        taskId: '33333333-3333-4333-8333-333333333333',
        repositoryId: '44444444-4444-4444-8444-444444444444',
        level: 'required',
        defaultAction: 'require_review',
        reasons: [
          {
            code: 'verification_missing',
            severity: 'blocking',
            label: 'Changed run has no completed verification evidence.',
            evidenceRefs: [],
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
      sections: [
        {
          kind: 'verification_evidence',
          requirement: 'required',
          progress: 'not_started',
          reason: 'Verification evidence is missing or failed.',
          artifactId: null,
          findingCounts: { blocking: 1, warning: 0, info: 0 },
        },
      ],
      finalActionGate: {
        canApprove: false,
        blockingReason: 'Required review sections are not complete.',
        unresolvedBlockingFindingIds: ['66666666-6666-4666-8666-666666666666'],
        requiredSectionKindsRemaining: ['verification_evidence'],
      },
      proposedGoalCount: 1,
      knowledgeCandidateCount: 1,
      securityHandoffCount: 1,
    },
    artifacts: [],
    findings: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        reviewSessionId: '11111111-1111-4111-8111-111111111111',
        runId: '22222222-2222-4222-8222-222222222222',
        taskId: '33333333-3333-4333-8333-333333333333',
        severity: 'blocking',
        title: 'Missing verification',
        body: 'Verification evidence should be attached.',
        disposition: null,
        dispositionStatus: 'unresolved',
        dispositionNote: null,
        evidenceRefs: [],
        createdGoalId: null,
        createdTaskProposalId: null,
        contextStillCandidateId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    knowledgeCandidates: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        reviewSessionId: '11111111-1111-4111-8111-111111111111',
        findingId: '66666666-6666-4666-8666-666666666666',
        candidateType: 'rule',
        title: 'Require verification',
        body: 'Review verification before approval.',
        avoid: 'Approve without evidence.',
        prefer: 'Run the repo-native gate.',
        status: 'draft',
        contextStillCandidateId: null,
        sendError: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    proposedGoals: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        reviewSessionId: '11111111-1111-4111-8111-111111111111',
        findingId: '66666666-6666-4666-8666-666666666666',
        runId: '22222222-2222-4222-8222-222222222222',
        taskId: '33333333-3333-4333-8333-333333333333',
        repositoryId: '44444444-4444-4444-8444-444444444444',
        title: 'Add verification gate',
        expectedOutcome: 'Verification is traceable.',
        acceptanceCriteria: 'Gate evidence is present.',
        verificationGate: 'bun run verify',
        evidenceRefs: [],
        status: 'draft',
        decisionNote: null,
        materializedTaskId: null,
        materializationTarget: null,
        materializationError: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    securityHandoffs: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        reviewSessionId: '11111111-1111-4111-8111-111111111111',
        findingId: '66666666-6666-4666-8666-666666666666',
        runId: '22222222-2222-4222-8222-222222222222',
        taskId: '33333333-3333-4333-8333-333333333333',
        repositoryId: '44444444-4444-4444-8444-444444444444',
        title: 'Security plugin check',
        summary: 'External security review is needed.',
        requestedIntegration: null,
        status: 'needs_configuration',
        changedPaths: ['api/auth.ts'],
        evidenceRefs: [],
        handoffArtifact: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

describe('ReviewStatusViewer i18n', () => {
  it('renders review status artifact controls and deterministic states in Japanese', async () => {
    await i18next.changeLanguage('ja');

    const text = visibleText(
      renderToStaticMarkup(<ReviewStatusViewer detail={reviewSessionDetail()} />)
    );

    expect(text).toContain('レビュー状況');
    expect(text).toContain('レビュー必須');
    expect(text).toContain('必須');
    expect(text).toContain('検証証跡');
    expect(text).toContain('未開始');
    expect(text).toContain('変更された Run に完了済み検証証跡がありません。');
    expect(text).toContain('検証証跡がないか、失敗しています。');
    expect(text).toContain('人に確認');
    expect(text).toContain('設定が必要');
    expect(text).toContain('ルール');
    expect(text).toContain('最終アクション');
    expect(text).not.toContain('Review Status');
    expect(text).not.toContain('verification_evidence');
    expect(text).not.toContain('not_started');
    expect(text).not.toContain('human_callout');
  });

  it('renders the same review status artifact through English dictionary keys', async () => {
    await i18next.changeLanguage('en');

    const text = visibleText(
      renderToStaticMarkup(<ReviewStatusViewer detail={reviewSessionDetail()} />)
    );

    expect(text).toContain('Review Status');
    expect(text).toContain('Review required');
    expect(text).toContain('Verification Evidence');
    expect(text).toContain('Not started');
    expect(text).toContain('Changed run has no completed verification evidence.');
    expect(text).toContain('Human callout');
    expect(text).toContain('Needs configuration');
    expect(text).toContain('Final Action');
    expect(text).not.toContain('verification_evidence');
    expect(text).not.toContain('not_started');
    expect(text).not.toContain('human_callout');
  });
});
