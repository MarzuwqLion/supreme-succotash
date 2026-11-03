import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/bots/*.run.ts'], environment: 'node' } });
