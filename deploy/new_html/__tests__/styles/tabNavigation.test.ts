import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const css = postcss.parse(read('deploy/static/css/tab-navigation.css'));
const declarations = (selector: string) => {
  const result: Record<string, string> = {};
  css.walkRules(selector, rule => { rule.walkDecls(decl => { result[decl.prop] = decl.value; }); });
  return result;
};

describe('shared underline content tabs', () => {
  it('uses the same stylesheet in the app, login and canvas', () => {
    expect(read('deploy/new_html/index.tsx')).toContain("import '../static/css/tab-navigation.css'");
    expect(read('studio/main.tsx')).toContain("import '../deploy/static/css/tab-navigation.css'");
    expect(read('deploy/login.html')).toContain('href="/static/css/tab-navigation.css"');
    expect(read('deploy/login.html')).not.toContain('.auth-tab.active {');
  });

  it('keeps white horizontal tabs readable without wrapping or shrinking their labels', () => {
    expect(declarations('.ui-tabs')).toMatchObject({
      'flex-wrap': 'nowrap', 'min-width': '0', 'max-width': '100%',
      'overflow-x': 'auto', 'overflow-y': 'hidden',
      'border-radius': '0', 'box-shadow': 'none',
      'border-bottom': '1px solid var(--tab-divider)',
      '--tab-height': '48px', '--tab-surface': 'var(--n0, #FFFFFF)',
    });
    expect(declarations('.ui-tabs .ui-tab')).toMatchObject({
      border: '0', 'border-radius': '0', background: 'transparent',
      'box-shadow': 'none', flex: '0 0 auto', 'white-space': 'nowrap',
    });
    expect(declarations('.ui-tabs .ui-tab::after')).toMatchObject({
      height: '2px', inset: 'auto 8px 0', 'pointer-events': 'none',
    });
  });

  it('separates selected state, keyboard focus and pointer press without rounded rings', () => {
    const active = '.ui-tabs .ui-tab:is([aria-selected="true"], [aria-pressed="true"], [aria-checked="true"], .active)';
    expect(declarations(active)).toMatchObject({ color: 'var(--tab-accent)' });
    // Hover has lower specificity so the selected tab stays purple under the pointer.
    expect(declarations('.ui-tabs .ui-tab:where(:hover:not(:disabled))')).toMatchObject({ color: 'var(--tab-hover)' });
    expect(declarations(`${active}::after`)).toMatchObject({ background: 'var(--tab-accent)' });
    expect(declarations('.ui-tabs .ui-tab:focus-visible')).toMatchObject({
      outline: 'none', 'text-decoration': 'underline dotted var(--tab-accent)',
    });
    expect(declarations('.ui-tabs .ui-tab:active:not(:disabled)')).toMatchObject({ transform: 'none' });
    expect(declarations('.ui-tabs .ui-tab:disabled')).toMatchObject({ cursor: 'not-allowed' });
  });

  // Parse source so shared tabs cannot silently grow another local pill style.
  // Public candidates omit private admin surfaces; verify every included consumer.
  const files = [
    'pages/FinalProductPage.tsx', 'pages/ImageUpscalePage.tsx', 'pages/AudioStagePage.tsx',
    'pages/DesignPage.tsx', 'pages/EpisodeHubPage.tsx', 'pages/MediaLibraryPage.tsx',
    'components/ProjectHub.tsx', 'components/ProjectMaterialPicker.tsx',
    'components/ScriptWorkspaceModeSwitch.tsx', 'components/SeedanceAssetPickerModal.tsx',
    'components/PostProcessPage.tsx', 'components/GenerationPage.tsx',
    'components/StoryboardColumn.tsx', 'components/StoryboardToolModal.tsx',
    'components/audio/MusicAssetSidebar.tsx', 'components/audio/MusicModal.tsx', 'components/AdminFeatureTabs.tsx',
    'components/AdminPage.tsx', 'admin/AdminSettingsPage.tsx', 'public-source/AdminPage.tsx',
  ].map(file => `deploy/new_html/${file}`).concat([
    'studio/components/SidebarDock.tsx', 'studio/components/SketchEditor.tsx',
  ]).filter(file => fs.existsSync(path.join(root, file)));

  it.each(files)('%s opts its content tabs into the shared style and explicit active state', file => {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let count = 0;
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'button') {
        const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
        const className = attrs.find(attr => attr.name.getText(source) === 'className')?.initializer;
        if (className && ts.isStringLiteral(className) && className.text.split(/\s+/).includes('ui-tab')) {
          count++;
          expect(className.text).toBe('ui-tab');
          expect(attrs.some(attr => ['aria-selected', 'aria-pressed', 'aria-checked'].includes(attr.name.getText(source)))).toBe(true);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(count).toBeGreaterThan(0);
    expect(read(file)).toMatch(/className="ui-tabs(?:[\s"])/);
  });
});
