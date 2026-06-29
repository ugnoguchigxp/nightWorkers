export type {
  ProjectEvaluationDetail,
  ProjectEvaluationDimensionKey,
  ProjectEvaluationDimensionScore,
  ProjectEvaluationRun,
  ProjectEvaluationTaskLink,
  ProjectImprovementIdea,
} from '../../../../shared/schemas/project-evaluation.schema';

export type ProjectEvaluationProject = {
  id: string;
  name: string;
  localPath: string;
};
