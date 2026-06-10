import { describe, expect, it } from 'vitest';
import {
  getSessionQueueMaxConcurrencyFromEnv,
  isAutoQueueDrainEnabled,
  readNightWorkersRuntimeEnv,
  shouldWaitForWorkbenchIntakeInTests,
} from '../api/services/runtime-env';

describe('runtime-env', () => {
  describe('readNightWorkersRuntimeEnv', () => {
    it('extracts specific variables from env input', () => {
      const mockEnv = {
        ACTIVE_LLM_PROVIDER: 'openai',
        CODEX_ENABLED: 'true',
        NIGHTWORKERS_RUNTIME_LANE: 'codex-agent',
        NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN: 'true',
        NODE_ENV: 'test',
        SESSION_QUEUE_MAX_CONCURRENCY: '4',
        OTHER_VAR: 'unused',
      };

      const result = readNightWorkersRuntimeEnv(mockEnv as any);
      expect(result).toEqual({
        ACTIVE_LLM_PROVIDER: 'openai',
        CODEX_ENABLED: 'true',
        NIGHTWORKERS_RUNTIME_LANE: 'codex-agent',
        NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN: 'true',
        NODE_ENV: 'test',
        SESSION_QUEUE_MAX_CONCURRENCY: '4',
      });
    });

    it('defaults to process.env if no arguments passed', () => {
      const result = readNightWorkersRuntimeEnv();
      expect(result).toBeDefined();
      expect(result.NODE_ENV).toBe('test'); // standard vitest env
    });
  });

  describe('isAutoQueueDrainEnabled', () => {
    it('returns true when NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN is not true', () => {
      expect(isAutoQueueDrainEnabled({ NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN: 'false' })).toBe(
        true
      );
      expect(isAutoQueueDrainEnabled({ NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN: undefined })).toBe(
        true
      );
    });

    it('returns false when NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN is true', () => {
      expect(isAutoQueueDrainEnabled({ NIGHTWORKERS_DISABLE_AUTO_QUEUE_DRAIN: 'true' })).toBe(
        false
      );
    });
  });

  describe('shouldWaitForWorkbenchIntakeInTests', () => {
    it('returns true in test environment', () => {
      expect(shouldWaitForWorkbenchIntakeInTests({ NODE_ENV: 'test' })).toBe(true);
    });

    it('returns false in production environment', () => {
      expect(shouldWaitForWorkbenchIntakeInTests({ NODE_ENV: 'production' })).toBe(false);
    });
  });

  describe('getSessionQueueMaxConcurrencyFromEnv', () => {
    it('returns parsed integer value', () => {
      expect(getSessionQueueMaxConcurrencyFromEnv({ SESSION_QUEUE_MAX_CONCURRENCY: '3' })).toBe(3);
    });

    it('returns default of 2 if value is not defined', () => {
      expect(
        getSessionQueueMaxConcurrencyFromEnv({ SESSION_QUEUE_MAX_CONCURRENCY: undefined })
      ).toBe(2);
    });

    it('returns default of 2 if value is invalid NaN or non-finite', () => {
      expect(
        getSessionQueueMaxConcurrencyFromEnv({ SESSION_QUEUE_MAX_CONCURRENCY: 'not-a-number' })
      ).toBe(2);
      expect(
        getSessionQueueMaxConcurrencyFromEnv({ SESSION_QUEUE_MAX_CONCURRENCY: 'Infinity' })
      ).toBe(2);
    });

    it('returns at least 1 even if input parsed is less than 1', () => {
      expect(getSessionQueueMaxConcurrencyFromEnv({ SESSION_QUEUE_MAX_CONCURRENCY: '0' })).toBe(1);
      expect(getSessionQueueMaxConcurrencyFromEnv({ SESSION_QUEUE_MAX_CONCURRENCY: '-5' })).toBe(1);
    });

    it('floors float values', () => {
      expect(getSessionQueueMaxConcurrencyFromEnv({ SESSION_QUEUE_MAX_CONCURRENCY: '2.7' })).toBe(
        2
      );
    });
  });
});
