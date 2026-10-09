import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/core/src/**/*.test.ts', 'apps/api/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'], environment: 'node', maxWorkers: 2 } });
