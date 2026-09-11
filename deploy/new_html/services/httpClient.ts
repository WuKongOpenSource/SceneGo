import { pickTokenForCurrentRoute } from '@runtime/adminAuth';
import { isAdminPath } from '../admin/adminRoute';
import { sanitizeProcessingTerminology } from '../utils/processingTerminology';

type HeaderMap = Record<string, string>;

interface HeaderOptions {
  requireAuth?: boolean;
  authErrorMessage?: string;
  includeContentType?: boolean;
  includeAuth?: boolean;
  apiName?: string;
  redirectOnMissingAuth?: boolean;
}

interface ApiFetchConfig extends HeaderOptions {}

function redirectToLogin(from?: string): void {
  const loginUrl = (destination?: string) => destination
    ? `/login?redirect=${encodeURIComponent(destination)}`
    : '/login';
  try {
    // Login deliberately forbids framing. Expired embedded workspaces must
    // navigate their same-origin shell, not render a blocked login document.
    const parent = window.top;
    if (parent && parent !== window && parent.location.origin === window.location.origin) {
      const parentFrom = `${parent.location.pathname}${parent.location.search}${parent.location.hash}`;
      parent.location.href = loginUrl(parent.location.pathname === '/login' ? from : parentFrom);
      return;
    }
  } catch {
    // Never navigate an unreadable or foreign parent.
  }
  window.location.href = loginUrl(from);
}
export function handleUnauthorized(apiName: string = 'API', reason: 'response401' | 'missingToken' = 'response401'): never {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const adminRoute = isAdminPath(path);
  const isLoginPage = path === '/login';
  const reasonText = reason === 'missingToken'
    ? '缺少登录 token'
    : '返回401，token可能已失效';
  console.error(`${apiName} ${reasonText}（path=${path}, isAdmin=${adminRoute}）`);

  if (adminRoute) {
    try {
      sessionStorage.removeItem('admin_session_token');
      sessionStorage.removeItem('admin_session_username');
      sessionStorage.removeItem('admin_session_login_at');
      sessionStorage.removeItem('admin_session_role');
    } catch {}
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
    localStorage.removeItem('user_id');
    if (!isLoginPage) {
      const from = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      redirectToLogin(from);
    }
  } else {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('username');
    localStorage.removeItem('user_id');
    if (!isLoginPage) {
      const studioRoute = path === '/studio' || path.startsWith('/studio/');
      const from = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      redirectToLogin(studioRoute ? from : undefined);
    }
  }
  throw new Error('未授权，请重新登录');
}

export async function handleResponse(response: Response, apiName: string = 'API'): Promise<any> {
  const publicApiName = sanitizeProcessingTerminology(apiName);
  if (response.status === 401) {
    handleUnauthorized(apiName);
  }

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    console.error(`${publicApiName} 返回非JSON响应 (${response.status}):`, sanitizeProcessingTerminology(text.substring(0, 200)));
    const buildHttpError = (message: string) => {
      const error: any = new Error(message);
      error.status = response.status;
      return error;
    };
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      throw buildHttpError(`${publicApiName} 返回了HTML页面而非JSON (${response.status})，可能是路由不存在或服务器错误`);
    }
    if (text.trim().toLowerCase() === 'internal server error') {
      throw buildHttpError(`${publicApiName} 服务暂时异常 (${response.status})，系统将自动重试`);
    }
    throw buildHttpError(`${publicApiName} 返回了非JSON响应 (${response.status}): ${sanitizeProcessingTerminology(text.substring(0, 100))}`);
  }

  let data: any;
  try {
    data = await response.json();
  } catch (e) {
    const text = await response.text();
    console.error(`${publicApiName} JSON解析失败:`, sanitizeProcessingTerminology(text.substring(0, 200)));
    throw new Error(`${publicApiName} 返回的数据无法解析为JSON`);
  }

  if (!response.ok) {
    const detail = data?.detail ?? data?.message;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const human =
        detail.error ||
        detail.message ||
        JSON.stringify(detail);
      console.error(`${publicApiName} 返回错误 (${response.status}):`, sanitizeProcessingTerminology(JSON.stringify(detail)));
      const err: any = new Error(`${publicApiName} 失败 (${response.status}): ${sanitizeProcessingTerminology(human)}`);
      err.status = response.status;
      const { message: _detailMessage, ...rest } = detail as Record<string, any>;
      Object.assign(err, rest);
      throw err;
    }
    const text = typeof detail === 'string' ? detail : JSON.stringify(data);
    console.error(`${publicApiName} 返回错误 (${response.status}):`, sanitizeProcessingTerminology(text));
    const err: any = new Error(`${publicApiName} 失败 (${response.status}): ${sanitizeProcessingTerminology(text)}`);
    err.status = response.status;
    throw err;
  }

  return data;
}







export function getAuthToken(): string | null {
  return pickTokenForCurrentRoute();
}

export function getHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

function normalizeHeaders(headers?: HeadersInit): HeaderMap {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: HeaderMap = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return headers.reduce<HeaderMap>((out, [key, value]) => {
      out[key] = value;
      return out;
    }, {});
  }
  return { ...(headers as HeaderMap) };
}

function withoutContentType(headers: HeaderMap): HeaderMap {
  const out: HeaderMap = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key.toLowerCase() !== 'content-type') out[key] = value;
  });
  return out;
}

function withoutAuthorization(headers: HeaderMap): HeaderMap {
  const out: HeaderMap = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key.toLowerCase() !== 'authorization') out[key] = value;
  });
  return out;
}

