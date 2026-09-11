import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MaterialPage } from '../../components/MaterialPage';
import { FileStatus, type MaterialLibrary, type ProjectFile, type StoryboardItem } from '../../types';

const library: MaterialLibrary = Object.fromEntries(['角色', '场景', '道具'].map((name, index) => [name, [{
  id: `ref-${index}`, url: `/images/${index}.png`, thumbnail: `/images/${index}.png`,
  type: 'image', source: 'asset', timestamp: 0,
}]]));
const selections = { 角色: 'ref-0', 场景: 'ref-1', 道具: 'ref-2' };
const shot: StoryboardItem = { id: 'shot-1', originalText: '', scriptSegment: '分镜内容', characters: ['角色'], scene: '场景', props: ['道具'] };

function pageProps(items: StoryboardItem[], materials = library): React.ComponentProps<typeof MaterialPage> {
  const file: ProjectFile = {
    id: 'script-1', name: '剧本', originalContent: '', scriptContent: '', storyboard: { items },
    extractedCharacters: [], extractedScenes: [], status: FileStatus.Completed, lastUpdated: 0, versions: [],
  };
  return {
    files: [file], selectedFileId: file.id, materialLibrary: materials,
    onUpdateLibrary: vi.fn(), onBindMaterial: vi.fn(), onUnbindMaterial: vi.fn(),
    onNextStep: vi.fn(), onSaveVersion: vi.fn(), onRestoreVersion: vi.fn(), onDeleteVersion: vi.fn(),
    hideVersionArchive: true,
  };
}

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

