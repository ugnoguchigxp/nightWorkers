import { z } from 'zod';
import {
  dedicatedDesignViewSchema,
  specificationLensSchema,
} from '../../../shared/schemas/plan-mode-artifact.schema';
import { jobTypes } from './prompt';

export {
  buildRound1JobTypePrompt,
  getAllowedToolsForJobType,
  getExecutableWorkerToolName,
  initiallyImplementedJobTypes,
  type JobType,
  jobTypeDescriptions,
  jobTypes,
  renderToolDefinitions,
  type SupervisorToolName,
  type ToolDefinition,
  toolRegistry,
  validateToolCallForJobType,
} from './prompt';

const planModeRoutingDecisionSchema = z
  .object({
    primaryArtifact: z.literal('feature_plan'),
    dedicatedViews: z.array(
      z
        .object({
          view: dedicatedDesignViewSchema,
          decision: z.enum(['include', 'omit']),
          reason: z.string(),
        })
        .strict()
    ),
    specificationLenses: z.array(specificationLensSchema),
  })
  .strict();

const jobTypeSelectionSchema = z
  .object({
    jobType: z.enum(jobTypes),
    goal: z.string().min(1),
    planMode: planModeRoutingDecisionSchema.nullish(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.planMode && value.jobType !== 'planning') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'planMode is only allowed when jobType is planning',
        path: ['planMode'],
      });
    }
  })
  .transform((value) => {
    if (value.planMode) {
      return {
        jobType: value.jobType,
        goal: value.goal,
        planMode: value.planMode,
      };
    }
    return {
      jobType: value.jobType,
      goal: value.goal,
    };
  });

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
        required: ['jobType', 'goal', 'planMode'],
        additionalProperties: false,
        properties: {
          jobType: { type: 'string', enum: [...jobTypes] },
          goal: { type: 'string' },
          planMode: {
            anyOf: [
              {
                type: 'object',
                required: ['primaryArtifact', 'dedicatedViews', 'specificationLenses'],
                additionalProperties: false,
                properties: {
                  primaryArtifact: { type: 'string', enum: ['feature_plan'] },
                  dedicatedViews: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['view', 'decision', 'reason'],
                      additionalProperties: false,
                      properties: {
                        view: { type: 'string', enum: dedicatedDesignViewSchema.options },
                        decision: { type: 'string', enum: ['include', 'omit'] },
                        reason: { type: 'string' },
                      },
                    },
                  },
                  specificationLenses: {
                    type: 'array',
                    items: { type: 'string', enum: specificationLensSchema.options },
                  },
                },
              },
              { type: 'null' },
            ],
          },
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
