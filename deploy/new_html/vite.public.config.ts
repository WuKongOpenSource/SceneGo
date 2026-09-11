/// <reference types="vitest/config" />
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { runtimeModuleAliases } from './runtimeModuleAliases';
import tsconfig from './tsconfig.public.json';

const publicSource = (filename: string) => path.resolve(__dirname, 'public-source', filename);
const publicEntry = path.resolve(__dirname, 'public-entry');
const relativeModule = (moduleName: string, optionalDirectory?: string) => new RegExp(
  `^(?:\\.\\.?/)+(?:${optionalDirectory ? `${optionalDirectory}/` : ''})?${moduleName}$`,
);

const forbiddenPrivateModules = [
  '/services/videoTaskService.ts',
  '/services/videoMediaService.ts',
  '/services/audioGenerationService.ts',
  '/services/comfyuiGenerationService.ts',
  '/services/comfyuiTaskWaitService.ts',
  '/services/comfyuiTaskQueue.ts',
  '/services/comfyuiBridgeService.ts',
  '/services/clusterNodeService.ts',
  '/services/processingQueueService.ts',
  '/components/GpuNodeSelector.tsx',
  '/components/AdminPage.tsx',
  '/admin/adminAuth.ts',
];

const forbiddenBundleValues = [
  '/api/' + 'comfyui/',
  '/api/' + 'agents/',
  'node-output-' + 'deletions',
  '127.0.0.1:' + '8188',
  'tv.' + 'ostory.ai',
  'www.' + 'ostory.ai',
];

function publicBoundaryGuard(): Plugin {
  return {
    name: 'ovideo-public-boundary-guard',
    moduleParsed(moduleInfo) {
      const moduleId = moduleInfo.id.replaceAll('\\', '/');
      if (moduleId.includes('/public-source/')) return;
      if (forbiddenPrivateModules.some(suffix => moduleId.endsWith(suffix))) {
        this.error(`公开版构建加载了禁止的私有模块：${moduleId}`);
      }
    },
    generateBundle(_outputOptions, bundle) {
      for (const [filename, item] of Object.entries(bundle)) {
        const content = item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : '';
        const forbiddenValue = forbiddenBundleValues.find(value => content.includes(value));
        if (forbiddenValue) {
          this.error(`公开版构建产物 ${filename} 包含禁止值：${forbiddenValue}`);
        }
      }
    },
  };
}

export default defineConfig({
  root: publicEntry,
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [react(), publicBoundaryGuard()],
  define: {
    'process.env.API_KEY': JSON.stringify('DISABLED_CLIENT_KEY'),
    'process.env.GEMINI_API_KEY': JSON.stringify('DISABLED_CLIENT_KEY'),
    __OVIDEO_PUBLIC_SOURCE__: JSON.stringify(true),
  },
  resolve: {
    alias: [
      ...runtimeModuleAliases(__dirname, tsconfig.compilerOptions.paths),
      { find: '@', replacement: path.resolve(__dirname, '.') },
      { find: relativeModule('videoTaskService', 'services'), replacement: publicSource('videoTaskService.ts') },
      { find: relativeModule('videoMediaService', 'services'), replacement: publicSource('videoMediaService.ts') },
      { find: relativeModule('audioGenerationService', 'services'), replacement: publicSource('audioGenerationService.ts') },
      { find: relativeModule('comfyuiGenerationService', 'services'), replacement: publicSource('comfyuiGenerationService.ts') },
      { find: relativeModule('comfyuiTaskWaitService', 'services'), replacement: publicSource('comfyuiTaskWaitService.ts') },
      { find: relativeModule('comfyuiTaskQueue', 'services'), replacement: publicSource('comfyuiTaskQueue.ts') },
      { find: relativeModule('comfyuiBridgeService', 'services'), replacement: publicSource('comfyuiBridgeService.ts') },
      { find: relativeModule('clusterNodeService', 'services'), replacement: publicSource('clusterNodeService.ts') },
      { find: relativeModule('processingQueueService', 'services'), replacement: publicSource('processingQueueService.ts') },
      { find: relativeModule('GpuNodeSelector', 'components'), replacement: publicSource('GpuNodeSelector.tsx') },
      { find: relativeModule('AdminPage', 'components'), replacement: publicSource('AdminPage.tsx') },
      { find: relativeModule('adminAuth', 'admin'), replacement: publicSource('adminAuth.ts') },
      { find: relativeModule('adminAuth'), replacement: publicSource('adminAuth.ts') },
    ],
  },
  base: '/',
  build: {
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          'router-vendor': ['react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
          'three-vendor': ['three'],
          'icons-vendor': ['lucide-react'],
          'id-vendor': ['uuid'],
        },
      },
    },
  },
});
