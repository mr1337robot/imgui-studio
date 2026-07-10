import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['.tools/**', 'build/**', 'node_modules/**', 'out/**'],
    include: ['tests/**/*.test.ts'],
  },
});