export function buildAuthHeaders(
  extraHeaders?: HeadersInit,
  options: HeaderOptions = {},
): HeaderMap {
  const normalizedBaseHeaders = normalizeHeaders(getHeaders());
  const baseHeaders = options.includeAuth === false
    ? withoutAuthorization(normalizedBaseHeaders)
    : normalizedBaseHeaders;
  const headers = {
    ...(options.includeContentType === false ? withoutContentType(baseHeaders) : baseHeaders),
    ...normalizeHeaders(extraHeaders),
  };




  return headers;
}

export function buildJsonHeaders(
  extraHeaders?: HeadersInit,
  options: HeaderOptions = {},
): HeaderMap {
  return buildAuthHeaders(extraHeaders, { ...options, includeContentType: true });
}

export function authTokenFromHeaders(options: HeaderOptions = {}): string {
  const headers = buildAuthHeaders(undefined, {
    requireAuth: options.requireAuth,
    authErrorMessage: options.authErrorMessage,
    includeContentType: false,
  });
  const auth = headers.Authorization || headers.authorization || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}


function stripTokenParam(url: string): string {
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const noHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = noHash.indexOf('?');
  if (qIdx < 0) return url;
  const path = noHash.slice(0, qIdx);
  const kept = noHash
    .slice(qIdx + 1)
    .split('&')
    .filter(part => part && !/^token=/i.test(part));
  return kept.length ? `${path}?${kept.join('&')}${hash}` : `${path}${hash}`;
}

const SAFE_DATA_MEDIA_URL = /^data:(?:image\/(?:png|jpe?g|gif|webp|avif)|audio\/(?:mpeg|mp4|ogg|wav|webm)|video\/(?:mp4|ogg|webm));base64,/i;

/**
 * Reject executable or local-file URL schemes before values reach src/href or
 * window.open. SVG/HTML data URLs are intentionally excluded because they can
 * become active documents when opened outside an image element.
 */
export function safeBrowserResourceUrl(url: string): string {
  const value = String(url || '').trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return '';
  if (value.startsWith('data:')) return SAFE_DATA_MEDIA_URL.test(value) ? value : '';
  try {
    const parsed = new URL(value, window.location.origin);
    if (!['http:', 'https:', 'blob:'].includes(parsed.protocol)) return '';
    if (parsed.username || parsed.password) return '';
    return value;
  } catch {
    return '';
  }
}

export function secureApiUrl(url: string, options: { absolute?: boolean; requireAuth?: boolean } = {}): string {
  if (!url) return url;
  const safeUrl = safeBrowserResourceUrl(url);
  if (!safeUrl) return '';
  const base = options.absolute && safeUrl.startsWith('/')
    ? `${window.location.origin}${safeUrl}`
    : safeUrl;

  // Same-origin media and EventSource requests receive the HttpOnly session
  // cookie automatically. Never copy a long-lived JWT into URLs, browser
  // history, proxy logs, referrers, or persisted project data. Preserve
  // third-party signed URLs because their own `token` parameter may be part of
  // the provider signature.
  try {
    const parsed = new URL(base, window.location.origin);
    if (parsed.origin !== window.location.origin) return base;
  } catch {
    return base;
  }
  return stripTokenParam(base);
}

export async function apiFetch(
  url: string,
  options: RequestInit = {},
  config: ApiFetchConfig = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    credentials: options.credentials ?? 'same-origin',
    headers: buildAuthHeaders(options.headers, {
      requireAuth: config.requireAuth,
      authErrorMessage: config.authErrorMessage,
      includeContentType: config.includeContentType,
      apiName: config.apiName,
      redirectOnMissingAuth: true,
    }),
  });

  if (response.headers.get('x-ostory-session-upgraded') === '1') {
    try {
      localStorage.removeItem('auth_token');
    } catch {}
  }

  if (response.status === 401) {
    await handleResponse(response, config.apiName || 'API');
  }

  return response;
}

export async function publicFetch(
  url: string,
  options: RequestInit = {},
  config: Pick<ApiFetchConfig, 'apiName' | 'includeContentType'> = {},
): Promise<Response> {
  return fetch(url, {
    ...options,
    credentials: 'omit',
    headers: buildAuthHeaders(options.headers, {
      requireAuth: false,
      includeAuth: false,
      includeContentType: config.includeContentType,
    }),
  });
}

export async function apiJson<T>(
  url: string,
  options: RequestInit = {},
  apiName: string = 'API',
  config: Omit<ApiFetchConfig, 'apiName'> = {},
): Promise<T> {
  const response = await apiFetch(url, options, { ...config, apiName });
  return handleResponse(response, apiName) as Promise<T>;
}

/** Use an explicit one-off token before a route-scoped session has been stored. */
export async function apiJsonWithToken<T>(
  url: string,
  token: string,
  options: RequestInit = {},
  apiName: string = 'API',
): Promise<T> {
  const headers = normalizeHeaders(options.headers);
  headers.Authorization = `Bearer ${token}`;
  return apiJson<T>(url, { ...options, headers }, apiName, { requireAuth: false });
}

export async function apiBlob(
  url: string,
  options: RequestInit = {},
  apiName: string = 'API',
  config: Omit<ApiFetchConfig, 'apiName'> = {},
): Promise<Blob> {
  const response = await apiFetch(url, options, { ...config, apiName });
  if (!response.ok) {
    await handleResponse(response, apiName);
  }
  return response.blob();
}

export async function publicBlob(
  url: string,
  options: RequestInit = {},
  apiName: string = 'Public Blob',
  config: Pick<ApiFetchConfig, 'includeContentType'> = {},
): Promise<Blob> {
  const response = await publicFetch(url, options, {
    apiName,
    includeContentType: config.includeContentType ?? false,
  });
  if (!response.ok) {
    throw new Error(`${apiName} failed (${response.status})`);
  }
  return response.blob();
}
