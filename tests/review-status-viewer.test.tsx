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
          label: 'Changed run has no saved verification record.',
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
            label: 'Changed run has no saved verification record.',
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
          reason: 'Saved verification record is missing or failed.',
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
      promptSuggestionCount: 1,
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
        body: 'Saved verification record should be attached.',
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
    promptSuggestions: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        reviewSessionId: '11111111-1111-4111-8111-111111111111',
        findingId: '66666666-6666-4666-8666-666666666666',
        runId: '22222222-2222-4222-8222-222222222222',
        taskId: '33333333-3333-4333-8333-333333333333',
        repositoryId: '44444444-4444-4444-8444-444444444444',
        title: '検証証跡を追加する',
        prompt: '次のレビュー指摘を解消するため、この session の作業を続けてください。',
        expectedOutcome: 'Verification is traceable.',
        acceptanceCriteria: 'Gate evidence is present.',
        verificationHint: 'bun run verify',
        evidenceRefs: [],
        status: 'draft',
        useCount: 0,
        lastUsedAt: null,
        dismissedAt: null,
        createdMessageId: null,
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
    expect(text).toContain('検証記録');
    expect(text).toContain('未開始');
    expect(text).toContain('変更された Run に保存済みの検証記録がありません。');
    expect(text).toContain('保存済みの検証記録がないか、失敗しています。');
    expect(text).toContain('人に確認');
    expect(text).toContain('追加プロンプト');
    expect(text).toContain('入力に入れる');
    expect(text).toContain('このプロンプトで続ける');
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
    expect(text).toContain('Verification Record');
    expect(text).toContain('Not started');
    expect(text).toContain('Changed run has no saved verification record.');
    expect(text).toContain('Human callout');
    expect(text).toContain('Additional Prompts');
    expect(text).toContain('Continue with prompt');
    expect(text).toContain('Needs configuration');
    expect(text).toContain('Final Action');
    expect(text).not.toContain('verification_evidence');
    expect(text).not.toContain('not_started');
    expect(text).not.toContain('human_callout');
  });

  it('renders only active draft prompt suggestion cards', async () => {
    await i18next.changeLanguage('ja');
    const detail = reviewSessionDetail();
    detail.promptSuggestions = [
      {
        ...detail.promptSuggestions[0],
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: '使用済みの追加プロンプト',
        prompt: '使用済みカードの本文',
        status: 'used',
        useCount: 1,
        lastUsedAt: detail.promptSuggestions[0].createdAt,
      },
      {
        ...detail.promptSuggestions[0],
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: '破棄済みの追加プロンプト',
        prompt: '破棄済みカードの本文',
        status: 'dismissed',
        dismissedAt: detail.promptSuggestions[0].createdAt,
      },
      {
        ...detail.promptSuggestions[0],
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        title: '未使用の追加プロンプト',
        prompt: '未使用カードの本文',
        status: 'draft',
      },
    ];

    const text = visibleText(renderToStaticMarkup(<ReviewStatusViewer detail={detail} />));

    expect(text).toContain('未使用の追加プロンプト');
    expect(text).not.toContain('使用済みの追加プロンプト');
    expect(text).not.toContain('破棄済みの追加プロンプト');
  });
});
