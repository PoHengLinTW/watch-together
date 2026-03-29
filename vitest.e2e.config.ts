import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@watchtogether/shared': path.resolve(__dirname, 'shared/protocol.ts'),
    },
  },
  test: {
    globals: true,
    include: ['__tests__/e2e/**/*.test.ts'],
    testTimeout: 90000,
    hookTimeout: 120000,
    singleThread: true,
    reporters: ['verbose'],
  },
});
