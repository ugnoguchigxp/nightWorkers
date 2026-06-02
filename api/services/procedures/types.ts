import type { TaskType } from '../task-intake';

export type ProcedureSectionName =
  | 'Use When'
  | 'Workflow'
  | 'Completion Gate'
  | 'Verification Strategy'
  | 'Report Contract';

export type ProcedureDefinition = {
  id: string;
  title: string;
  taskTypes: TaskType[];
  priority: number;
  source: 'builtin';
  version: 1;
  digest: string;
  sections: Record<ProcedureSectionName, string>;
};

export type ProcedureSnapshot = {
  source: 'builtin';
  id: string;
  title: string;
  version: 1;
  digest: string;
  sections: Record<ProcedureSectionName, string>;
};
