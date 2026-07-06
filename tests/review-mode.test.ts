import crypto from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../api/app';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import * as reviewRepo from '../api/modules/nightworkers/nightworkers.review-mode.repository';

const sameOriginHeaders = { Origin: 'http://localhost:39174' };
const originalContextStillRegisterCandidatesUrl = process.env.CONTEXT_STILL_REGISTER_CANDIDATES_URL;
const originalSecurityPluginIntegration = process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION;

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

afterEach(() => {
  if (originalContextStillRegisterCandidatesUrl === undefined) {
    delete process.env.CONTEXT_STILL_REGISTER_CANDIDATES_URL;
  } else {
    process.env.CONTEXT_STILL_REGISTER_CANDIDATES_URL = originalContextStillRegisterCandidatesUrl;
  }
  if (originalSecurityPluginIntegration === undefined) {
    delete process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION;
  } else {
    process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION = originalSecurityPluginIntegration;
  }
  vi.unstubAllGlobals();
});

describe('Review Mode', () => {
  it('creates a required recommendation for schema changes without mutating run status', async () => {
    const { task } = await createTask();
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'completed',
      workerKind: 'native-local',
      summary: 'Done',
      finalReport: 'Done',
      startedAt: new Date(),
      endedAt: new Date(),
      finishedAt: new Date(),
    });
    await repo.updateTaskRun(run.id, {
      diffPatch: 'diff --git a/drizzle/migrations/0001.sql b/drizzle/migrations/0001.sql\n',
    });

    const res = await app.request(`http://localhost/api/runs/${run.id}/review-recommendation`, {
      headers: sameOriginHeaders,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.level).toBe('required');
    expect(body.reasons.map((reason: { code: string }) => reason.code)).toContain(
      'schema_or_migration_change'
    );
    expect((await repo.getTaskRun(run.id))?.status).toBe('completed');
  });

  it('starts a review session, runs required sections, and gates approval on findings', async () => {
    const { task } = await createTask();
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'completed',
      workerKind: 'native-local',
      summary: 'Tests passed',
      finalReport: 'Tests passed',
      startedAt: new Date(),
      endedAt: new Date(),
      finishedAt: new Date(),
    });
    await repo.updateTaskRun(run.id, {
      diffPatch: 'diff --git a/shared/schemas/public.schema.ts b/shared/schemas/public.schema.ts\n',
    });

    const startRes = await app.request(`http://localhost/api/runs/${run.id}/review-sessions`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });
    expect(startRes.status).toBe(201);
    const started = await startRes.json();
    expect(started.statusArtifact.finalActionGate.canApprove).toBe(false);
    expect(started.statusArtifact.finalActionGate.requiredSectionKindsRemaining).toContain(
      'verification_evidence'
    );

    const sectionRes = await app.request(
      `http://localhost/api/review-sessions/${started.session.id}/sections/verification_evidence/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({}),
      }
    );
    expect(sectionRes.status).toBe(200);
    const afterSection = await sectionRes.json();
    expect(afterSection.findings.map((finding: { title: string }) => finding.title)).toContain(
      'Saved verification record is missing'
    );

    const approveRes = await app.request(
      `http://localhost/api/review-sessions/${started.session.id}/final-action`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ action: 'approve' }),
      }
    );
    expect(approveRes.status).toBe(400);
    expect((await repo.getTaskRun(run.id))?.status).toBe('completed');
  });

  it('keeps knowledge candidates draft when contextStill integration is not configured', async () => {
    delete process.env.CONTEXT_STILL_REGISTER_CANDIDATES_URL;
    const { sessionId, findingId } = await createSessionWithVerificationFinding();

    const createCandidateRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/knowledge-candidates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({
          findingId,
          candidateType: 'procedure',
          title: 'Capture review verification follow-up',
        }),
      }
    );
    expect(createCandidateRes.status).toBe(200);
    const created = await createCandidateRes.json();
    const candidate = created.knowledgeCandidates[0];
    expect(candidate.status).toBe('draft');

    const sendRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/knowledge-candidates/${candidate.id}/send`,
      {
        method: 'POST',
        headers: sameOriginHeaders,
      }
    );

    expect(sendRes.status).toBe(200);
    const sent = await sendRes.json();
    expect(sent.knowledgeCandidates[0]).toMatchObject({
      id: candidate.id,
      status: 'draft',
      sendError: 'contextStill integration is not configured.',
    });
  });

  it('sends knowledge candidates through the configured contextStill integration boundary', async () => {
    process.env.CONTEXT_STILL_REGISTER_CANDIDATES_URL =
      'http://contextstill.local/register_candidates';
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ candidates: [{ id: 'contextstill-candidate-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { sessionId, findingId } = await createSessionWithVerificationFinding();

    const createCandidateRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/knowledge-candidates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ findingId, candidateType: 'rule' }),
      }
    );
    expect(createCandidateRes.status).toBe(200);
    const created = await createCandidateRes.json();
    const candidate = created.knowledgeCandidates[0];

    const sendRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/knowledge-candidates/${candidate.id}/send`,
      {
        method: 'POST',
        headers: sameOriginHeaders,
      }
    );

    expect(sendRes.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://contextstill.local/register_candidates',
      expect.objectContaining({ method: 'POST' })
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(requestInit.body));
    expect(payload.items[0]).toMatchObject({
      title: candidate.title,
      body: candidate.body,
      type: 'rule',
      source: 'nightworkers_review_mode',
    });
    expect(payload.items[0].metadata).toMatchObject({
      reviewSessionId: sessionId,
      findingId,
      reviewKnowledgeCandidateId: candidate.id,
    });
    const sent = await sendRes.json();
    expect(sent.knowledgeCandidates[0]).toMatchObject({
      id: candidate.id,
      status: 'sent',
      contextStillCandidateId: 'contextstill-candidate-1',
      sendError: null,
    });
  });

  it('edits and discards knowledge candidates before send', async () => {
    const { sessionId, findingId } = await createSessionWithVerificationFinding();
    const createCandidateRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/knowledge-candidates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ findingId, candidateType: 'rule' }),
      }
    );
    expect(createCandidateRes.status).toBe(200);
    const created = await createCandidateRes.json();
    const candidate = created.knowledgeCandidates[0];

    const editRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/knowledge-candidates/${candidate.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({
          title: 'Generalized verification evidence rule',
          body: 'Require concrete verification command evidence before approval.',
          avoid: 'Approving without runnable evidence',
          prefer: 'Cite the exact command and result',
        }),
      }
    );
    expect(editRes.status).toBe(200);
    const edited = await editRes.json();
    expect(edited.knowledgeCandidates[0]).toMatchObject({
      id: candidate.id,
      title: 'Generalized verification evidence rule',
      body: 'Require concrete verification command evidence before approval.',
      avoid: 'Approving without runnable evidence',
      prefer: 'Cite the exact command and result',
      status: 'draft',
      sendError: null,
    });

    const discardRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/knowledge-candidates/${candidate.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ status: 'discarded' }),
      }
    );
    expect(discardRes.status).toBe(200);
    const discarded = await discardRes.json();
    expect(discarded.knowledgeCandidates[0]).toMatchObject({
      id: candidate.id,
      status: 'discarded',
    });

    const sendRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/knowledge-candidates/${candidate.id}/send`,
      {
        method: 'POST',
        headers: sameOriginHeaders,
      }
    );
    expect(sendRes.status).toBe(400);
  });

  it('creates a knowledge candidate preview when the finding disposition is knowledge_candidate', async () => {
    const { sessionId, findingId } = await createSessionWithVerificationFinding();

    const dispositionRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/findings/${findingId}/disposition`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({
          disposition: 'knowledge_candidate',
          note: 'Save a reusable review rule.',
        }),
      }
    );

    expect(dispositionRes.status).toBe(200);
    const routed = await dispositionRes.json();
    expect(routed.knowledgeCandidates).toHaveLength(1);
    expect(
      routed.findings.find((finding: { id: string }) => finding.id === findingId)
    ).toMatchObject({
      disposition: 'knowledge_candidate',
      dispositionStatus: 'converted',
      contextStillCandidateId: routed.knowledgeCandidates[0].id,
    });

    const duplicateCreateRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/knowledge-candidates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ findingId, candidateType: 'rule' }),
      }
    );
    expect(duplicateCreateRes.status).toBe(200);
    const duplicateCreate = await duplicateCreateRes.json();
    expect(duplicateCreate.knowledgeCandidates).toHaveLength(1);
  });

  it('routes findings to review-owned prompt suggestions without creating draft tasks', async () => {
    const { sessionId, findingId } = await createSessionWithVerificationFinding();

    const dispositionRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/findings/${findingId}/disposition`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({
          disposition: 'prompt_suggestion',
          note: 'Continue this session with verification evidence.',
        }),
      }
    );
    expect(dispositionRes.status).toBe(200);
    const routed = await dispositionRes.json();
    expect(routed.promptSuggestions).toHaveLength(1);
    expect(routed.promptSuggestions[0]).toMatchObject({
      findingId,
      status: 'draft',
    });
    expect(routed.promptSuggestions[0].prompt).toContain('この session の作業を続けてください');
    expect(
      routed.findings.find((finding: { id: string }) => finding.id === findingId)
    ).toMatchObject({
      disposition: 'prompt_suggestion',
      dispositionStatus: 'converted',
      createdGoalId: routed.promptSuggestions[0].id,
    });

    const useSuggestionRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/prompt-suggestions/${routed.promptSuggestions[0].id}/use`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({}),
      }
    );
    expect(useSuggestionRes.status).toBe(200);
    const used = await useSuggestionRes.json();
    expect(used.promptSuggestions[0]).toMatchObject({ status: 'used', useCount: 1 });
  });

  it('does not persist prompt_suggestion disposition when evidence refs are missing', async () => {
    const { sessionId, findingId } = await createSessionWithManualFinding({ evidenceRefs: [] });

    const dispositionRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/findings/${findingId}/disposition`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({
          disposition: 'prompt_suggestion',
          note: 'This should not be persisted without evidence.',
        }),
      }
    );
    expect(dispositionRes.status).toBe(400);

    const detailRes = await app.request(`http://localhost/api/review-sessions/${sessionId}`, {
      headers: sameOriginHeaders,
    });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.promptSuggestions).toHaveLength(0);
    expect(
      detail.findings.find((finding: { id: string }) => finding.id === findingId)
    ).toMatchObject({
      disposition: null,
      dispositionStatus: 'unresolved',
      createdGoalId: null,
    });
  });

  it('caps generated prompt suggestions to five active cards', async () => {
    const { sessionId } = await createSessionWithManualFindings(6);

    const syncRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/prompt-suggestions`,
      {
        method: 'POST',
        headers: sameOriginHeaders,
      }
    );
    expect(syncRes.status).toBe(200);
    const synced = await syncRes.json();
    expect(
      synced.promptSuggestions.filter((item: { status: string }) => item.status === 'draft')
    ).toHaveLength(5);
    expect(synced.statusArtifact.promptSuggestionCount).toBe(5);
  });

  it('routes security plugin handoff findings into review-owned handoff artifacts', async () => {
    delete process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION;
    const { sessionId, findingId } = await createSessionWithSecurityFinding();

    const dispositionRes = await app.request(
      `http://localhost/api/review-sessions/${sessionId}/findings/${findingId}/disposition`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({
          disposition: 'security_plugin_handoff',
          note: 'External security evidence is needed.',
        }),
      }
    );

    expect(dispositionRes.status).toBe(200);
    const routed = await dispositionRes.json();
    expect(routed.securityHandoffs).toHaveLength(1);
    expect(routed.securityHandoffs[0]).toMatchObject({
      findingId,
      status: 'needs_configuration',
      changedPaths: ['api/auth/token.ts'],
    });
    expect(
      routed.artifacts.find((artifact: { kind: string }) => artifact.kind === 'security_handoff')
    ).toMatchObject({
      status: 'needs_human',
    });
  });
});

