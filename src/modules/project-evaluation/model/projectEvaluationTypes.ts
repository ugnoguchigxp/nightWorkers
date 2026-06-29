export type {
  ProjectEvaluationActivityEvent,
  ProjectEvaluationActivityReplay,
  ProjectEvaluationDetail,
  ProjectEvaluationDimensionKey,
  ProjectEvaluationDimensionScore,
  ProjectEvaluationRun,
  ProjectEvaluationTaskLink,
  ProjectImprovementIdea,
  StartProjectEvaluationResponse,
} from '../../../../shared/schemas/project-evaluation.schema';

export type ProjectEvaluationProject = {
  id: string;
  name: string;
  localPath: string;
};
