



import type { MediaFolder } from '../services/mediaLibraryService';

export interface FolderNode extends MediaFolder {
  children: FolderNode[];
}

export interface FlatFolderOption {
  folder_id: string;
  name: string;
  depth: number;
}


export function buildFolderTree(folders: MediaFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.folder_id, { ...f, children: [] });

  const roots: FolderNode[] = [];
  for (const f of folders) {
    const node = byId.get(f.folder_id)!;
    const parent = f.parent_folder_id ? byId.get(f.parent_folder_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortRec = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => (a.folder_order - b.folder_order) || a.name.localeCompare(b.name));
    nodes.forEach(n => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}


export function flattenForSelect(nodes: FolderNode[], depth = 0): FlatFolderOption[] {
  const out: FlatFolderOption[] = [];
  for (const n of nodes) {
    out.push({ folder_id: n.folder_id, name: n.name, depth });
    if (n.children.length) out.push(...flattenForSelect(n.children, depth + 1));
  }
  return out;
}


export function collectDescendantIds(node: FolderNode): string[] {
  const ids = [node.folder_id];
  for (const c of node.children) ids.push(...collectDescendantIds(c));
  return ids;
}
