export type CallSupervisorOptions = {
  tolerateSchemaFailure?: boolean;
  round?: 1 | 2;
  schemaFirst?: boolean;
  emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
  timeoutMs?: number;
  workingDirectory?: string;
};

export type StructuredJsonLlmOptions = Omit<CallSupervisorOptions, 'schemaFirst' | 'round'> & {
  schemaName: string;
  schema: unknown;
};

export type SupervisorLlmDebugEvent = {
  type:
    | 'model.request_started'
    | 'model.retry_scheduled'
    | 'model.retry_started'
    | 'model.response_delta'
    | 'model.response_finished'
    | 'model.response_parse_failed'
    | 'model.response_repaired';
  severity: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  data?: Record<string, unknown>;
};
