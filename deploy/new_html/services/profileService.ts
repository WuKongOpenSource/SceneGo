import { apiJson } from './httpClient';
import { applyAccountIdentity } from './accountStorage';

export interface MyProfile {
  id?: number;
  user_id: string;
  username: string;
  email?: string | null;
  email_verified?: boolean;
  email_verified_at?: string | null;
  avatar_url?: string | null;
  phone_number?: string | null;
  phone_verified: boolean;
  phone_verified_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_login_at?: string | null;
}

export interface ProfileCredits {
  account_id?: string | null;
  available_credits: number;
  account_credits?: number;
  gift_credits?: number;
  gift_expires_at?: string | null;
  frozen_credits: number;
  total_used_credits: number;
}

export interface ProfileProjectStats {
  total: number;
  active: number;
  archived: number;
  owned: number;
  shared: number;
}

export interface ProfileRecentProject {
  project_id: string;
  project_name: string;
  description: string;
  cover_url?: string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  is_archived: boolean;
  member_role?: string | null;
  episode_count: number;
  updated_at?: string | null;
  last_accessed_at?: string | null;
  created_at?: string | null;
}

export interface MyProfileResponse {
  success: boolean;
  profile: MyProfile;
  credits: ProfileCredits;
  project_stats: ProfileProjectStats;
  recent_projects: ProfileRecentProject[];
}

export interface ProfileUpdatePayload {
  username?: string;
}

export interface EmailNotificationPreferences {
  task_success: boolean;
  task_failure: boolean;
  credit_alert: boolean;
  sharing: boolean;
}

export interface EmailPreferencesResponse {
  success: boolean;
  email?: string | null;
  email_verified: boolean;
  preferences: EmailNotificationPreferences;
}

export interface ProfileUpdateResponse {
  success: boolean;
  profile: MyProfile;
  username_changed?: boolean;
  token?: string;
}

export async function getMyProfile(): Promise<MyProfileResponse> {
  return apiJson('/api/me/profile', { method: 'GET' }, 'getMyProfile');
}

export async function updateMyProfile(payload: ProfileUpdatePayload): Promise<ProfileUpdateResponse> {
  const response = await apiJson<ProfileUpdateResponse>('/api/me/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  }, 'updateMyProfile');
  if (response?.profile) {
    applyAccountIdentity({
      token: response.token,
      username: response.profile.username,
      userId: response.profile.user_id,
    });
  }
  return response;
}

export async function changeMyPassword(payload: {
  current_password: string;
  new_password: string;
}): Promise<{ success: boolean }> {
  return apiJson('/api/me/password', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 'changeMyPassword');
}

export async function sendMyEmailVerification(email: string): Promise<{ success: boolean; expires_in: number; resend_in: number }> {
  return apiJson('/api/me/email/send-code', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }, 'sendMyEmailVerification');
}

export async function verifyMyEmail(email: string, code: string): Promise<{ success: boolean; email: string; email_verified: boolean }> {
  return apiJson('/api/me/email/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  }, 'verifyMyEmail');
}

export async function getMyEmailPreferences(): Promise<EmailPreferencesResponse> {
  return apiJson('/api/me/email-preferences', { method: 'GET' }, 'getMyEmailPreferences');
}

export async function updateMyEmailPreferences(
  preferences: Partial<EmailNotificationPreferences>,
): Promise<{ success: boolean; preferences: EmailNotificationPreferences }> {
  return apiJson('/api/me/email-preferences', {
    method: 'PUT',
    body: JSON.stringify(preferences),
  }, 'updateMyEmailPreferences');
}
