import { createRoute, z } from '@hono/zod-openapi';
import {
  repositorySchema,
  taskRunSchema,
  taskSchema,
} from '../../../shared/schemas/nightworkers.schema';

const dateLikeSchema = z.union([z.string(), z.date()]);
const jsonValueSchema = z.unknown();
const taskExecutionTypeSchema = z.enum(['normal', 'exclusive', 'sequence']);
const schedulingBlockedReasonSchema = z.enum([
  'none',
  'exclusive_waiting_for_active_tasks',
  'normal_blocked_by_ready_non_normal',
  'normal_blocked_by_active_non_normal',
  'sequence_predecessor_pending',
  'sequence_predecessor_failed',
  'sequence_order_conflict',
  'candidate_window_exhausted',
]);

export const implementationQueueEntrySchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  status: z.string(),
  priority: z.number(),
  queuePosition: z.number().nullable().optional(),
  processorSlot: z.number().nullable().optional(),
  activeRunId: z.string().uuid().nullable().optional(),
  claimedAt: dateLikeSchema.nullable().optional(),
  lastHeartbeatAt: dateLikeSchema.nullable().optional(),
  archivedAt: dateLikeSchema.nullable().optional(),
  statusReason: z.string().nullable().optional(),
  leaseOwnerId: z.string().nullable().optional(),
  leaseAcquiredAt: dateLikeSchema.nullable().optional(),
  leaseExpiresAt: dateLikeSchema.nullable().optional(),
  leaseVersion: z.number().int().optional(),
  attemptCount: z.number().int().optional(),
  recoveredAt: dateLikeSchema.nullable().optional(),
  recoveryReason: z.string().nullable().optional(),
  lastFailureKind: z.string().nullable().optional(),
  executionType: taskExecutionTypeSchema.optional(),
  executionLockKey: z.string().nullable().optional(),
  sequenceGroupId: z.string().nullable().optional(),
  sequenceOrder: z.number().int().nullable().optional(),
  sequenceDependsOnEntryId: z.string().uuid().nullable().optional(),
  schedulingReason: z.string().nullable().optional(),
  createdAt: dateLikeSchema,
  updatedAt: dateLikeSchema,
});

export const implementationQueueDashboardRoute = createRoute({
  method: 'get',
  path: '/implementation-queue',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            settings: z.object({ processorCount: z.number().int() }),
            processors: z.array(
              z.object({
                slot: z.number().int(),
                entry: implementationQueueEntrySchema
                  .extend({ task: taskSchema, repository: repositorySchema })
                  .nullable(),
              })
            ),
            queued: z.array(
              implementationQueueEntrySchema.extend({
                task: taskSchema,
                repository: repositorySchema,
              })
            ),
            completed: z.array(
              implementationQueueEntrySchema.extend({
                task: taskSchema,
                repository: repositorySchema,
              })
            ),
            notQueued: z.array(z.object({ task: taskSchema, repository: repositorySchema })),
          }),
        },
      },
      description: 'Implementation Queue dashboard',
    },
  },
});

export const implementationQueueHealthSchema = z.object({
  generatedAt: dateLikeSchema,
  counts: z.object({
    queued: z.number().int(),
    claimed: z.number().int(),
    processing: z.number().int(),
    stale: z.number().int(),
    retryable: z.number().int(),
    needsHuman: z.number().int(),
    orphaned: z.number().int(),
    pendingCompletion: z.number().int(),
  }),
  items: z.array(
    z.object({
      entryId: z.string().uuid(),
      taskId: z.string().uuid(),
      runId: z.string().uuid().nullable().optional(),
      status: z.string(),
      classification: z.enum([
        'normal',
        'stale_claim',
        'stale_processing',
        'terminal_run_pending_completion',
        'orphaned_active_run',
        'needs_human',
        'failed',
      ]),
      processorSlot: z.number().nullable().optional(),
      leaseOwnerId: z.string().nullable().optional(),
      leaseExpiresAt: dateLikeSchema.nullable().optional(),
      lastHeartbeatAt: dateLikeSchema.nullable().optional(),
      attemptCount: z.number().int(),
      recoveryReason: z.string().nullable().optional(),
      statusReason: z.string().nullable().optional(),
      recommendedAction: z.enum(['none', 'retry', 'complete', 'mark_needs_human', 'archive']),
      scheduling: z
        .object({
          executionType: taskExecutionTypeSchema,
          executionLockKey: z.string(),
          lockState: z.enum([
            'free',
            'active_normal',
            'active_exclusive',
            'draining_for_non_normal',
          ]),
          sequenceGroupId: z.string().nullable(),
          sequenceOrder: z.number().int().nullable(),
          schedulingBlockedReason: schedulingBlockedReasonSchema,
          activeEntryIds: z.array(z.string().uuid()),
          readyNonNormalEntryIds: z.array(z.string().uuid()),
        })
        .optional(),
    })
  ),
});

