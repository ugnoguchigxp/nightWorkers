import { createRoute, z } from '@hono/zod-openapi';
import {
  createDesignQuestionnaireRequestSchema,
  designQuestionnaireSessionSchema,
  saveDesignQuestionnaireAnswersSchema,
} from '../../../shared/schemas/design-questionnaire.schema';

export const createDesignQuestionnaireRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: createDesignQuestionnaireRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire session created',
    },
  },
});

export const listDesignQuestionnairesRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/design-questionnaire',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(designQuestionnaireSessionSchema) } },
      description: 'Design Questionnaire sessions',
    },
  },
});

export const getDesignQuestionnaireRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/design-questionnaire/:sessionId',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire session',
    },
  },
});

export const saveDesignQuestionnaireAnswersRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire/:sessionId/answers',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: saveDesignQuestionnaireAnswersSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire answers saved',
    },
  },
});

export const generateDesignQuestionnaireFollowUpRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire/:sessionId/follow-up',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire follow-up generated',
    },
  },
});

export const generateDesignQuestionnaireReviewRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire/:sessionId/review',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.unknown() } },
      description: 'Design Questionnaire review generated',
    },
  },
});

export const acceptDesignQuestionnaireReviewRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire/:sessionId/review/accept',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire review accepted',
    },
  },
});

export const leaveDesignQuestionnaireReviewUnadoptedRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire/:sessionId/review/leave-unadopted',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire review left unadopted',
    },
  },
});
