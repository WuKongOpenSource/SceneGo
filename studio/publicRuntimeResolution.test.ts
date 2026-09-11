import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { runtimeModuleAliases } from '../deploy/new_html/runtimeModuleAliases';
import config from './vite.public.config';
import testConfig from './vitest.public.config';

const root = __dirname;
const loaded = ts.readConfigFile(path.join(root, 'tsconfig.public.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root);
const aliases = runtimeModuleAliases(root, parsed.options.paths!);

it('loads all public runtime mappings without TypeScript config errors', () => {
  expect(loaded.error).toBeUndefined();
  expect(parsed.errors).toEqual([]);
  expect(aliases).toHaveLength(12);
});

it.each(aliases)('uses the same $find public implementation for Studio types, tests and builds', (alias) => {
  const resolved = ts.resolveModuleName(alias.find, path.join(root, 'platform/ostoryRuntime.ts'), parsed.options, ts.sys);
  expect(resolved.resolvedModule?.resolvedFileName.toLowerCase()).toBe(alias.replacement.replaceAll('\\', '/').toLowerCase());
  expect(alias.replacement).toContain('public-source');
  for (const current of [config, testConfig]) expect(current.resolve?.alias).toContainEqual(alias);
});
