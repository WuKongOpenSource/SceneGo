/// <reference types="vitest/config" />
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { runtimeModuleAliases } from '../deploy/new_html/runtimeModuleAliases';
import tsconfig from './tsconfig.json';

const workspaceRoot = path.resolve(__dirname, '..');

export default defineConfig({
  base: '/studio/',
  plugins: [react()],
  resolve: {
    alias: [
      ...runtimeModuleAliases(__dirname, tsconfig.compilerOptions.paths),
      { find: '@app', replacement: path.resolve(__dirname, '../deploy/new_html') },
    ],
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  server: {
    port: 3001,
    host: '0.0.0.0',
    fs: {
      allow: [workspaceRoot],
    },
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/login': { target: 'http://localhost:8000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8000', changeOrigin: true },
      '/storage': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          query: ['@tanstack/react-query'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});
