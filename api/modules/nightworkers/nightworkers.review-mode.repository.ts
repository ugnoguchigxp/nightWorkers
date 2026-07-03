import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  reviewArtifacts,
  reviewFindings,
  reviewKnowledgeCandidates,
  reviewProposedGoals,
  reviewRecommendations,
  reviewSecurityHandoffs,
  reviewSessions,
} from '../../db/review-mode-schema';

export async function getReviewRecommendationByRun(runId: string) {
  const [row] = await db
    .select()
    .from(reviewRecommendations)
    .where(eq(reviewRecommendations.runId, runId));
  return row ?? null;
}

export async function upsertReviewRecommendation(data: {
  runId: string;
  taskId: string;
  repositoryId: string;
  level: string;
  defaultAction: string;
  reasonsJson: unknown[];
}) {
  const now = new Date();
  const [row] = await db
    .insert(reviewRecommendations)
    .values({ ...data, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: reviewRecommendations.runId,
      set: {
        taskId: data.taskId,
        repositoryId: data.repositoryId,
        level: data.level,
        defaultAction: data.defaultAction,
        reasonsJson: data.reasonsJson,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function getReviewSessionByRun(runId: string) {
  const [row] = await db.select().from(reviewSessions).where(eq(reviewSessions.runId, runId));
  return row ?? null;
}

export async function getReviewSession(id: string) {
  const [row] = await db.select().from(reviewSessions).where(eq(reviewSessions.id, id));
  return row ?? null;
}

export async function getLatestReviewSessionForTask(taskId: string) {
  const [row] = await db
    .select()
    .from(reviewSessions)
    .where(eq(reviewSessions.taskId, taskId))
    .orderBy(desc(reviewSessions.updatedAt));
  return row ?? null;
}

export async function createOrStartReviewSession(data: {
  runId: string;
  taskId: string;
  repositoryId: string;
  recommendationId: string | null;
}) {
  const now = new Date();
  const [row] = await db
    .insert(reviewSessions)
    .values({
      ...data,
      status: 'in_progress',
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: reviewSessions.runId,
      set: {
        status: 'in_progress',
        recommendationId: data.recommendationId,
        startedAt: now,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function updateReviewSession(
  id: string,
  data: {
    status?: string;
    completedAt?: Date | null;
    finalAction?: string | null;
    finalNote?: string | null;
  }
) {
  const [row] = await db
    .update(reviewSessions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(reviewSessions.id, id))
    .returning();
  return row ?? null;
}

export async function upsertReviewArtifact(data: {
  reviewSessionId: string;
  runId: string;
  taskId: string;
  kind: string;
  status: string;
  artifactJson: unknown;
  sourceEvidenceRefsJson: unknown[];
}) {
  const now = new Date();
  const [row] = await db
    .insert(reviewArtifacts)
    .values({ ...data, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [reviewArtifacts.reviewSessionId, reviewArtifacts.kind],
      set: {
        status: data.status,
        artifactJson: data.artifactJson,
        sourceEvidenceRefsJson: data.sourceEvidenceRefsJson,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function listReviewArtifacts(reviewSessionId: string) {
  return db
    .select()
    .from(reviewArtifacts)
    .where(eq(reviewArtifacts.reviewSessionId, reviewSessionId))
    .orderBy(desc(reviewArtifacts.updatedAt));
}

export async function listReviewFindings(reviewSessionId: string) {
  return db
    .select()
    .from(reviewFindings)
    .where(eq(reviewFindings.reviewSessionId, reviewSessionId))
    .orderBy(desc(reviewFindings.createdAt));
}

export async function getReviewFinding(reviewSessionId: string, findingId: string) {
  const [row] = await db
    .select()
    .from(reviewFindings)
    .where(
      and(eq(reviewFindings.reviewSessionId, reviewSessionId), eq(reviewFindings.id, findingId))
    );
  return row ?? null;
}

export async function createReviewFindings(
  rows: Array<{
    reviewSessionId: string;
    runId: string;
    taskId: string;
    severity: string;
    title: string;
    body?: string | null;
    evidenceRefsJson: unknown[];
    sourceSection?: string | null;
  }>
) {
  if (rows.length === 0) return [];
  const now = new Date();
  const inserted = [];
  for (const row of rows) {
    const [existing] = await db
      .select()
      .from(reviewFindings)
      .where(
        and(
          eq(reviewFindings.reviewSessionId, row.reviewSessionId),
          eq(reviewFindings.title, row.title),
          eq(reviewFindings.sourceSection, row.sourceSection ?? '')
        )
      );
    if (existing) {
      inserted.push(existing);
      continue;
    }
    const [created] = await db
      .insert(reviewFindings)
      .values({
        ...row,
        body: row.body ?? null,
        sourceSection: row.sourceSection ?? null,
        dispositionStatus: 'unresolved',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    inserted.push(created);
  }
  return inserted;
}

export async function updateReviewFindingDisposition(
  findingId: string,
  data: {
    disposition: string;
    dispositionStatus: string;
    dispositionNote?: string | null;
    evidenceRefsJson?: unknown[];
    createdGoalId?: string | null;
    createdTaskProposalId?: string | null;
    contextStillCandidateId?: string | null;
  }
) {
  const updateData: typeof data & { updatedAt: Date } = {
    disposition: data.disposition,
    dispositionStatus: data.dispositionStatus,
    updatedAt: new Date(),
  };
  if ('dispositionNote' in data) updateData.dispositionNote = data.dispositionNote;
  if ('evidenceRefsJson' in data) updateData.evidenceRefsJson = data.evidenceRefsJson;
  if ('createdGoalId' in data) updateData.createdGoalId = data.createdGoalId;
  if ('createdTaskProposalId' in data) {
    updateData.createdTaskProposalId = data.createdTaskProposalId;
  }
  if ('contextStillCandidateId' in data) {
    updateData.contextStillCandidateId = data.contextStillCandidateId;
  }
  const [row] = await db
    .update(reviewFindings)
    .set(updateData)
    .where(eq(reviewFindings.id, findingId))
    .returning();
  return row ?? null;
}

export async function listReviewKnowledgeCandidates(reviewSessionId: string) {
  return db
    .select()
    .from(reviewKnowledgeCandidates)
    .where(eq(reviewKnowledgeCandidates.reviewSessionId, reviewSessionId))
    .orderBy(desc(reviewKnowledgeCandidates.createdAt));
}

export async function getReviewKnowledgeCandidate(reviewSessionId: string, candidateId: string) {
  const [row] = await db
    .select()
    .from(reviewKnowledgeCandidates)
    .where(
      and(
        eq(reviewKnowledgeCandidates.reviewSessionId, reviewSessionId),
        eq(reviewKnowledgeCandidates.id, candidateId)
      )
    );
  return row ?? null;
}

export async function getReviewKnowledgeCandidateByFinding(findingId: string) {
  const [row] = await db
    .select()
    .from(reviewKnowledgeCandidates)
    .where(eq(reviewKnowledgeCandidates.findingId, findingId))
    .orderBy(desc(reviewKnowledgeCandidates.updatedAt));
  return row ?? null;
}

export async function createReviewKnowledgeCandidate(data: {
  reviewSessionId: string;
  findingId: string;
  candidateType: string;
  title: string;
  body: string;
  avoid?: string | null;
  prefer?: string | null;
}) {
  const now = new Date();
  const [row] = await db
    .insert(reviewKnowledgeCandidates)
    .values({
      ...data,
      avoid: data.avoid ?? null,
      prefer: data.prefer ?? null,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function updateReviewKnowledgeCandidate(
  id: string,
  data: {
    candidateType?: string;
    title?: string;
    body?: string;
    avoid?: string | null;
    prefer?: string | null;
    status?: string;
    contextStillCandidateId?: string | null;
    sendError?: string | null;
  }
) {
  const updateData: typeof data & { updatedAt: Date } = { updatedAt: new Date() };
  if ('candidateType' in data) updateData.candidateType = data.candidateType;
  if ('title' in data) updateData.title = data.title;
  if ('body' in data) updateData.body = data.body;
  if ('avoid' in data) updateData.avoid = data.avoid;
  if ('prefer' in data) updateData.prefer = data.prefer;
  if ('status' in data) updateData.status = data.status;
  if ('contextStillCandidateId' in data) {
    updateData.contextStillCandidateId = data.contextStillCandidateId;
  }
  if ('sendError' in data) updateData.sendError = data.sendError;
  const [row] = await db
    .update(reviewKnowledgeCandidates)
    .set(updateData)
    .where(eq(reviewKnowledgeCandidates.id, id))
    .returning();
  return row ?? null;
}

export async function listReviewProposedGoals(reviewSessionId: string) {
  return db
    .select()
    .from(reviewProposedGoals)
    .where(eq(reviewProposedGoals.reviewSessionId, reviewSessionId))
    .orderBy(desc(reviewProposedGoals.createdAt));
}

export async function getReviewProposedGoal(reviewSessionId: string, goalId: string) {
  const [row] = await db
    .select()
    .from(reviewProposedGoals)
    .where(
      and(
        eq(reviewProposedGoals.reviewSessionId, reviewSessionId),
        eq(reviewProposedGoals.id, goalId)
      )
    );
  return row ?? null;
}

export async function getReviewProposedGoalByFinding(findingId: string) {
  const [row] = await db
    .select()
    .from(reviewProposedGoals)
    .where(eq(reviewProposedGoals.findingId, findingId));
  return row ?? null;
}

export async function createReviewProposedGoal(data: {
  reviewSessionId: string;
  findingId: string;
  runId: string;
  taskId: string;
  repositoryId: string;
  title: string;
  expectedOutcome: string;
  acceptanceCriteria: string;
  verificationGate: string;
  evidenceRefsJson: unknown[];
}) {
  const now = new Date();
  const [row] = await db
    .insert(reviewProposedGoals)
    .values({
      ...data,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: reviewProposedGoals.findingId,
      set: {
        title: data.title,
        expectedOutcome: data.expectedOutcome,
        acceptanceCriteria: data.acceptanceCriteria,
        verificationGate: data.verificationGate,
        evidenceRefsJson: data.evidenceRefsJson,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function updateReviewProposedGoal(
  id: string,
  data: {
    status?: string;
    decisionNote?: string | null;
    materializedTaskId?: string | null;
    materializationTarget?: string | null;
    materializationError?: string | null;
  }
) {
  const updateData: typeof data & { updatedAt: Date } = { updatedAt: new Date() };
  if ('status' in data) updateData.status = data.status;
  if ('decisionNote' in data) updateData.decisionNote = data.decisionNote;
  if ('materializedTaskId' in data) updateData.materializedTaskId = data.materializedTaskId;
  if ('materializationTarget' in data)
    updateData.materializationTarget = data.materializationTarget;
  if ('materializationError' in data) updateData.materializationError = data.materializationError;
  const [row] = await db
    .update(reviewProposedGoals)
    .set(updateData)
    .where(eq(reviewProposedGoals.id, id))
    .returning();
  return row ?? null;
}

export async function listReviewSecurityHandoffs(reviewSessionId: string) {
  return db
    .select()
    .from(reviewSecurityHandoffs)
    .where(eq(reviewSecurityHandoffs.reviewSessionId, reviewSessionId))
    .orderBy(desc(reviewSecurityHandoffs.createdAt));
}

export async function getReviewSecurityHandoffByFinding(findingId: string) {
  const [row] = await db
    .select()
    .from(reviewSecurityHandoffs)
    .where(eq(reviewSecurityHandoffs.findingId, findingId));
  return row ?? null;
}

export async function createReviewSecurityHandoff(data: {
  reviewSessionId: string;
  findingId: string;
  runId: string;
  taskId: string;
  repositoryId: string;
  title: string;
  summary: string;
  requestedIntegration?: string | null;
  status: string;
  changedPathsJson: string[];
  evidenceRefsJson: unknown[];
  handoffArtifactJson: unknown;
}) {
  const now = new Date();
  const [row] = await db
    .insert(reviewSecurityHandoffs)
    .values({
      ...data,
      requestedIntegration: data.requestedIntegration ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: reviewSecurityHandoffs.findingId,
      set: {
        title: data.title,
        summary: data.summary,
        requestedIntegration: data.requestedIntegration ?? null,
        status: data.status,
        changedPathsJson: data.changedPathsJson,
        evidenceRefsJson: data.evidenceRefsJson,
        handoffArtifactJson: data.handoffArtifactJson,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}
