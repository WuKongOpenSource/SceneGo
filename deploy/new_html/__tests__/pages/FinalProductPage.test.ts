import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../pages/FinalProductPage.tsx'), 'utf-8')
  .replace(/\r\n/g, '\n');

describe('FinalProductPage', () => {
  it('renders only final composed films and keeps generated segments out of the gallery', () => {
    expect(source).toContain("source: 'composed_final'");
    expect(source).toContain('const finals = videos\n    .map(item => ({');
    expect(source).toContain("file_url: secureApiUrl(String(item?.file_url || ''), { absolute: true })");
    expect(source).toContain('.filter(item => Boolean(item.file_url));');
    expect(source).toContain('const additionalFinals = finals.slice(1);');
    expect(source).toContain(') : !finals.length ? (');
    expect(source).toContain('{additionalFinals.map((v, index) => (');
    expect(source).not.toContain('const others = videos.filter');
    expect(source).not.toContain('concat(others)');
    expect(source).not.toContain('{rest.map(v => (');
  });
});