export const implementationQueueHealthRoute = createRoute({
  method: 'get',
  path: '/implementation-queue/health',
  responses: {
    200: {
      content: { 'application/json': { schema: implementationQueueHealthSchema } },
      description: 'Implementation Queue health',
    },
  },
});

export const createImplementationQueueEntryRoute = createRoute({
  method: 'post',
  path: '/implementation-queue/entries',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ taskId: z.string().uuid() }),
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: implementationQueueEntrySchema } },
      description: 'Implementation Queue Entry created',
    },
  },
});

export const patchImplementationQueueEntryRoute = createRoute({
  method: 'patch',
  path: '/implementation-queue/entries/:id',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            action: z.enum(['cancel', 'resume']).optional(),
            priority: z.number().int().optional(),
            queuePosition: z.number().int().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: implementationQueueEntrySchema } },
      description: 'Implementation Queue Entry updated',
    },
  },
});

export const archiveImplementationQueueEntryRoute = createRoute({
  method: 'post',
  path: '/implementation-queue/entries/:id/archive',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: implementationQueueEntrySchema } },
      description: 'Implementation Queue Entry archived',
    },
  },
});

export const requeueImplementationQueueEntryRoute = createRoute({
  method: 'post',
  path: '/implementation-queue/entries/:id/requeue',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            note: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: implementationQueueEntrySchema } },
      description: 'Implementation Queue Entry requeued with preserved priority',
    },
  },
});

export const recoverImplementationQueueEntryRoute = createRoute({
  method: 'post',
  path: '/implementation-queue/entries/:id/recover',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            action: z.enum(['retry', 'mark_needs_human', 'cancel', 'archive', 'complete']),
            note: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: implementationQueueEntrySchema } },
      description: 'Implementation Queue Entry recovered',
    },
  },
});

export const drainImplementationQueueRoute = createRoute({
  method: 'post',
  path: '/implementation-queue/drain',
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ started: z.number().int() }) } },
      description: 'Implementation Queue drain triggered',
    },
  },
});

export const getImplementationQueueSettingsRoute = createRoute({
  method: 'get',
  path: '/implementation-queue/settings',
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ processorCount: z.number().int() }) } },
      description: 'Implementation Queue settings',
    },
  },
});

export const patchImplementationQueueSettingsRoute = createRoute({
  method: 'patch',
  path: '/implementation-queue/settings',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ processorCount: z.number().int().min(1).max(3) }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ processorCount: z.number().int() }) } },
      description: 'Implementation Queue settings updated',
    },
  },
});

export const todoWorkflowSettingsSchema = z.object({
  id: z.string(),
  requirePerTodoReview: z.boolean(),
  requirePerTodoFix: z.boolean(),
  requireFinalVerification: z.boolean(),
  requireRegisterCandidatePrompt: z.boolean(),
  askCommitOnCompletion: z.boolean(),
  hookPolicyJson: jsonValueSchema.nullable().optional(),
  createdAt: dateLikeSchema,
  updatedAt: dateLikeSchema,
});

export const todoWorkflowSettingsInputSchema = z.object({
  requirePerTodoReview: z.boolean().optional(),
  requirePerTodoFix: z.boolean().optional(),
  requireFinalVerification: z.boolean().optional(),
  requireRegisterCandidatePrompt: z.boolean().optional(),
  askCommitOnCompletion: z.boolean().optional(),
  hookPolicyJson: jsonValueSchema.optional(),
});

export const getTodoWorkflowSettingsRoute = createRoute({
  method: 'get',
  path: '/todo-workflow/settings',
  responses: {
    200: {
      content: { 'application/json': { schema: todoWorkflowSettingsSchema } },
      description: 'Todo Workflow settings',
    },
  },
});

export const patchTodoWorkflowSettingsRoute = createRoute({
  method: 'patch',
  path: '/todo-workflow/settings',
  request: {
    body: {
      content: { 'application/json': { schema: todoWorkflowSettingsInputSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: todoWorkflowSettingsSchema } },
      description: 'Todo Workflow settings updated',
    },
  },
});

export const queueWorkbenchSessionRoute = createRoute({
  method: 'post',
  path: '/workbench/sessions/:id/queue',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: taskSchema } },
      description: 'Workbench session queued',
    },
    404: { description: 'Task not found' },
  },
});

export const runWorkbenchSessionRoute = createRoute({
  method: 'post',
  path: '/workbench/sessions/:id/run',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    201: {
      content: { 'application/json': { schema: taskRunSchema } },
      description: 'Workbench session run started',
    },
    404: { description: 'Task not found' },
  },
});

export const archiveWorkbenchSessionRoute = createRoute({
  method: 'patch',
  path: '/workbench/sessions/:id/archive',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: taskSchema } },
      description: 'Workbench session archived',
    },
    404: { description: 'Task not found' },
  },
});
