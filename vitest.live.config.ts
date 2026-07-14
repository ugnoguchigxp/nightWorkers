import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      AUTH_MODE: 'local',
      API_AUTH_REQUIRED: 'false',
      JWT_SECRET: 'nightworkers-live-test-jwt-secret-000000000000',
      NIGHTWORKERS_DESKTOP: '0',
    },
    fileParallelism: false,
    include: ['tests/live/**/*.{test,spec}.{ts,tsx}'],
  },
});
