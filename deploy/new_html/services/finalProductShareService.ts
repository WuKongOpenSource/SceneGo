import { apiJson, handleResponse, publicFetch } from './httpClient';

export interface FinalShare {
  share_id: string;
  share_token: string;
  library_item_id: string;
  is_active: boolean;
  access_count: number;
  created_at: string;
}

export interface FinalFeedback {
  feedback_id: string;
  author_name: string;
  content: string;
  timestamp_seconds: number | null;
  created_at: string;
}

export interface PublicFinal {
  share_id: string;
  library_item_id: string;
  title: string | null;
  description: string;
  file_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  created_at: string;
  shared_at: string;
}

export const finalShareUrl = (token: string) => `${window.location.origin}/share/final/${token}`;

export async function getFinalShare(libraryItemId: string) {
  return apiJson<{ success: boolean; share: FinalShare | null }>(
    `/api/final-products/${libraryItemId}/share`,
    { method: 'GET' },
    '获取成品分享',
  );
}

export async function createFinalShare(libraryItemId: string) {
  return apiJson<{ success: boolean; share: FinalShare }>(
    `/api/final-products/${libraryItemId}/share`,
    { method: 'POST' },
    '创建成品分享',
  );
}

export async function deactivateFinalShare(libraryItemId: string, shareId: string) {
  return apiJson<{ success: boolean }>(
    `/api/final-products/${libraryItemId}/share/${shareId}`,
    { method: 'DELETE' },
    '停止成品分享',
  );
}

export async function listFinalFeedback(libraryItemId: string) {
  return apiJson<{ success: boolean; feedback: FinalFeedback[] }>(
    `/api/final-products/${libraryItemId}/feedback`,
    { method: 'GET' },
    '获取成品意见',
  );
}

export async function getPublicFinal(token: string) {
  const response = await publicFetch(`/api/public/final-products/${encodeURIComponent(token)}`, { method: 'GET' });
  return handleResponse(response, '打开成品分享') as Promise<{
    success: boolean;
    final: PublicFinal;
    feedback: FinalFeedback[];
  }>;
}

export async function submitPublicFeedback(token: string, payload: {
  author_name?: string;
  content: string;
  timestamp_seconds?: number | null;
}) {
  const response = await publicFetch(
    `/api/public/final-products/${encodeURIComponent(token)}/feedback`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return handleResponse(response, '提交成品意见') as Promise<{ success: boolean; feedback: FinalFeedback }>;
}