describe('MaterialPage binding status', () => {
  it('uses script shot numbers and prevents duplicate exports while busy', () => {
    const props = pageProps([
      { ...shot, scriptSegmentId: 'segment-1', sourceVideoShotNo: '分镜1-1' },
      { ...shot, id: 'shot-2', scriptSegmentId: 'segment-2', sourceVideoShotNo: '分镜2-1' },
      { ...shot, id: 'shot-3', scriptSegmentId: 'segment-2', sourceVideoShotNo: '分镜2-2' },
    ]);
    const view = render(<MaterialPage {...props} />);
    const rows = screen.getAllByTestId('material-shot-card');
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('镜头1-1'), expect.stringContaining('镜头2-1'), expect.stringContaining('镜头2-2'),
    ]);
    fireEvent.click(rows[2]);
    expect(screen.getAllByText('镜头2-2')).toHaveLength(2);
    view.rerender(<MaterialPage {...props} nextStepBusy />);
    const button = screen.getByRole('button', { name: '正在导出…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(props.onNextStep).not.toHaveBeenCalled();
  });
  it('shows partial binding and names the missing prop beside the locked character and scene', () => {
    const props = pageProps([{ ...shot, materialSelections: { 角色: 'ref-0', 场景: 'ref-1' } }]);
    render(<MaterialPage {...props} />);
    const badge = screen.getByTestId('material-binding-status');
    expect(badge).toHaveTextContent('部分绑定2/3');
    expect(badge).toHaveAttribute('title', '已绑定 2/3；待绑定或素材不可用：道具');
    expect(screen.getByTestId('material-binding-summary')).toHaveTextContent('待绑定或素材不可用：道具');
    expect(screen.getByLabelText('角色已绑定')).toBeInTheDocument();
    expect(screen.getByLabelText('场景已绑定')).toBeInTheDocument();
    expect(screen.queryByLabelText('道具已绑定')).not.toBeInTheDocument();
    expect(props.onBindMaterial).not.toHaveBeenCalled();
    expect(props.onUpdateLibrary).not.toHaveBeenCalled();
  });

  it('updates immediately when binding, unbinding, and removing the selected material', () => {
    const props = pageProps([shot]);
    const view = render(<MaterialPage {...props} />);
    expect(screen.getByTestId('material-binding-status')).toHaveTextContent('待绑定0/3');
    view.rerender(<MaterialPage {...pageProps([{ ...shot, materialSelections: selections }])} />);
    expect(screen.getByTestId('material-binding-status')).toHaveTextContent('已绑定3/3');
    expect(screen.getByTestId('material-binding-summary')).toHaveTextContent('参考素材已全部绑定');
    view.rerender(<MaterialPage {...pageProps([{ ...shot, materialSelections: { 角色: 'ref-0', 场景: 'ref-1' } }])} />);
    expect(screen.getByTestId('material-binding-status')).toHaveTextContent('部分绑定2/3');
    view.rerender(<MaterialPage {...pageProps([{ ...shot, materialSelections: selections }], { ...library, 角色: [] })} />);
    expect(screen.getByTestId('material-binding-status')).toHaveTextContent('部分绑定2/3');
    expect(screen.getByTestId('material-binding-summary')).toHaveTextContent('待绑定或素材不可用：角色');
    expect(screen.queryByLabelText('角色已绑定')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('material-shot-card')).getByText('角色')).toHaveClass('text-n100');
    view.rerender(<MaterialPage {...pageProps([{ ...shot, materialSelections: selections }])} />);
    expect(screen.getByTestId('material-binding-status')).toHaveTextContent('已绑定3/3');
  });

  it('keeps each shot status separate and does not treat a generated image as material binding', () => {
    render(<MaterialPage {...pageProps([
      { ...shot, materialSelections: selections },
      { ...shot, id: 'shot-2', generatedImages: [{ id: 'output', url: '/output.png', timestamp: 0 }] },
      { id: 'shot-3', originalText: '', scriptSegment: '' },
    ])} />);
    const rows = screen.getAllByTestId('material-shot-card');
    expect(within(rows[0]).getByTestId('material-binding-status')).toHaveTextContent('已绑定3/3');
    expect(within(rows[1]).getByTestId('material-binding-status')).toHaveTextContent('待绑定0/3');
    expect(within(rows[2]).getByTestId('material-binding-status')).toHaveTextContent('无需绑定');
    fireEvent.click(rows[1]);
    expect(screen.getByTestId('material-binding-summary')).toHaveTextContent('已绑定 0/3');
    expect(screen.queryByLabelText('角色已绑定')).not.toBeInTheDocument();
    fireEvent.click(rows[2]);
    expect(screen.getByTestId('material-binding-summary')).toHaveTextContent('当前镜头没有需要绑定的角色、场景或道具');
  });

  it('excludes unillustrated props from the badge and clearly marks their image binding as optional', () => {
    const props = pageProps([{ ...shot, materialSelections: { 角色: 'ref-0', 场景: 'ref-1' } }], { ...library, 道具: [] });
    render(<MaterialPage {...props} />);
    expect(screen.getByTestId('material-binding-status')).toHaveTextContent('已绑定2/2');
    expect(screen.getByTestId('material-binding-summary')).toHaveTextContent('无图道具不计入绑定：道具');
    const propCards = within(screen.getByTestId('material-prop-cards'));
    expect(propCards.getByText('无需绑图')).toBeInTheDocument();
    expect(propCards.getByText('暂无道具图片，可仅用文字描述，不计入绑定进度。')).toBeInTheDocument();
    expect(propCards.queryByText('未绑定')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('material-shot-card')).getByText('道具')).toHaveAttribute('title', '道具：暂无图片，可仅用文字描述，不计入绑定');
    fireEvent.click(screen.getByRole('button', { name: '导出到声音和画面' }));
    expect(props.onNextStep).toHaveBeenCalledOnce();
    expect(props.onBindMaterial).not.toHaveBeenCalled();
    expect(props.onUnbindMaterial).not.toHaveBeenCalled();
    expect(props.onUpdateLibrary).not.toHaveBeenCalled();
  });

  it('recalculates when prop images are added, bound, and deleted without mutating bindings', () => {
    const item = { ...shot, materialSelections: { 角色: 'ref-0', 场景: 'ref-1' } };
    const emptyProps = pageProps([item], { ...library, 道具: [] });
    const view = render(<MaterialPage {...emptyProps} />);
    expect(screen.getByTestId('material-binding-status')).toHaveTextContent('已绑定2/2');
    view.rerender(<MaterialPage {...pageProps([item])} />);
    expect(screen.getByTestId('material-binding-status')).toHaveTextContent('部分绑定2/3');
    expect(within(screen.getByTestId('material-prop-cards')).getByText('未绑定')).toBeInTheDocument();
    view.rerender(<MaterialPage {...pageProps([{ ...item, materialSelections: selections }])} />);
    expect(screen.getByTestId('material-binding-status')).toHaveTextContent('已绑定3/3');
    view.rerender(<MaterialPage {...pageProps([{ ...item, materialSelections: selections }], { ...library, 道具: [] })} />);
    expect(screen.getByTestId('material-binding-status')).toHaveTextContent('已绑定2/2');
    expect(screen.queryByLabelText('道具已绑定')).not.toBeInTheDocument();
  });

  it('shows no binding required when a shot only contains props without pictures', () => {
    render(<MaterialPage {...pageProps([{ id: 'prop-only', originalText: '', scriptSegment: '举起茶杯', props: ['茶杯'] }], {})} />);
    expect(screen.getByTestId('material-binding-status')).toHaveTextContent('无需绑定');
    expect(screen.getByTestId('material-binding-summary')).toHaveTextContent('当前道具暂无图片，可仅用文字描述，无需绑定图片');
    expect(screen.getByText('举起茶杯')).toBeInTheDocument();
  });
});
