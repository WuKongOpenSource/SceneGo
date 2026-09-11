import { defineConfig, mergeConfig } from 'vitest/config';
import publicConfig from './vite.public.config';

export default mergeConfig(publicConfig, defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
}));
