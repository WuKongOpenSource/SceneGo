import React, { useMemo, useState } from 'react';
import { Check, Clapperboard, Library, RefreshCw, Search, X } from 'lucide-react';
import type { GenerationReference, MaterialLibrary, ProjectFile, StoryboardItem } from '../types';
import { buildOtherStoryboardImagePickerItems } from '../utils/storyboardGeneration';

const EMPTY_FILES: ProjectFile[] = [];
const EMPTY_SHOTS: StoryboardItem[] = [];

export function useProjectMaterialPicker(
  materialLibrary: MaterialLibrary,
  files: ProjectFile[] = EMPTY_FILES,
  selectedShot?: StoryboardItem,
  storyboardItems: StoryboardItem[] = EMPTY_SHOTS,
  initialFilter: 'shot' | 'all' = 'shot',
) {
  const [materialPickerFilter, setMaterialPickerFilter] = useState<'shot' | 'other-shot' | 'character' | 'scene' | 'prop' | 'all'>(initialFilter);
  const [materialPickerSearch, setMaterialPickerSearch] = useState('');
  const materialPickerItems = useMemo(() => {
      const typeByTag = new Map<string, 'character' | 'scene' | 'prop'>();
      for (const file of files) {
          for (const item of file.storyboard?.items || []) {
              for (const character of item.characters || []) typeByTag.set(character, 'character');
              if (item.scene) typeByTag.set(item.scene, 'scene');
              for (const prop of item.props || []) typeByTag.set(prop, 'prop');
          }
      }

      const relevantTags = new Set([
          ...(selectedShot?.characters || []),
          ...(selectedShot?.props || []),
          ...(selectedShot?.scene ? [selectedShot.scene] : []),
      ]);
      return Object.entries(materialLibrary)
          .flatMap(([tagName, materials]) => materials.map(material => {
              const type = material.assetType || typeByTag.get(tagName) || 'prop';
              return {
                  key: `${tagName}:${material.id}`,
                  tagName,
                  material,
                  type,
                  isRelevant: relevantTags.has(tagName),
              };
          }))
          .sort((left, right) => (
              Number(right.isRelevant) - Number(left.isRelevant)
              || left.type.localeCompare(right.type)
              || left.tagName.localeCompare(right.tagName, 'zh-CN')
          ));
  }, [files, materialLibrary, selectedShot]);

  const visibleMaterialPickerItems = useMemo(() => {
      const keyword = materialPickerSearch.trim().toLowerCase();
      return materialPickerItems.filter(item => {
          if (materialPickerFilter === 'shot' && !item.isRelevant) return false;
          if (materialPickerFilter === 'other-shot') return false;
          if (materialPickerFilter !== 'shot' && materialPickerFilter !== 'all' && item.type !== materialPickerFilter) return false;
          if (!keyword) return true;
          return [item.tagName, item.material.name, item.material.description]
              .some(value => String(value || '').toLowerCase().includes(keyword));
      });
  }, [materialPickerFilter, materialPickerItems, materialPickerSearch]);
  const otherStoryboardImageItems = useMemo(
      () => buildOtherStoryboardImagePickerItems(
          storyboardItems,
          selectedShot?.id,
      ),
      [storyboardItems, selectedShot?.id],
  );
  const visibleOtherStoryboardImageItems = useMemo(() => {
      if (materialPickerFilter !== 'other-shot' && materialPickerFilter !== 'all') return [];
      const keyword = materialPickerSearch.trim().toLowerCase();
      if (!keyword) return otherStoryboardImageItems;
      return otherStoryboardImageItems.filter(item => item.searchText.includes(keyword));
  }, [materialPickerFilter, materialPickerSearch, otherStoryboardImageItems]);
  const materialPickerFilterCounts = useMemo<Record<typeof materialPickerFilter, number>>(() => {
      const counts = materialPickerItems.reduce(
          (acc, item) => {
              acc.all += 1;
              if (item.isRelevant) acc.shot += 1;
              acc[item.type] += 1;
              return acc;
          },
          {
              shot: 0,
              'other-shot': otherStoryboardImageItems.length,
              character: 0,
              scene: 0,
              prop: 0,
              all: otherStoryboardImageItems.length,
          },
      );
      return counts;
  }, [materialPickerItems, otherStoryboardImageItems.length]);

  return { materialPickerFilter, setMaterialPickerFilter, materialPickerSearch, setMaterialPickerSearch,
    materialPickerItems, visibleMaterialPickerItems, otherStoryboardImageItems,
    visibleOtherStoryboardImageItems, materialPickerFilterCounts };
}

export type ProjectMaterialPickerState = ReturnType<typeof useProjectMaterialPicker>;
export type ProjectMaterialPickerItem = ProjectMaterialPickerState['materialPickerItems'][number];

