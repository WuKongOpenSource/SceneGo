export interface HelpDocument {
  id: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  source: string;
  sourceUrl?: string;
}

export interface HelpCatalog {
  version: number;
  updatedAt: string;
  sourceRevision: string;
  categories: { id: string; title: string; description: string }[];
  documents: HelpDocument[];
}

export const HELP_CATALOG_URL = '/assets/help/catalog.json';

// This is public, read-only editorial content, never workspace or account state.
export async function loadHelpCatalog(signal: AbortSignal): Promise<HelpCatalog> {
  const response = await fetch(HELP_CATALOG_URL, { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error('帮助文档暂时无法加载，请重试。');
  const catalog = await response.json() as HelpCatalog;
  if (catalog.version !== 1 || !Array.isArray(catalog.documents) || !Array.isArray(catalog.categories)
      || catalog.documents.some(doc => !/^[a-z0-9-]+$/.test(doc.id) || typeof doc.body !== 'string')) {
    throw new Error('帮助文档暂时无法加载，请重试。');
  }
  return catalog;
}

export function searchHelpDocuments(documents: HelpDocument[], query: string, category = ''): HelpDocument[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return documents.filter(doc => (!category || doc.category === category)
    && terms.every(term => `${doc.title}\n${doc.summary}\n${doc.body}`.toLocaleLowerCase().includes(term)))
    .map((doc, index) => ({ doc, index, score: terms.reduce((sum, term) =>
      sum + (doc.title.toLocaleLowerCase().includes(term) ? 2 : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(({ doc }) => doc);
}

export function helpHeadingId(text: string): string {
  return `help-${text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-')}`;
}

export function helpHeadings(body: string) {
  let fence = '';
  const seen = new Map<string, number>();
  return body.split('\n').flatMap((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = '';
      return [];
    }
    const match = !fence && /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (!match) return [];
    const title = match[2].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*_]/g, '');
    const base = helpHeadingId(title), count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return [{ title, id: count ? `${base}-${count}` : base, level: match[1].length, line: index + 1 }];
  });
}

export function safeHelpUrl(value: string, image = false): string {
  // Do not load remote tracking images, executable URLs, or protocol-relative URLs.
  if (/^\/assets\/help\/[a-zA-Z0-9_./%-]+$/.test(value) && !value.includes('..')) return value;
  if (image) return '';
  if (/^\/tools\/help(?:\/[a-z0-9-]+)?(?:[?#].*)?$/.test(value)) return value;
  if (/^#[^\s]*$/.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^mailto:[^\s]+$/i.test(value)) return value;
  return '';
}
