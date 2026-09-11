import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourcePath = resolve(__dirname, '../../contexts/EpisodeContext.tsx');
const source = readFileSync(sourcePath, 'utf-8');

describe('EpisodeContext workflow script behavior', () => {
  it('loads the persisted workflow script for the episode', () => {
    expect(source).toContain('getWorkflowScript(episodeId)');
    expect(source).toContain('selectWorkflowScript(episodeId, id)');
  });

  it('reloads script scoped slices on first script selection', () => {
    expect(source).toContain('const previousScriptId = prevScriptIdRef.current');
    expect(source).toContain('if (previousScriptId === selectedScriptId) return');
    expect(source).toContain("if (loadedSlicesRef.current.has('script')) slicesToReload.push('script')");
  });

  it('loads and saves the currently selected script instead of the primary script', () => {
    expect(source).toContain('await listEpisodeScripts(episodeId)');
    expect(source).toContain('(item.script_id ?? item.scriptId) === sid');
    expect(source).toContain('await updateEpisodeScriptById(episodeId, sid, data)');
  });

  it('reloads loaded script scoped slices after workflow script selection changes', () => {
    expect(source).toContain('void fetchSlices({ quiet: true }, ...slicesToReload)');
  });

  it('keeps episode assets cumulative while storyboard input remains script scoped', () => {
    expect(source).toContain('scriptId: r.script_id ?? r.scriptId ?? null');
    expect(source).toContain('getAssets(projectId, queryEpisodeId)');
    expect(source).toContain('getStoryboardItems(episodeId, sid');
  });
});
