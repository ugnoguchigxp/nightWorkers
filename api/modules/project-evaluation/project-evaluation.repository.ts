import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  type ProjectEvaluationActivityEvent,
  type ProjectEvaluationBundle,
  type ProjectEvaluationDimensionKey,
  type ProjectEvaluationRun,
  type ProjectEvaluationTaskLink,
  type ProjectImprovementIdea,
  projectEvaluationRunSchema,
  projectImprovementIdeaSchema,
} from '../../../shared/schemas/project-evaluation.schema';
import { db } from '../../db/client';
import {
  projectEvaluationActivityEvents,
  projectEvaluationDimensions,
  projectEvaluationRuns,
  projectEvaluationTaskLinks,
  projectImprovementIdeaScoreImpacts,
  projectImprovementIdeas,
  tasks,
} from '../../db/schema';

function jsonArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

async function dimensionsForEvaluation(evaluationId: string) {
  const rows = await db
    .select()
    .from(projectEvaluationDimensions)
    .where(eq(projectEvaluationDimensions.evaluationId, evaluationId));
  return rows.map((row) => ({
    id: row.id,
    evaluationId: row.evaluationId,
    key: row.dimensionKey as ProjectEvaluationDimensionKey,
    label: row.label,
    score: row.score,
    confidence: row.confidence,
    rationale: row.rationale,
    evidence: jsonArray(row.evidenceJson),
    concerns: jsonArray(row.concernsJson),
  }));
}

