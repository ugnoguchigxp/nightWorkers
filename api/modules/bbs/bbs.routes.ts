import { createRoute, z } from '@hono/zod-openapi';
import {
  commentSchema,
  createCommentSchema,
  createThreadSchema,
  listThreadsResponseSchema,
  threadResponseSchema,
  threadSchema,
} from '../../../shared/schemas/bbs.schema';
import { AuthError } from '../../lib/errors';
import { createOpenApiRouter } from '../../lib/openapi';
import { authMiddleware } from '../../middleware/auth';
import * as BBSService from './bbs.service';

const listThreadsRoute = createRoute({
  method: 'get',
  path: '/threads',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: listThreadsResponseSchema,
        },
      },
      description: 'List of all threads',
    },
  },
});

const getThreadRoute = createRoute({
  method: 'get',
  path: '/threads/:id',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'thread-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: threadResponseSchema,
        },
      },
      description: 'The thread detail with comments',
    },
    404: {
      description: 'Thread not found',
    },
  },
});

const createThreadRoute = createRoute({
  method: 'post',
  path: '/threads',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createThreadSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: threadSchema,
        },
      },
      description: 'Thread created successfully',
    },
  },
});

const createCommentRoute = createRoute({
  method: 'post',
  path: '/threads/:id/comments',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'thread-uuid' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: createCommentSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: commentSchema,
        },
      },
      description: 'Comment created successfully',
    },
    404: {
      description: 'Thread not found',
    },
  },
});

const publicBbs = createOpenApiRouter()
  .openapi(listThreadsRoute, async (c) => {
    const threads = await BBSService.listThreads();
    return c.json({ threads }, 200);
  })
  .openapi(getThreadRoute, async (c) => {
    const id = c.req.param('id');
    const thread = await BBSService.getThread(id);
    return c.json({ thread }, 200);
  });

const protectedBbsBase = createOpenApiRouter();
protectedBbsBase.use('*', authMiddleware());
const protectedBbs = protectedBbsBase
  .openapi(createThreadRoute, async (c) => {
    const data = c.req.valid('json');
    const user = c.get('user');
    if (!user) {
      throw new AuthError('Unauthorized');
    }
    const thread = await BBSService.createThread(data, user.userId);
    return c.json(thread, 201);
  })
  .openapi(createCommentRoute, async (c) => {
    const id = c.req.param('id');
    const data = c.req.valid('json');
    const user = c.get('user');
    if (!user) {
      throw new AuthError('Unauthorized');
    }
    const comment = await BBSService.createComment(id, data, user.userId);
    return c.json(comment, 201);
  });

export const bbsRouter = createOpenApiRouter().route('/', publicBbs).route('/', protectedBbs);
