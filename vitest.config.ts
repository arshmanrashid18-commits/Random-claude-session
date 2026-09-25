import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.soak.test.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 240_000,
    pool: 'forks',
  },
});