async function mapRun(
  row: typeof projectEvaluationRuns.$inferSelect
): Promise<ProjectEvaluationRun> {
  return projectEvaluationRunSchema.parse({
    id: row.id,
    repositoryId: row.repositoryId,
    bundle: row.bundleJson,
    rawOutput: row.rawOutputJson,
    summary: row.summary,
    overallScore: row.overallScore,
    overallConfidence: row.overallConfidence,
    evidenceLevel: row.evidenceLevel,
    selectedModel: row.selectedModelJson,
    previousEvaluationId: row.previousEvaluationId,
    dimensions: await dimensionsForEvaluation(row.id),
    strengths: jsonArray(row.strengthsJson),
    weaknesses: jsonArray(row.weaknessesJson),
    nextEvidenceToCollect: jsonArray(row.nextEvidenceToCollectJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export async function listProjectEvaluations(repositoryId: string) {
  const rows = await db
    .select()
    .from(projectEvaluationRuns)
    .where(eq(projectEvaluationRuns.repositoryId, repositoryId))
    .orderBy(desc(projectEvaluationRuns.createdAt));
  return Promise.all(rows.map(mapRun));
}

export async function getLatestProjectEvaluation(repositoryId: string) {
  const [row] = await db
    .select()
    .from(projectEvaluationRuns)
    .where(eq(projectEvaluationRuns.repositoryId, repositoryId))
    .orderBy(desc(projectEvaluationRuns.createdAt))
    .limit(1);
  return row ? mapRun(row) : null;
}

export async function getProjectEvaluation(evaluationId: string) {
  const [row] = await db
    .select()
    .from(projectEvaluationRuns)
    .where(eq(projectEvaluationRuns.id, evaluationId));
  return row ? mapRun(row) : null;
}

export async function createProjectEvaluationRun(input: {
  repositoryId: string;
  bundle: ProjectEvaluationBundle;
  report: {
    overallScore: number;
    confidence: number;
    summary: string;
    dimensions: Array<{
      key: ProjectEvaluationDimensionKey;
      label: string;
      score: number;
      confidence: number;
      rationale: string;
      evidence: string[];
      concerns: string[];
    }>;
    strengths: string[];
    weaknesses: string[];
    nextEvidenceToCollect: string[];
  };
  rawOutput: unknown;
  selectedModel: unknown;
  previousEvaluationId?: string | null;
  activityEvents?: Array<Omit<ProjectEvaluationActivityEvent, 'id' | 'evaluationId'>>;
}) {
  const now = new Date();
  const [run] = await db
    .insert(projectEvaluationRuns)
    .values({
      repositoryId: input.repositoryId,
      bundleJson: input.bundle,
      rawOutputJson: input.rawOutput,
      summary: input.report.summary,
      overallScore: input.report.overallScore,
      overallConfidence: input.report.confidence,
      evidenceLevel: input.bundle.evidenceLevel,
      selectedModelJson: input.selectedModel,
      previousEvaluationId: input.previousEvaluationId ?? null,
      strengthsJson: input.report.strengths,
      weaknessesJson: input.report.weaknesses,
      nextEvidenceToCollectJson: input.report.nextEvidenceToCollect,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(projectEvaluationDimensions).values(
    input.report.dimensions.map((dimension) => ({
      evaluationId: run.id,
      dimensionKey: dimension.key,
      label: dimension.label,
      score: dimension.score,
      confidence: dimension.confidence,
      rationale: dimension.rationale,
      evidenceJson: dimension.evidence,
      concernsJson: dimension.concerns,
    }))
  );

  if (input.activityEvents?.length) {
    await createProjectEvaluationActivityEvents(run.id, input.activityEvents);
  }

  return mapRun(run);
}

export async function createProjectEvaluationActivityEvents(
  evaluationId: string,
  events: Array<Omit<ProjectEvaluationActivityEvent, 'id' | 'evaluationId'>>
) {
  if (events.length === 0) return [];
  return db
    .insert(projectEvaluationActivityEvents)
    .values(
      events.map((event) => ({
        id: randomUUID(),
        evaluationId,
        seq: event.seq,
        phase: event.phase,
        level: event.level,
        source: event.source,
        message: event.message,
        status: event.status ?? null,
        payloadJson: event.payload,
        createdAt: event.createdAt instanceof Date ? event.createdAt : new Date(event.createdAt),
      }))
    )
    .returning();
}

export async function listProjectEvaluationActivityEvents(evaluationId: string) {
  const rows = await db
    .select()
    .from(projectEvaluationActivityEvents)
    .where(eq(projectEvaluationActivityEvents.evaluationId, evaluationId))
    .orderBy(projectEvaluationActivityEvents.seq);
  return rows.map((row) => ({
    id: row.id,
    evaluationId: row.evaluationId,
    seq: row.seq,
    phase: row.phase,
    level: row.level as ProjectEvaluationActivityEvent['level'],
    source: row.source,
    message: row.message,
    status: row.status,
    payload: row.payloadJson,
    createdAt: row.createdAt,
  }));
}

export async function createProjectImprovementIdeas(
  evaluationId: string,
  ideas: ProjectImprovementIdea[]
) {
  const saved: ProjectImprovementIdea[] = [];
  for (const idea of ideas) {
    const parsed = projectImprovementIdeaSchema.parse(idea);
    const [row] = await db
      .insert(projectImprovementIdeas)
      .values({
        evaluationId,
        title: parsed.title,
        summary: parsed.summary,
        agentPrompt: parsed.agentPrompt,
        expectedOutcome: parsed.expectedOutcome,
        implementationFocusJson: parsed.implementationFocus,
        targetDimensionsJson: parsed.targetDimensions,
      })
      .returning();
    if (parsed.scoreImpacts.length) {
      await db.insert(projectImprovementIdeaScoreImpacts).values(
        parsed.scoreImpacts.map((impact) => ({
          ideaId: row.id,
          dimensionKey: impact.dimensionKey,
          currentScore: impact.currentScore,
          expectedScoreGain: impact.expectedScoreGain,
          expectedScoreAfter: impact.expectedScoreAfter,
          rationale: impact.rationale,
        }))
      );
    }
    saved.push({ ...parsed, id: row.id, evaluationId, createdAt: row.createdAt });
  }
  return saved;
}

export async function listProjectImprovementIdeas(evaluationId: string) {
  const ideaRows = await db
    .select()
    .from(projectImprovementIdeas)
    .where(eq(projectImprovementIdeas.evaluationId, evaluationId))
    .orderBy(projectImprovementIdeas.createdAt);
  if (ideaRows.length === 0) return [];
  const impactRows = await db
    .select()
    .from(projectImprovementIdeaScoreImpacts)
    .where(
      inArray(
        projectImprovementIdeaScoreImpacts.ideaId,
        ideaRows.map((idea) => idea.id)
      )
    );
  return ideaRows.map((idea) =>
    projectImprovementIdeaSchema.required({ id: true, evaluationId: true }).parse({
      id: idea.id,
      evaluationId: idea.evaluationId,
      title: idea.title,
      summary: idea.summary,
      agentPrompt: idea.agentPrompt,
      expectedOutcome: idea.expectedOutcome,
      implementationFocus: idea.implementationFocusJson,
      targetDimensions: idea.targetDimensionsJson,
      scoreImpacts: impactRows
        .filter((impact) => impact.ideaId === idea.id)
        .map((impact) => ({
          dimensionKey: impact.dimensionKey,
          currentScore: impact.currentScore,
          expectedScoreGain: impact.expectedScoreGain,
          expectedScoreAfter: impact.expectedScoreAfter,
          rationale: impact.rationale,
        })),
      createdAt: idea.createdAt,
    })
  );
}

export async function getProjectImprovementIdeasByIds(evaluationId: string, ideaIds: string[]) {
  const ideas = await listProjectImprovementIdeas(evaluationId);
  const wanted = new Set(ideaIds);
  return ideas.filter((idea) => idea.id && wanted.has(idea.id));
}

export async function createProjectEvaluationTaskLink(input: {
  evaluationId: string;
  ideaId: string;
  taskId: string;
}) {
  const [link] = await db
    .insert(projectEvaluationTaskLinks)
    .values({
      id: randomUUID(),
      evaluationId: input.evaluationId,
      ideaId: input.ideaId,
      taskId: input.taskId,
    })
    .returning();
  return link;
}

export async function listProjectEvaluationTaskLinks(
  evaluationId: string
): Promise<ProjectEvaluationTaskLink[]> {
  const rows = await db
    .select({ link: projectEvaluationTaskLinks, task: tasks })
    .from(projectEvaluationTaskLinks)
    .leftJoin(tasks, eq(projectEvaluationTaskLinks.taskId, tasks.id))
    .where(eq(projectEvaluationTaskLinks.evaluationId, evaluationId))
    .orderBy(projectEvaluationTaskLinks.createdAt);
  return rows.map(({ link, task }) => ({
    id: link.id,
    evaluationId: link.evaluationId,
    ideaId: link.ideaId,
    taskId: link.taskId,
    createdAt: link.createdAt,
    task: task ?? undefined,
  }));
}

export async function existingTaskLinksForIdeas(evaluationId: string, ideaIds: string[]) {
  if (ideaIds.length === 0) return [];
  return db
    .select()
    .from(projectEvaluationTaskLinks)
    .where(
      and(
        eq(projectEvaluationTaskLinks.evaluationId, evaluationId),
        inArray(projectEvaluationTaskLinks.ideaId, ideaIds)
      )
    );
}