interface ProjectMaterialPickerProps extends ProjectMaterialPickerState {
  references: Pick<GenerationReference, 'url'>[];
  maxSelected?: number;
  hideShotFilters?: boolean;
  loading?: boolean;
  busy?: boolean;
  errorMessage?: string | null;
  description?: string;
  footer?: string;
  isLoadingOtherShotImages?: boolean;
  handleMaterialPickerFilterChange: (filter: ProjectMaterialPickerState['materialPickerFilter']) => void;
  handleAddProjectMaterial: (item: ProjectMaterialPickerItem) => void;
  handleAddOtherStoryboardImage?: (item: ProjectMaterialPickerState['otherStoryboardImageItems'][number]) => void;
  onClose: () => void;
  onRefresh?: () => void;
}

export const ProjectMaterialPicker: React.FC<ProjectMaterialPickerProps> = ({
  materialPickerFilter, materialPickerSearch, setMaterialPickerSearch,
  visibleMaterialPickerItems, visibleOtherStoryboardImageItems, materialPickerFilterCounts,
  references, maxSelected = 6, hideShotFilters = false, loading = false, busy = false, errorMessage,
  description = '本镜头相关素材排在最前；可任意添加项目素材或其他分镜图片作为当前镜头参考。',
  footer, isLoadingOtherShotImages = false, handleMaterialPickerFilterChange,
  handleAddProjectMaterial, handleAddOtherStoryboardImage = () => {}, onClose, onRefresh,
}) => {
  return (
          <div className="fixed inset-0 z-[140] bg-n900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="w-[min(1024px,calc(100vw-32px))] h-[min(760px,calc(100vh-2rem))] bg-n0 border border-n40 rounded-lg shadow-bottom flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-label="项目素材" data-testid="material-picker-dialog" onClick={event => event.stopPropagation()}>
              <div className="shrink-0 flex items-start justify-between gap-4 px-5 py-4 border-b border-n40">
                <div>
                  <h3 className="text-sm font-bold text-n800 flex items-center gap-2"><Library className="w-4 h-4 text-primary" />项目素材</h3>
                  <p className="mt-1 text-[11px] text-n300">{description}</p>
                </div>
                <button onClick={onClose} className="w-8 h-8 inline-flex items-center justify-center text-n300 hover:text-n800" title="关闭">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="shrink-0 px-5 py-3 border-b border-n40 flex flex-wrap items-center gap-2">
                 {([
                   ['shot', '本镜头'],
                   ['other-shot', '其他分镜'],
                   ['character', '人物'],
                   ['scene', '场景'],
                   ['prop', '道具'],
                   ['all', '全部'],
                 ] as const).filter(([value]) => !hideShotFilters || (value !== 'shot' && value !== 'other-shot')).map(([value, label]) => {
                   const count = materialPickerFilterCounts[value];
                   return (
                     <button
                       key={value}
                       onClick={() => void handleMaterialPickerFilterChange(value)}
                       className={`h-8 px-3 inline-flex items-center gap-1.5 text-xs border rounded ${materialPickerFilter === value ? 'bg-primary text-white border-primary' : 'bg-n0 text-n700 border-n40 hover:bg-n20'}`}
                     >
                       {value === 'other-shot' && <Clapperboard className="w-3.5 h-3.5" />}
                       <span>{label}</span>
                       <span className={`min-w-4 h-4 px-1 inline-flex items-center justify-center rounded text-[9px] ${materialPickerFilter === value ? 'bg-white/20 text-white' : 'bg-n30 text-n500'}`}>
                         {count}
                       </span>
                     </button>
                   );
                 })}
                {onRefresh && <button type="button" onClick={onRefresh} disabled={loading || busy} className="h-8 px-3 text-xs text-primary border border-primary/30 rounded disabled:opacity-50">刷新素材</button>}
                <label className="ml-auto min-w-[220px] h-8 flex items-center gap-2 px-3 border border-n40 rounded bg-n0">
                  <Search className="w-3.5 h-3.5 text-n100" />
                  <input
                    value={materialPickerSearch}
                    onChange={event => setMaterialPickerSearch(event.target.value)}
                    className="min-w-0 flex-1 text-xs text-n700 outline-none bg-transparent"
                    placeholder="搜索镜头、人物、场景或道具"
                  />
                </label>
              </div>
              {errorMessage && <p role="alert" className="px-5 py-2 text-xs text-danger">{errorMessage}</p>}
              <div className="flex-1 min-h-0 overflow-y-auto p-5">
                {(loading || (isLoadingOtherShotImages && (materialPickerFilter === 'other-shot' || materialPickerFilter === 'all'))) ? (
                  <div className="h-56 flex flex-col items-center justify-center text-n300">
                    <RefreshCw className="w-6 h-6 mb-3 animate-spin text-primary" />
                    <span className="text-xs">正在加载项目素材...</span>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {!hideShotFilters && (materialPickerFilter === 'other-shot' || materialPickerFilter === 'all') && (
                      <section>
                        {materialPickerFilter === 'all' && (
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-n700">
                            <Clapperboard className="w-3.5 h-3.5 text-primary" />
                            其他分镜图片
                          </div>
                        )}
                        {visibleOtherStoryboardImageItems.length > 0 ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {visibleOtherStoryboardImageItems.map(item => {
                              const alreadyAdded = references.some(reference => reference.url === item.url);
                              const disabled = alreadyAdded || references.length >= maxSelected || busy;
                              return (
                                <button
                                  key={item.key}
                                  onClick={() => !disabled && handleAddOtherStoryboardImage(item)}
                                  disabled={disabled}
                                  className={`relative overflow-hidden rounded-md border text-left transition-colors ${alreadyAdded ? 'border-success bg-success/5' : 'border-n40 bg-n0 hover:border-primary'} disabled:cursor-not-allowed`}
                                  title={alreadyAdded ? '已在当前参考图中' : `添加 ${item.shotLabel} 的${item.imageLabel}`}
                                >
                                  <div className="aspect-video bg-n30 flex items-center justify-center">
                                    <img
                                      src={item.thumbnail || item.url}
                                      alt={`${item.shotLabel} ${item.imageLabel}`}
                                      loading="lazy"
                                      className="w-full h-full object-contain"
                                    />
                                  </div>
                                  <div className="p-2 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="truncate text-xs font-semibold text-n700">{item.shotLabel}</span>
                                      {alreadyAdded && <Check className="w-3.5 h-3.5 shrink-0 text-success" />}
                                    </div>
                                    <div className="mt-1 flex items-center gap-1 text-[9px] text-n100">
                                      <span className={`rounded px-1 py-0.5 ${item.isSelected ? 'bg-success/10 text-success' : 'bg-n30 text-n300'}`}>
                                        {item.imageLabel}
                                      </span>
                                      <span>仅作参考</span>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="h-36 flex flex-col items-center justify-center rounded-md border border-dashed border-n40 text-n100">
                            <Clapperboard className="w-7 h-7 mb-2 opacity-40" />
                            <span className="text-xs">其他分镜还没有可用图片</span>
                          </div>
                        )}
                      </section>
                    )}

                    {materialPickerFilter !== 'other-shot' && (
                      <section>
                        {materialPickerFilter === 'all' && (
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-n700">
                            <Library className="w-3.5 h-3.5 text-primary" />
                            项目素材
                          </div>
                        )}
                        {visibleMaterialPickerItems.length > 0 ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {visibleMaterialPickerItems.map(item => {
                              const alreadyAdded = references.some(reference => reference.url === item.material.url);
                              const disabled = alreadyAdded || references.length >= maxSelected || busy;
                              return (
                                <button
                                  key={item.key}
                                  onClick={() => !disabled && handleAddProjectMaterial(item)}
                                  disabled={disabled}
                                  className={`relative overflow-hidden rounded-md border text-left transition-colors ${alreadyAdded ? 'border-success bg-success/5' : 'border-n40 bg-n0 hover:border-primary'} disabled:cursor-not-allowed`}
                                  title={alreadyAdded ? '已在当前参考图中' : `添加 ${item.tagName}`}
                                >
                                  <div className="aspect-square bg-n30">
                                    <img src={item.material.thumbnail || item.material.url} alt={item.tagName} loading="lazy" className="w-full h-full object-cover" />
                                  </div>
                                  <div className="p-2 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="truncate text-xs font-semibold text-n700">{item.tagName || item.material.name || '未命名素材'}</span>
                                      {alreadyAdded && <Check className="w-3.5 h-3.5 shrink-0 text-success" />}
                                    </div>
                                    <div className="mt-1 flex items-center gap-1 text-[9px] text-n100">
                                      <span>{item.type === 'character' ? '人物' : item.type === 'scene' ? '场景' : '道具'}</span>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="h-36 flex flex-col items-center justify-center rounded-md border border-dashed border-n40 text-n100">
                            <Library className="w-7 h-7 mb-2 opacity-40" />
                            <span className="text-xs">当前分类没有可用素材</span>
                          </div>
                        )}
                      </section>
                    )}

                    {materialPickerFilter === 'all'
                      && visibleOtherStoryboardImageItems.length === 0
                      && visibleMaterialPickerItems.length === 0
                      && (
                        <div className="h-32 flex flex-col items-center justify-center text-n100">
                          <Search className="w-7 h-7 mb-2 opacity-40" />
                          <span className="text-xs">没有匹配的素材或分镜图片</span>
                        </div>
                      )}
                  </div>
                )}
              </div>
              <div className="shrink-0 px-5 py-3 border-t border-n40 flex items-center justify-between gap-4 text-[11px] text-n300">
                <span>{footer ?? <>参考图 {references.length}/{maxSelected}；其他分镜图片只建立当前镜头引用，不会修改来源镜头。</>}</span>
                <button onClick={onClose} className="h-8 px-4 rounded bg-primary text-white hover:bg-primary-hover">完成</button>
              </div>
            </div>
          </div>  );
};