async function createTask() {
  const project = await repo.createRepository({
    name: `TEST: Review Mode ${crypto.randomUUID()}`,
    localPath: '/Users/y.noguchi/Code/nightWorkers',
    branch: 'main',
  });
  const task = await repo.createTask({
    repositoryId: project.id,
    title: 'Review Mode task',
    objective: 'Implement a risky change',
    acceptanceCriteria: 'Evidence must be reviewed',
    status: 'completed',
  });
  return { project, task };
}

async function createSessionWithVerificationFinding() {
  const { task } = await createTask();
  const run = await repo.createTaskRun({
    taskId: task.id,
    repositoryId: task.repositoryId,
    status: 'completed',
    workerKind: 'native-local',
    summary: 'Implementation finished',
    finalReport: 'Implementation finished without verification details.',
    startedAt: new Date(),
    endedAt: new Date(),
    finishedAt: new Date(),
  });
  await repo.updateTaskRun(run.id, {
    diffPatch: 'diff --git a/src/app.ts b/src/app.ts\n',
  });
  const startRes = await app.request(`http://localhost/api/runs/${run.id}/review-sessions`, {
    method: 'POST',
    headers: sameOriginHeaders,
  });
  expect(startRes.status).toBe(201);
  const started = await startRes.json();
  const sectionRes = await app.request(
    `http://localhost/api/review-sessions/${started.session.id}/sections/verification_evidence/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({}),
    }
  );
  expect(sectionRes.status).toBe(200);
  const afterSection = await sectionRes.json();
  const finding = afterSection.findings.find(
    (item: { title: string }) => item.title === 'Saved verification record is missing'
  );
  expect(finding).toBeTruthy();
  return { sessionId: started.session.id as string, findingId: finding.id as string };
}

async function createSessionWithSecurityFinding() {
  const { task } = await createTask();
  const run = await repo.createTaskRun({
    taskId: task.id,
    repositoryId: task.repositoryId,
    status: 'completed',
    workerKind: 'native-local',
    summary: 'Security-sensitive change finished',
    finalReport: 'Security-sensitive change finished.',
    startedAt: new Date(),
    endedAt: new Date(),
    finishedAt: new Date(),
  });
  await repo.updateTaskRun(run.id, {
    diffPatch: 'diff --git a/api/auth/token.ts b/api/auth/token.ts\n',
  });
  const startRes = await app.request(`http://localhost/api/runs/${run.id}/review-sessions`, {
    method: 'POST',
    headers: sameOriginHeaders,
  });
  expect(startRes.status).toBe(201);
  const started = await startRes.json();
  const sectionRes = await app.request(
    `http://localhost/api/review-sessions/${started.session.id}/sections/security_review/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({}),
    }
  );
  expect(sectionRes.status).toBe(200);
  const afterSection = await sectionRes.json();
  const finding = afterSection.findings.find(
    (item: { title: string }) => item.title === 'Security-sensitive change needs external evidence'
  );
  expect(finding).toBeTruthy();
  return { sessionId: started.session.id as string, findingId: finding.id as string };
}

async function createSessionWithManualFinding(input: { evidenceRefs: unknown[] }) {
  const { task } = await createTask();
  const run = await repo.createTaskRun({
    taskId: task.id,
    repositoryId: task.repositoryId,
    status: 'completed',
    workerKind: 'native-local',
    summary: 'Manual review fixture',
    finalReport: 'Manual review fixture.',
    startedAt: new Date(),
    endedAt: new Date(),
    finishedAt: new Date(),
  });
  const startRes = await app.request(`http://localhost/api/runs/${run.id}/review-sessions`, {
    method: 'POST',
    headers: sameOriginHeaders,
  });
  expect(startRes.status).toBe(201);
  const started = await startRes.json();
  const [finding] = await reviewRepo.createReviewFindings([
    {
      reviewSessionId: started.session.id,
      runId: run.id,
      taskId: task.id,
      severity: 'blocking',
      title: `Manual finding ${crypto.randomUUID()}`,
      body: 'Manual finding for disposition routing.',
      evidenceRefsJson: input.evidenceRefs,
      sourceSection: 'findings',
    },
  ]);
  return { sessionId: started.session.id as string, findingId: finding.id as string };
}

async function createSessionWithManualFindings(count: number) {
  const { task } = await createTask();
  const run = await repo.createTaskRun({
    taskId: task.id,
    repositoryId: task.repositoryId,
    status: 'completed',
    workerKind: 'native-local',
    summary: 'Manual review fixture',
    finalReport: 'Manual review fixture.',
    startedAt: new Date(),
    endedAt: new Date(),
    finishedAt: new Date(),
  });
  const startRes = await app.request(`http://localhost/api/runs/${run.id}/review-sessions`, {
    method: 'POST',
    headers: sameOriginHeaders,
  });
  expect(startRes.status).toBe(201);
  const started = await startRes.json();
  await reviewRepo.createReviewFindings(
    Array.from({ length: count }, (_, index) => ({
      reviewSessionId: started.session.id,
      runId: run.id,
      taskId: task.id,
      severity: 'blocking',
      title: `Manual capped finding ${index} ${crypto.randomUUID()}`,
      body: 'Manual finding for prompt suggestion caps.',
      evidenceRefsJson: [{ kind: 'changed_file', path: `src/file-${index}.ts` }],
      sourceSection: 'findings',
    }))
  );
  return { sessionId: started.session.id as string };
}
