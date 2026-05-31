import { describe, expect, it } from 'vitest';
import {
  createCommentSchema,
  createThreadSchema,
  listThreadsResponseSchema,
  threadResponseSchema,
} from '../shared/schemas/bbs.schema';

describe('bbs shared schemas', () => {
  it('sanitizes createThread input', () => {
    const parsed = createThreadSchema.parse({
      title: '<i>hello</i>',
      content: '<script>alert(1)</script>world',
    });
    expect(parsed.title).toBe('<i>hello</i>');
    expect(parsed.content).toBe('world');
  });

  it('validates comment parentId as uuid', () => {
    expect(() =>
      createCommentSchema.parse({
        content: 'ok',
        parentId: 'invalid',
      })
    ).toThrow();

    const parsed = createCommentSchema.parse({
      content: '<b>ok</b>',
      parentId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(parsed.content).toBe('<b>ok</b>');
  });

  it('validates response wrappers', () => {
    const thread = {
      id: 'thread-1',
      title: 'Title',
      content: 'Body',
      authorId: 'author-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: [],
    };

    expect(listThreadsResponseSchema.parse({ threads: [thread] }).threads).toHaveLength(1);
    expect(threadResponseSchema.parse({ thread }).thread.id).toBe('thread-1');
  });
});
