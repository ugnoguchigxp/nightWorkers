export const taskTypes = [
  'code_change',
  'test_change',
  'documentation',
  'review',
  'investigation',
  'verification',
] as const;

export const todoStatuses = [
  'pending',
  'running',
  'passed',
  'failed',
  'skipped',
  'needs_human',
] as const;

export type TaskType = (typeof taskTypes)[number];
export type TodoStatus = (typeof todoStatuses)[number];

export type TaskIntakeTodo = {
  seq: number;
  title: string;
  description: string | null;
  taskType: TaskType;
  status: Extract<TodoStatus, 'pending' | 'needs_human'>;
  dependsOn: number[];
  statusReason: string | null;
};

export type TaskIntakePlan = {
  todos: TaskIntakeTodo[];
  source: 'llm' | 'fallback';
  warnings: string[];
};

export type TaskIntakePlannerInput = {
  taskTitle: string;
  taskDescription?: string | null;
  latestUserMessage: string;
  maxTodos?: number;
};

export type TaskIntakeRawTodo = {
  title?: unknown;
  description?: unknown;
  taskType?: unknown;
  dependsOn?: unknown;
  status?: unknown;
  statusReason?: unknown;
};

export type TaskIntakeRawPlan = {
  todos?: unknown;
};

export type GenerateTaskIntakePlan = (
  input: TaskIntakePlannerInput
) => Promise<TaskIntakeRawPlan | string | null | undefined>;
