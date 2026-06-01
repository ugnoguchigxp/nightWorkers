export type WorkerToolResult<TPayload> = {
  ok: boolean;
  toolName: string;
  startedAt: string;
  finishedAt: string;
  payload: TPayload;
  error?: {
    code: string;
    message: string;
  };
  artifactIds?: string[];
};
