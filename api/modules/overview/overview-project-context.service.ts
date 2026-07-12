import { projectMetaSchema } from "../../../shared/schemas/project-detail.schema";
import type { ProjectQualityRun } from "../../../shared/schemas/quality.schema";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as projectEvaluationRepo from "../project-evaluation/project-evaluation.repository";
import { listProjectQualityRuns } from "../quality";
import { detectProjectStackProfile } from "../techStack";
import { coverageAxesFromQualityRun } from "./overview-coverage";

export async function buildProjectOverviewContext(repositoryId: string) {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) return null;
	const [latestEvaluation, qualityRuns] = await Promise.all([
		projectEvaluationRepo.getLatestProjectEvaluation(repositoryId),
		listProjectQualityRuns(repositoryId),
	]);
	const parsedProjectMeta = projectMetaSchema.safeParse(repository.projectMeta);
	const projectMeta = parsedProjectMeta.success ? parsedProjectMeta.data : null;
	const latestCoverageRun = selectLatestCoverageRun(qualityRuns);

	return {
		repository: {
			id: repository.id,
			name: repository.name,
			branch: repository.branch,
		},
		projectMeta,
		stackProfile: detectProjectStackProfile(repository.localPath),
		latestSnapshot: {
			evaluationScore: latestEvaluation?.overallScore ?? null,
			evaluationAt: toIsoString(latestEvaluation?.createdAt),
			coverageRunId: latestCoverageRun?.id ?? null,
			coverageAt: toIsoString(
				latestCoverageRun?.completedAt ?? latestCoverageRun?.startedAt,
			),
			coverageAxes: coverageAxesFromQualityRun(latestCoverageRun),
		},
	};
}

function selectLatestCoverageRun(runs: ProjectQualityRun[]) {
	return (
		runs.find((run) => Boolean(run.coverageSummary)) ?? null
	);
}

function toIsoString(value: string | Date | null | undefined) {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
