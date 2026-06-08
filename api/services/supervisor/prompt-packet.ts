import type { JobType, ToolDefinition } from './prompt';

export type SupervisorPromptPacket = {
  basePolicy: string[];
  roundPolicy: string[];
  projectContext: string[];
  runtimeContext: string[];
  userRequest: string[];
  executionEvidence: string[];
  outputContract: string[];
  diagnostics: {
    round: 1 | 2;
    projectRoot: string;
    jobType?: JobType;
    allowedToolNames?: string[];
  };
};

export type Round2PromptPacketInput = {
  projectRoot: string;
  taskId?: string;
  jobType: JobType;
  tools: ToolDefinition[];
  externalAllowedPaths?: string[];
};

export function renderSupervisorSystemPrompt(packet: SupervisorPromptPacket) {
  return [
    ...packet.basePolicy,
    ...packet.roundPolicy,
    ...packet.projectContext,
    ...packet.runtimeContext,
    ...packet.userRequest,
    ...packet.executionEvidence,
    ...packet.outputContract,
  ].join('\n');
}
