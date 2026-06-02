import type { ContextCompileSnapshot, IncludedMemoryRef } from '../memory-feedback/types';
import type { ProcedureSnapshot } from '../procedures';
import type { TaskType } from '../task-intake';

export type TodoContextInput = {
  todo: {
    id: string;
    seq: number;
    title: string;
    description?: string | null;
    taskType: TaskType | string;
    procedureId?: string | null;
    procedureSnapshot?: ProcedureSnapshot | null;
  };
  runContext: ContextCompileSnapshot;
  previousTodoSummaries?: Array<{
    id: string;
    seq: number;
    title: string;
    status: string;
    summary?: string | null;
  }>;
};

export type TodoContextSnapshot = {
  version: 1;
  todo: {
    id: string;
    seq: number;
    title: string;
    description: string | null;
    taskType: string;
  };
  selectedProcedure: {
    id: string | null;
    source: string | null;
    title: string | null;
    digest: string | null;
  };
  runContext: {
    source: ContextCompileSnapshot['source'];
    degraded: boolean;
    degradedReason?: string;
    digest: string;
    charCount: number;
    includedMemoryRefs: IncludedMemoryRef[];
    selectedKnowledgeIds: string[];
  };
  previousTodoSummaries: Array<{
    id: string;
    seq: number;
    title: string;
    status: string;
    summary: string | null;
  }>;
};
