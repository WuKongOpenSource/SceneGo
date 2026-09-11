import { defineConfig, mergeConfig } from 'vitest/config';
import publicConfig from './vite.public.config';

export default mergeConfig(publicConfig, defineConfig({
  root: __dirname,
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['__tests__/**/*.test.{ts,tsx}'],
    exclude: ['__tests__/private-runtime/**'],
    css: false,
  },
}));
