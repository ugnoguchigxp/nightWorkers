import { describe, expect, it } from 'vitest';
import {
  compactModelVisibleText,
  summarizeModelVisibleJson,
} from '../api/services/agent-runtime/model-visible-payload';

describe('model-visible payload helpers', () => {
  it('returns short text unchanged while reporting metadata', () => {
    const result = compactModelVisibleText({
      content: 'small evidence',
      limitChars: 100,
      omittedReason: 'test_short_payload',
    });

    expect(result.content).toBe('small evidence');
    expect(result.summary).toMatchObject({
      truncated: false,
      strategy: 'none',
      originalChars: 14,
      returnedChars: 14,
      omittedReason: 'test_short_payload',
    });
    expect(result.summary.contentHash).toMatch(/^sha256:/);
  });

  it('compacts long text deterministically while preserving important lines and refs', () => {
    const content = [
      'start',
      ...Array.from({ length: 80 }, (_, index) => `noise line ${index}`),
      'AssertionError: expected 1 to equal 2',
      'received: 2',
      ...Array.from({ length: 80 }, (_, index) => `tail line ${index}`),
    ].join('\n');

    const first = compactModelVisibleText({
      content,
      limitChars: 900,
      omittedReason: 'large_test_output',
      artifactRef: '/tmp/full-output.json',
    });
    const second = compactModelVisibleText({
      content,
      limitChars: 900,
      omittedReason: 'large_test_output',
      artifactRef: '/tmp/full-output.json',
    });

    expect(first).toEqual(second);
    expect(first.content).toContain('[model-visible-payload-compressed]');
    expect(first.content).toContain('omittedReason: large_test_output');
    expect(first.content).toContain('artifactRef: /tmp/full-output.json');
    expect(first.content).toContain('AssertionError: expected 1 to equal 2');
    expect(first.content.length).toBeLessThanOrEqual(900);
    expect(first.summary).toMatchObject({
      truncated: true,
      strategy: 'text_head_tail',
      originalChars: content.length,
      returnedChars: first.content.length,
      omittedReason: 'large_test_output',
      artifactRef: '/tmp/full-output.json',
    });
    expect(first.summary.contentHash).toMatch(/^sha256:/);
  });

  it('summarizes oversized JSON with provider event metadata', () => {
    const value = {
      type: 'provider_event',
      output: Array.from({ length: 200 }, (_, index) => ({
        index,
        message: index === 150 ? 'fatal provider assertion failure' : 'verbose payload',
      })),
    };

    const result = summarizeModelVisibleJson({
      value,
      limitChars: 1000,
      omittedReason: 'large_provider_event',
      providerEventRef: 'event:abc',
    });

    expect(result.content).toContain('[model-visible-payload-compressed]');
    expect(result.content).toContain('providerEventRef: event:abc');
    expect(result.content).toContain('fatal provider assertion failure');
    expect(result.summary).toMatchObject({
      truncated: true,
      strategy: 'json_summary',
      omittedReason: 'large_provider_event',
      providerEventRef: 'event:abc',
    });
  });
});
