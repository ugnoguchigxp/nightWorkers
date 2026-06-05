import { z } from 'zod';
import { jobTypes } from './prompt';

export {
  buildRound1JobTypePrompt,
  buildRound2ToolCallPrompt,
  defaultFlatSkillDirectory,
  getAllowedToolsForJobType,
  getExecutableWorkerToolName,
  initiallyImplementedJobTypes,
  type JobType,
  jobTypeDescriptions,
  jobTypes,
  loadFlatSkill,
  renderToolDefinitions,
  type SupervisorToolName,
  type ToolDefinition,
  toolRegistry,
  validateToolCallForJobType,
} from './prompt';

const jobTypeSelectionSchema = z
  .object({
    jobType: z.enum(jobTypes),
    goal: z.string().min(1),
  })
  .strict();

const toolCallEnvelopeSchema = z
  .object({
    toolCall: z
      .object({
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).default({}),
      })
      .strict(),
  })
  .strict();

export type JobTypeSelection = z.infer<typeof jobTypeSelectionSchema>;
export type AgentToolCallEnvelope = z.infer<typeof toolCallEnvelopeSchema>;

export function buildResponseJsonSchema(round?: 1 | 2) {
  if (round === 1) {
    return {
      name: 'schema_first_round_1_job_type_and_goal',
      strict: true,
      schema: {
        type: 'object',
        required: ['jobType', 'goal'],
        additionalProperties: false,
        properties: {
          jobType: { type: 'string', enum: [...jobTypes] },
          goal: { type: 'string' },
        },
      },
    };
  }
  return {
    name: 'schema_first_round_2_tool_call',
    strict: true,
    schema: {
      type: 'object',
      required: ['toolCall'],
      additionalProperties: false,
      properties: {
        toolCall: {
          type: 'object',
          required: ['name', 'arguments'],
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            arguments: { type: 'object' },
          },
        },
      },
    },
  };
}

export function parseSupervisorOutput(raw: unknown, round?: 1 | 2) {
  return round === 1 ? jobTypeSelectionSchema.parse(raw) : toolCallEnvelopeSchema.parse(raw);
}
