import path from 'node:path';

/** Keep bundler and test resolution identical to TypeScript's selected edition. */
export function runtimeModuleAliases(root: string, paths: Record<string, readonly string[]>) {
  return Object.entries(paths)
    .filter(([name]) => name.startsWith('@runtime/'))
    .map(([find, targets]) => {
      if (targets.length !== 1 || find.includes('*')) {
        throw new Error(`Runtime module ${find} must resolve to one explicit file`);
      }
      return { find, replacement: path.resolve(root, targets[0]) };
    });
}
