import { z } from '@hono/zod-openapi';
import sanitizeHtml from 'sanitize-html';

const sanitize = (val: string) =>
  sanitizeHtml(val, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });

export const loginSchema = z
  .object({
    email: z.string().email().openapi({ example: 'user@example.com' }),
    password: z.string().min(1).openapi({ example: 'password123' }),
  })
  .openapi('LoginInput');

export const registerSchema = z
  .object({
    email: z.string().email().openapi({ example: 'user@example.com' }),
    password: z.string().min(8).openapi({ example: 'password123' }),
    name: z.string().min(1).transform(sanitize).openapi({ example: 'John Doe' }),
  })
  .openapi('RegisterInput');

export const authResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
  }),
});

// Infer types
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
