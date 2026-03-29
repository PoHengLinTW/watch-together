import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@watchtogether/shared': path.resolve(__dirname, '../shared/protocol.ts'),
    },
  },
  test: {
    globals: true,
    include: ['__tests__/**/*.test.ts'],
    passWithNoTests: true,
  },
});
