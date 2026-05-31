import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'api/lib/**/*.ts',
        'api/middleware/**/*.ts',
        'api/services/oauth/**/*.ts',
        'api/services/token.service.ts',
        'api/services/auth.service.ts',
        'src/lib/utils.ts',
        'shared/schemas/auth.schema.ts',
        'shared/schemas/**/*.ts',
      ],
      exclude: ['**/*.d.ts', 'api/services/oauth/base.ts'],
    },
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@api': path.resolve(__dirname, './api'),
    },
  },
});
