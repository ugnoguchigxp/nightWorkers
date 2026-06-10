import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['./tests/global-cleanup-after-tests.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'api/**/*.ts',
        'shared/**/*.ts',
        'src/modules/nightworkers/workbenchSelectors.ts',
        'src/lib/utils.ts',
      ],
      exclude: [
        '**/*.d.ts',
        'api/services/oauth/base.ts',
        'api/index.ts',
        'api/server.ts',
        'api/mcp/**',
        'api/services/runner/**',
        'api/scripts/**',
        'api/db/seed.ts',
        'api/db/migrations/**',
        'src/routeTree.gen.ts',
        'src/mocks/**',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'tests/**',
        'scripts/**',
        'dist/**',
        'dist-api/**',
        'dist-api-desktop/**',
        'node_modules/**',
      ],
    },
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@api': path.resolve(__dirname, './api'),
    },
  },
});
