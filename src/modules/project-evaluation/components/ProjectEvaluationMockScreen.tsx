import type { ProjectEvaluationProject } from '../model/projectEvaluationTypes';
import { ProjectEvaluationImprovementInstructionField } from './ImprovementIdeaCard';
import { ProjectEvaluationScreen } from './ProjectEvaluationScreen';

export { ProjectEvaluationImprovementInstructionField };

export type ProjectEvaluationImprovementIdea = Parameters<
  typeof ProjectEvaluationImprovementInstructionField
>[0]['idea'] & {
  summary: string;
  implementationInstruction: string;
};

export const projectEvaluationImprovementIdeas: ProjectEvaluationImprovementIdea[] = [
  {
    title: '評価結果から Task draft を生成する',
    summary:
      '現状では評価結果が保存されても、Project owner が次にどの改善を実装へ移すべきかの判断材料が分断されやすい。評価軸、rationale、期待 score impact を Task draft として扱える形に変換することが重要で、改善候補を実行可能な単位へ確実につなげる必要がある。',
    implementationInstruction:
      'LLM は保存済み Project Evaluation の選択評価軸、rationale、期待 score impact を読み取り、自然言語の Task draft を作成すること。実装では agent prompt、expected outcome、acceptance criteria、verification 方針を保存し、Queue 自動投入ではなく UI から確認できる形にすること。',
  },
];

export function ProjectEvaluationMockScreen({ project }: { project: ProjectEvaluationProject }) {
  return <ProjectEvaluationScreen project={project} />;
}
