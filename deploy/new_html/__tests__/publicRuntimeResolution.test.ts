// @vitest-environment node
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { runtimeModuleAliases } from '../runtimeModuleAliases';
import config from '../vite.public.config';
import testConfig from '../vitest.public.config';

const root = path.resolve(__dirname, '..');
const loaded = ts.readConfigFile(path.join(root, 'tsconfig.public.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root);
const aliases = runtimeModuleAliases(root, parsed.options.paths!);
const normalize = (value: string) => path.resolve(value).toLowerCase();

describe('public runtime resolution', () => {
  it('loads the public TypeScript configuration without config errors', () => {
    expect(loaded.error).toBeUndefined();
    expect(parsed.errors).toEqual([]);
    expect(aliases).toHaveLength(12);
  });

  it.each(aliases)('resolves $find to the same public file for types, tests and builds', (alias) => {
    const resolved = ts.resolveModuleName(alias.find, path.join(root, 'App.tsx'), parsed.options, ts.sys);
    expect(resolved.resolvedModule).toBeDefined();
    expect(normalize(resolved.resolvedModule!.resolvedFileName)).toBe(normalize(alias.replacement));
    expect(normalize(alias.replacement)).toContain(normalize(path.join(root, 'public-source')) + path.sep);
    for (const current of [config, testConfig]) {
      expect(current.resolve?.alias).toContainEqual(alias);
    }
  });

  it('rejects ambiguous or wildcard runtime mappings', () => {
    expect(() => runtimeModuleAliases(root, { '@runtime/a': ['a.ts', 'b.ts'] })).toThrow();
    expect(() => runtimeModuleAliases(root, { '@runtime/*': ['*.ts'] })).toThrow();
    expect(() => runtimeModuleAliases(root, { '@runtime/a': [] })).toThrow();
    expect(runtimeModuleAliases(root, { '@/*': ['./*'] })).toEqual([]);
  });
});
