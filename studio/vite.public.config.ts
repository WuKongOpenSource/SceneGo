/// <reference types="vitest/config" />
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { runtimeModuleAliases } from '../deploy/new_html/runtimeModuleAliases';
import tsconfig from './tsconfig.public.json';

const workspaceRoot = path.resolve(__dirname, '..');
const publicSource = (filename: string) => path.resolve(workspaceRoot, 'deploy/new_html/public-source', filename);
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
    name: 'ovideo-studio-public-boundary-guard',
    moduleParsed(moduleInfo) {
      const moduleId = moduleInfo.id.replaceAll('\\', '/');
      if (moduleId.includes('/public-source/')) return;
      if (forbiddenPrivateModules.some(suffix => moduleId.endsWith(suffix))) {
        this.error(`公开版 Studio 构建加载了禁止的私有模块：${moduleId}`);
      }
    },
    generateBundle(_outputOptions, bundle) {
      for (const [filename, item] of Object.entries(bundle)) {
        const content = item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : '';
        const forbiddenValue = forbiddenBundleValues.find(value => content.includes(value));
        if (forbiddenValue) this.error(`公开版 Studio 构建产物 ${filename} 包含禁止值：${forbiddenValue}`);
      }
    },
  };
}

export default defineConfig({
  base: '/studio/',
  plugins: [react(), publicBoundaryGuard()],
  define: {
    'process.env.API_KEY': JSON.stringify('DISABLED_CLIENT_KEY'),
    'process.env.GEMINI_API_KEY': JSON.stringify('DISABLED_CLIENT_KEY'),
    __OVIDEO_PUBLIC_SOURCE__: JSON.stringify(true),
  },
  resolve: {
    alias: [
      ...runtimeModuleAliases(__dirname, tsconfig.compilerOptions.paths),
      { find: '@app/services/videoTaskService', replacement: publicSource('videoTaskService.ts') },
      { find: '@app/services/videoMediaService', replacement: publicSource('videoMediaService.ts') },
      { find: '@app/services/audioGenerationService', replacement: publicSource('audioGenerationService.ts') },
      { find: '@app/services/comfyuiGenerationService', replacement: publicSource('comfyuiGenerationService.ts') },
      { find: '@app/services/comfyuiTaskWaitService', replacement: publicSource('comfyuiTaskWaitService.ts') },
      { find: '@app/services/comfyuiTaskQueue', replacement: publicSource('comfyuiTaskQueue.ts') },
      { find: '@app/services/comfyuiBridgeService', replacement: publicSource('comfyuiBridgeService.ts') },
      { find: '@app/services/clusterNodeService', replacement: publicSource('clusterNodeService.ts') },
      { find: '@app/services/processingQueueService', replacement: publicSource('processingQueueService.ts') },
      { find: '@app/components/AdminPage', replacement: publicSource('AdminPage.tsx') },
      { find: '@app/admin/adminAuth', replacement: publicSource('adminAuth.ts') },
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
      { find: '@app', replacement: path.resolve(workspaceRoot, 'deploy/new_html') },
    ],
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
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
});
