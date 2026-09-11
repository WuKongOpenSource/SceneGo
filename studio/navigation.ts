/** Validate the normalized URL, not just its prefix: backslashes and dot
 * segments can turn a seemingly local path into a network-path reference. */
export function resolveStudioReturnTo(value: unknown, fallback: string, origin: string): string {
  const localPath = (candidate: unknown): string | null => {
    if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//') || /[\u0000-\u001f\u007f]/.test(candidate)) return null;
    try {
      const base = new URL(origin);
      if (!['http:', 'https:'].includes(base.protocol)) return null;
      const target = new URL(candidate, base.origin);
      if (target.origin !== base.origin || target.pathname.startsWith('//')) return null;
      return `${target.pathname}${target.search}${target.hash}`;
    } catch {
      return null;
    }
  };
  return localPath(value) || localPath(fallback) || '/projects';
}

export function navigateFromStudio(path: string): void {
  // Revalidate at the navigation sink, including runtime-supplied destinations.
  // An absolute same-origin target cannot inherit an iframe or document base URL.
  const target = new URL(resolveStudioReturnTo(path, '/projects', window.location.origin), window.location.origin).href;
  try {
    if (window.self !== window.top && window.top && window.top.location.origin === window.location.origin) {
      window.top.location.assign(target);
      return;
    }
  } catch {
    // Cross-origin embedding is unsupported; keep navigation in this window.
  }
  window.location.assign(target);
}
