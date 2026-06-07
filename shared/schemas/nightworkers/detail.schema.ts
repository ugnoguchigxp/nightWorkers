import { z } from '@hono/zod-openapi';
import { taskEventSchema } from './activity-message.schema';
import { reviewResultSchema } from './review.schema';
import { taskRunSchema, taskRunTodoSchema } from './run.schema';

export const taskRunDetailSchema = taskRunSchema.extend({
  todos: z.array(z.lazy(() => taskRunTodoSchema)),
  events: z.array(z.lazy(() => taskEventSchema)),
  reviews: z.array(z.lazy(() => reviewResultSchema)),
});
