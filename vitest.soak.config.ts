import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.soak.test.ts'],
    environment: 'node',
    testTimeout: 7_200_000,
    hookTimeout: 600_000,
    pool: 'forks',
  },
});
