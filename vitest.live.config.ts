import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      NIGHTWORKERS_DESKTOP: '0',
    },
    fileParallelism: false,
    include: ['tests/live/**/*.{test,spec}.{ts,tsx}'],
  },
});
