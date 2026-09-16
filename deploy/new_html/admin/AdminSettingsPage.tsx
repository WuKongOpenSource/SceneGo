/**
 * AdminSettingsPage.tsx - system settings shell.
 *
 * API config is rendered natively so provider health can be shown without
 * reaching into the legacy iframe. Other settings pages continue to use the
 * legacy console until they are migrated.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Activity,
    AlertCircle,
    CheckCircle2,
    Download,
    Edit3,
    ExternalLink,
    ImageIcon,
    KeyRound,
    Loader2,
    Plus,
    RefreshCw,
    ServerCog,
    Timer,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import { crmConfirm, crmMessage } from './crmUI';
import { apiBlob } from '../services/httpClient';
import { apiJson } from '../services/httpClient';
import { JimengAccountCard } from './JimengAccountCard';
import {
    isConnectivityOnlyConfigTest,
    mergeConfigTestPreservingVerification,
} from '../utils/apiConfigTestState';
import { providerCredentialLinksForEndpoint } from '../utils/providerCredentialLinks';
import {
    apiConfigErrorMessage,
    apiConfigCategories,
    bindingsForCategory,
    providerAccessModeForEndpoint,
} from '../utils/apiConfigPresentation';
import { adminPath } from './adminRoute';

const LEGACY_VER = '20260701-qwen-agent-v2';
const LEGACY_PAGE_BY_ITEM: Record<string, string> = {
    cluster: 'cluster',
    workflows: 'workflows',
    dashboard: 'dashboard',
};

type HealthStatus = 'ok' | 'error' | 'no_key' | 'blocked_region' | 'connectivity_ok' | 'unknown';
type JsonRecord = Record<string, any>;

interface ApiModelBinding {
    operation: string;
    label?: string;
    model_name: string;
    scope?: string;
    scope_label?: string;
    front_model_key?: string;
    default_display_name?: string;
    default_description?: string;
    display_name?: string;
    description?: string;
    published?: boolean;
}

interface ApiConfig {
    config_id: string;
    name: string;
    provider: string;
    endpoint?: string;
    api_key_encrypted?: string;
    has_key?: boolean;
    api_key_preview?: string;
    model_name?: string;
    model_bindings?: ApiModelBinding[];
    proxy_mode?: string;
    custom_proxy?: string;
    request_template?: JsonRecord | string | null;
    headers?: JsonRecord | string | null;
    category?: string;
    enabled?: boolean;
}

interface ProviderMeta {
    provider: string;
    label?: string;
    vendor?: string;
    env_key?: string;
    notes?: string;
    docs_url?: string;
    console_url?: string;
    key_help?: string;
    capabilities?: string[];
    extra_fields?: ProviderExtraField[];
    model_binding_options?: ApiModelBinding[];
    model_usage_scopes?: ModelUsageScopeMeta[];
    access_modes?: ProviderAccessMode[];
    default_config_name?: string;
    default_endpoint?: string;
    default_model_name?: string;
    default_category?: string;
    default_proxy_mode?: string;
    preset_count?: number;
    preset_categories?: string[];
    operation_paths?: Record<string, string>;
    default_operation_url_templates?: Record<string, string>;
}

interface ModelUsageScopeMeta {
    scope: string;
    label?: string;
}

interface ProviderAccessMode {
    mode: string;
    label?: string;
    endpoint: string;
    console_url?: string;
    docs_url?: string;
    description?: string;
    model_map?: Record<string, string>;
}

interface ProviderExtraField {
    field: string;
    label?: string;
    target?: 'request_template' | 'headers' | string;
    env_key?: string;
    input_type?: 'text' | 'password' | string;
    placeholder?: string;
    help?: string;
    aliases?: string[];
    secret?: boolean;
}

interface RuntimeFallbackEntry {
    provider?: string;
    model_name?: string;
    when?: string[];
}

interface RuntimeStatus {
    provider: string;
    model_name?: string;
    status?: string;
    has_key?: boolean;
    endpoint?: string;
    operation_urls?: Record<string, string>;
    endpoint_env?: string;
    endpoint_source?: string;
    runtime_model_name?: string;
    model_env?: string | null;
    model_source?: string;
    api_key_env?: string;
    api_key_source?: string;
    proxy_mode?: string;
    runtime_source?: string;
    db_effective_config_id?: string | null;
    db_effective_config_name?: string | null;
    db_keyed_enabled_config_count?: number;
    db_enabled_endpoint_count?: number;
    db_candidate_config_ids?: string[];
    custom_proxy_configured?: boolean;
    health_status?: HealthStatus | string;
    health_checked_at?: string;
    health_cached_at?: string;
    health_latency_ms?: number | null;
    health_error?: string | null;
    fallback?: RuntimeFallbackEntry[];
    failover?: {
        active?: boolean;
        reason?: string;
        selected_provider?: string;
        selected_model_name?: string;
    };
    failover_active?: boolean;
    failover_selected_provider?: string;
    failover_reason?: string;
    failover_selected_model_name?: string;
    issues?: string[];
}

interface ProviderHealth {
    [key: string]: any;
    success?: boolean;
    provider: string;
    model_name?: string | null;
    status?: HealthStatus | string;
    latency_ms?: number | null;
    checked_at?: string;
    health?: {
        ok?: boolean;
        reachable?: boolean;
        auth_ok?: boolean;
        status_code?: number | null;
        url?: string | null;
        error?: string | null;
        urls_tried?: string[];
        [key: string]: any;
    };
}

interface ProviderHealthMonitorState {
    enabled?: boolean;
    loop_running?: boolean;
    loop_started_at?: string | null;
    redis_configured?: boolean;
    last_sweep_source?: string | null;
    last_sweep_started_at?: string | null;
    last_sweep_completed_at?: string | null;
    last_sweep_duration_ms?: number | null;
    last_summary?: {
        total?: number;
        ok?: number;
        error?: number;
        no_key?: number;
        blocked_region?: number;
        connectivity_ok?: number;
        unknown?: number;
    } | null;
    last_error?: string | null;
}

interface ApiConfigTest {
    ok?: boolean;
    status?: HealthStatus | string;
    reachable?: boolean;
    auth_ok?: boolean;
    status_code?: number | null;
    latency_ms?: number | null;
    url?: string | null;
    error?: string | null;
    provider?: string | null;
    model_name?: string | null;
    method?: string;
    checked_at?: string;
    urls_tried?: string[];
    key_source?: 'db' | 'runtime' | 'missing' | string;
    key_env?: string | null;
    used_runtime_key?: boolean;
    endpoint_source?: 'db' | 'runtime' | 'missing' | string;
    used_runtime_endpoint?: boolean;
    runtime_endpoint?: string | null;
    runtime_endpoint_source?: string | null;
    runtime_endpoint_env?: string | null;
    runtime_model_name?: string | null;
    endpoint_matches_runtime?: boolean | null;
    config_enabled?: boolean;
    is_runtime_effective?: boolean;
    runtime_effective_config_id?: string | null;
    runtime_effective_config_name?: string | null;
    real_generation?: boolean;
    billable?: boolean;
    output_type?: string | null;
}

interface ApiConfigTestResponse {
    success?: boolean;
    test?: ApiConfigTest;
    provider_health?: ProviderHealth;
}

interface ApiConfigsResponse {
    success: boolean;
    api_configs?: ApiConfig[];
    configs?: ApiConfig[];
    providers?: ProviderMeta[];
    runtime_status?: RuntimeStatus[];
    provider_health?: ProviderHealth[];
    monitor_state?: ProviderHealthMonitorState;
}

interface ApiConfigFormState {
    config_id?: string;
    name: string;
    provider: string;
    endpoint: string;
    api_key: string;
    api_key_preview?: string;
    has_key?: boolean;
    bulk_api_keys: string;
    bulk_mode: boolean;
    model_name: string;
    model_bindings: ApiModelBinding[];
    proxy_mode: string;
    custom_proxy: string;
    request_template: string;
    headers: string;
    extra_values: Record<string, string>;
    category: string;
    enabled: boolean;
}

interface ApiConfigWriteResponse {
    success: boolean;
    api_config?: ApiConfig;
    api_configs?: ApiConfig[];
    created?: number;
    skipped_existing?: number;
    active_config_id?: string;
    deleted?: boolean;
    env_refreshed?: boolean | null;
    disabled_conflicting_config_ids?: string[];
    disabled_config_ids?: string[];
}

interface TrashFile {
    file_id: string;
    file_name?: string;
    file_type?: string;
    file_url?: string;
    file_path?: string;
    disk_path?: string;
    disk_exists?: boolean;
    disk_size_bytes?: number;
    purge_eligible?: boolean;
    purge_blocked_reason?: string;
    user_id?: string;
    project_id?: string;
    episode_id?: string;
    deleted_at?: string;
    media_name?: string;
    media_library_count?: number;
    legacy_reference_count?: number;
    legacy_reference_counts?: Record<string, number>;
    restore_targets?: string[];
    restore_warnings?: string[];
    restore_visibility?: 'normal' | 'file_record_only' | 'missing_disk' | string;
    download_available?: boolean;
    download_url?: string;
    preview_unavailable_reason?: string;
}

interface TrashRestoreResponse {
    success: boolean;
    file?: TrashFile;
    restore_targets?: string[];
    restore_warnings?: string[];
    restore_visibility?: string;
}

interface TrashFilesResponse {
    success: boolean;
    items?: TrashFile[];
    total?: number;
    limit?: number;
    offset?: number;
    disk_bytes?: number;
}

interface TrashPurgeResponse {
    success: boolean;
    file_id?: string;
    purged?: number;
    freed_bytes?: number;
    removed_disk?: boolean;
    deleted_db_record?: boolean;
    errors?: Array<{ file_id?: string; error?: string }>;
}

interface ApiConfigImportResponse {
    success: boolean;
    dry_run?: boolean;
    imported?: number;
    skipped?: number;
    total?: number;
    created?: number;
    updated?: number;
    invalid?: number;
    updated_existing?: number;
    env_keys_imported?: number;
    env_keys_missing?: number;
    env_keys_existing?: number;
    env_keys_skipped_provider_claimed?: number;
    enabled_existing?: number;
    env_refreshed?: boolean | null;
}

interface ApiConfigReloadEnvResponse {
    success: boolean;
    env_refreshed?: boolean;
    loaded?: number;
    loaded_providers?: string[];
    health_cache_invalidated?: string[];
    error?: string | null;
}

interface ProviderHealthSweepResponse {
    success: boolean;
    provider_health?: ProviderHealth[];
    summary?: {
        total?: number;
        ok?: number;
        error?: number;
        no_key?: number;
        blocked_region?: number;
        connectivity_ok?: number;
        unknown?: number;
    };
    monitor_state?: ProviderHealthMonitorState;
}

interface ProviderHealthCacheResponse extends ProviderHealthSweepResponse {
    settings?: {
        enabled?: boolean;
        initial_delay_seconds?: number;
        interval_seconds?: number;
        ttl_seconds?: number;
        concurrency?: number;
    };
}

interface ApiConfigBatchTestItem {
    config_id: string;
    name?: string;
    provider?: string;
    model_name?: string;
    enabled?: boolean;
    test?: ApiConfigTest;
}

interface ApiConfigBatchTestResponse {
    success: boolean;
    config_tests?: ApiConfigBatchTestItem[];
    summary?: {
        total?: number;
        ok?: number;
        error?: number;
        no_key?: number;
        auth_error?: number;
        connectivity_ok?: number;
    };
}

interface ApiConfigRepairConflict {
    provider?: string;
    kept_config_id?: string;
    disabled_config_ids?: string[];
    keyed_enabled_count?: number;
}

interface ApiConfigRepairConflictsResponse {
    success: boolean;
    dry_run?: boolean;
    conflicts?: ApiConfigRepairConflict[];
    total_conflicts?: number;
    total_disabled?: number;
    would_disable?: number;
    total_merged_cards?: number;
    would_merge?: number;
    deleted_duplicate_config_ids?: string[];
    total_absorbed_placeholder_groups?: number;
    would_absorb_placeholders?: number;
    deleted_placeholder_config_ids?: string[];
    env_refreshed?: boolean | null;
}

const CATEGORY_LABELS: Record<string, string> = {
    text: '文本生成',
    image: '图像生成',
    video: '视频生成',
    audio: '语音生成',
    other: '其他',
};

const API_CONFIG_CATEGORY_ORDER = ['text', 'image', 'video', 'audio', 'other'];
const FRONTEND_IMAGE_PROVIDER_ORDER = ['gemini-image', 'doubao'];
const FRONTEND_IMAGE_PROVIDER_SET = new Set(FRONTEND_IMAGE_PROVIDER_ORDER);

const RUNTIME_KEY_IMPORT_BODY = {
    copy_runtime_env_keys: true,
    update_existing_empty_keys: true,
    enable_copied_keys: true,
};

function normalizeProvider(provider: string | undefined | null): string {
    return String(provider || '').trim().toLowerCase();
}

const DEFAULT_MODEL_USAGE_SCOPES: ModelUsageScopeMeta[] = [
    { scope: 'workflow', label: '流程化制作' },
    { scope: 'studio', label: '自由创作' },
];

function normalizeModelUsageScope(scope: string | undefined | null): string {
    const value = String(scope || '').trim().toLowerCase();
    if (['studio', 'free', 'free_creation', 'free-creation', 'canvas'].includes(value)) return 'studio';
    return 'workflow';
}

function modelUsageScopeLabel(scope: string | undefined | null, scopes: ModelUsageScopeMeta[] = DEFAULT_MODEL_USAGE_SCOPES): string {
    const normalized = normalizeModelUsageScope(scope);
    return scopes.find(item => normalizeModelUsageScope(item.scope) === normalized)?.label
        || DEFAULT_MODEL_USAGE_SCOPES.find(item => item.scope === normalized)?.label
        || normalized;
}

function modelBindingKey(binding: Pick<ApiModelBinding, 'operation' | 'scope'>): string {
    return `${normalizeModelUsageScope(binding.scope)}::${String(binding.operation || '').trim().toLowerCase()}`;
}

function modelBindingOptionMatches(option: ApiModelBinding, binding: ApiModelBinding): boolean {
    return String(option.operation || '').trim().toLowerCase() === String(binding.operation || '').trim().toLowerCase()
        && normalizeModelUsageScope(option.scope) === normalizeModelUsageScope(binding.scope);
}

function publicApiModelBindingLabel(_providerRaw: string, binding: ApiModelBinding): string {
    const displayName = String(binding.display_name || binding.default_display_name || '').trim();
    const description = String(binding.description || binding.default_description || '').trim();
    if (displayName) return description ? `${displayName} · ${description}` : displayName;
    return String(binding.label || binding.operation || binding.model_name || '').trim();
}

function applyPublicApiModelBindingLabels(provider: string, bindings: ApiModelBinding[]): ApiModelBinding[] {
    return bindings.map(binding => ({
        ...binding,
        label: publicApiModelBindingLabel(provider, binding),
    }));
}

function uniqueModelBindingsForDisplay(bindings: ApiModelBinding[]): ApiModelBinding[] {
    const seen = new Set<string>();
    return bindings.filter(binding => {
        const key = [
            normalizeModelUsageScope(binding.scope),
            String(binding.label || '').trim().toLowerCase(),
            String(binding.model_name || '').trim().toLowerCase(),
        ].join('::');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function runtimeStatusKey(provider: string | undefined | null, modelName?: string | null): string {
    const providerKey = normalizeProvider(provider);
    const modelKey = String(modelName || '').trim().toLowerCase();
    return `${providerKey}::${modelKey}`;
}

function providerHealthKey(provider: string | undefined | null, modelName?: string | null): string {
    const providerKey = normalizeProvider(provider);
    const modelKey = String(modelName || '').trim().toLowerCase();
    return modelKey ? `${providerKey}::${modelKey}` : providerKey;
}

function putProviderHealth(
    map: Record<string, ProviderHealth>,
    item: ProviderHealth,
    fallbackModelName?: string | null,
) {
    const provider = normalizeProvider(item.provider);
    if (!provider) return;
    const modelName = item.model_name || fallbackModelName || null;
    map[providerHealthKey(provider, modelName)] = item;
    if (!modelName) map[provider] = item;
}

function buildProviderHealthMap(rows: ProviderHealth[] = []): Record<string, ProviderHealth> {
    const next: Record<string, ProviderHealth> = {};
    rows.forEach(item => {
        putProviderHealth(next, item);
    });
    return next;
}

function configTestFromProviderHealth(health: ProviderHealth): ApiConfigTest | undefined {
    const inner = (health && typeof health.health === 'object' && health.health) || {};
    if (!inner.real_generation) return undefined;
    const provider = normalizeProvider(health.provider);
    if (!provider) return undefined;
    const modelName = health.model_name || null;
    const statusCode = typeof inner.status_code === 'number' ? inner.status_code : null;
    const isOk = health.status === 'ok' && Boolean(inner.ok);
    const errorText = typeof inner.error === 'string' && inner.error ? inner.error : '';
    let status: string;
    if (isOk) {
        status = 'generation_ok';
    } else if (errorText === 'No API key configured') {
        status = 'no_key';
    } else {
        status = 'error';
    }
    return {
        ok: isOk,
        status,
        reachable: statusCode !== null,
        auth_ok: statusCode !== null && statusCode !== 401 && statusCode !== 403,
        status_code: statusCode,
        url: inner.url || null,
        error: errorText || null,
        provider,
        model_name: modelName,
        method: inner.method || 'POST',
        checked_at: health.checked_at || new Date().toISOString(),
        real_generation: true,
        billable: inner.billable !== false,
        output_type: inner.output_type || null,
        latency_ms: typeof health.latency_ms === 'number' ? health.latency_ms : null,
    };
}

function buildConfigTestMapFromHealth(
    rows: ApiConfig[],
    healthRows: ProviderHealth[] = [],
): Record<string, ApiConfigTest> {
    const result: Record<string, ApiConfigTest> = {};
    healthRows.forEach(health => {
        const test = configTestFromProviderHealth(health);
        if (!test) return;
        const provider = normalizeProvider(health.provider);
        const modelName = test.model_name || '';
        const matched = rows.find(row => {
            if (normalizeProvider(row.provider) !== provider) return false;
            const rowModel = String(row.model_name || '').trim();
            if (modelName) return rowModel === modelName;
            return !rowModel;
        });
        if (matched?.config_id) {
            result[matched.config_id] = test;
        }
    });
    return result;
}

function providerHealthFrom(
    map: Record<string, ProviderHealth>,
    provider: string | undefined | null,
    modelName?: string | null,
): ProviderHealth | undefined {
    const providerKey = normalizeProvider(provider);
    if (!providerKey) return undefined;
    const exact = map[providerHealthKey(providerKey, modelName)];
    const providerLevel = map[providerKey];
    const providerLevelVerified = Boolean(
        providerLevel?.status === 'ok'
        && providerLevel?.health?.ok
        && providerLevel?.health?.real_generation
    );
    const exactVerified = Boolean(
        exact?.status === 'ok'
        && exact?.health?.ok
        && exact?.health?.real_generation
    );
    if (providerLevelVerified && !exactVerified) return providerLevel;
    return exact || providerLevel;
}

function providerHealthFromRealGenerationTest(config: ApiConfig, test?: ApiConfigTest): ProviderHealth | undefined {
    if (!test?.real_generation) return undefined;
    const provider = normalizeProvider(test.provider || config.provider);
    if (!provider) return undefined;
    const status = healthStatusFromConfigTest(test) || 'unknown';
    return {
        success: true,
        provider,
        model_name: test.model_name || config.model_name || null,
        status,
        latency_ms: test.latency_ms ?? null,
        checked_at: test.checked_at || new Date().toISOString(),
        health: {
            ok: Boolean(test.ok),
            reachable: Boolean(test.reachable),
            auth_ok: Boolean(test.auth_ok),
            status_code: test.status_code ?? null,
            url: test.url || null,
            error: test.error || null,
            method: test.method || 'POST',
            real_generation: true,
            billable: test.billable ?? true,
            output_type: test.output_type || null,
        },
    };
}

function formatEndpoint(endpoint?: string): string {
    if (!endpoint) return '-';
    return endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function endpointIdentity(endpoint?: string): string {
    return String(endpoint || '').trim().replace(/\/+$/, '').toLowerCase();
}

function endpointMismatch(left?: string, right?: string): boolean {
    const leftKey = endpointIdentity(left);
    const rightKey = endpointIdentity(right);
    return Boolean(leftKey && rightKey && leftKey !== rightKey);
}

function formatTime(value?: string): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN', { hour12: false });
}

function statusView(status: HealthStatus) {
    const map = {
        ok: {
            label: 'ok',
            text: '就绪',
            dot: 'bg-g400',
            badge: 'bg-g50 text-g400',
            icon: <CheckCircle2 className="w-3.5 h-3.5" />,
        },
        error: {
            label: 'error',
            text: '异常',
            dot: 'bg-r400',
            badge: 'bg-r50 text-r400',
            icon: <AlertCircle className="w-3.5 h-3.5" />,
        },
        no_key: {
            label: 'no_key',
            text: '未配置',
            dot: 'bg-r400',
            badge: 'bg-r50 text-r400',
            icon: <KeyRound className="w-3.5 h-3.5" />,
        },
        blocked_region: {
            label: 'blocked_region',
            text: '地区受限',
            dot: 'bg-y400',
            badge: 'bg-y50 text-y400',
            icon: <AlertCircle className="w-3.5 h-3.5" />,
        },
        connectivity_ok: {
            label: 'connectivity_ok',
            text: '连接可达',
            dot: 'bg-y400',
            badge: 'bg-y50 text-y400',
            icon: <Activity className="w-3.5 h-3.5" />,
        },
        unknown: {
            label: 'unknown',
            text: '未检查',
            dot: 'bg-y400',
            badge: 'bg-y50 text-y400',
            icon: <Activity className="w-3.5 h-3.5" />,
        },
    };
    return map[status];
}

function healthStatusFrom(health?: ProviderHealth, runtime?: RuntimeStatus, configHasKey?: boolean): HealthStatus {
    const hasKey = typeof runtime?.has_key === 'boolean' ? runtime.has_key : configHasKey;
    const status = String(health?.status || runtime?.health_status || '').toLowerCase();
    if (status === 'ok') return 'ok';
    if (status === 'error') return 'error';
    if (status === 'no_key') return hasKey ? 'unknown' : 'no_key';
    if (status === 'blocked_region') return 'blocked_region';
    if (status === 'connectivity_ok') return 'connectivity_ok';
    if (hasKey === false) return 'no_key';
    return 'unknown';
}

function healthStatusFromResult(result?: ProviderHealth): HealthStatus {
    const status = String(result?.status || '').toLowerCase();
    if (
        status === 'ok'
        || status === 'error'
        || status === 'no_key'
        || status === 'blocked_region'
        || status === 'connectivity_ok'
    ) return status;
    if (result?.health?.auth_ok === true) return 'ok';
    if (result?.health?.auth_ok === false) return 'error';
    return 'unknown';
}

function healthStatusFromConfigTest(test?: ApiConfigTest): HealthStatus | undefined {
    if (!test) return undefined;
    if (test.ok) return 'ok';
    if (isNoKeyTest(test)) return 'no_key';
    if (isUnsupportedRealGenerationTest(test)) return 'connectivity_ok';
    if (isConnectivityOnlyConfigTest(test)) return 'connectivity_ok';
    const status = String(test.status || '').toLowerCase();
    if (status === 'blocked_region') return 'blocked_region';
    const errorText = String(test.error || '').toLowerCase();
    if (errorText.includes('user location is not supported')) return 'blocked_region';
    return 'error';
}

function mergedHealthStatus(
    health: ProviderHealth | undefined,
    runtime: RuntimeStatus | undefined,
    hasEffectiveKey: boolean,
    configTest?: ApiConfigTest,
): HealthStatus {
    const runtimeStatus = healthStatusFrom(health, runtime, hasEffectiveKey);
    if (runtimeStatus === 'ok') return 'ok';

    const configStatus = healthStatusFromConfigTest(configTest);
    if (!configStatus) return runtimeStatus;
    if (configStatus === 'ok') return 'ok';
    if (configStatus === 'blocked_region' || configStatus === 'connectivity_ok') return configStatus;
    if (runtimeStatus === 'unknown') return configStatus;
    if (hasEffectiveKey) return runtimeStatus;
    if (runtimeStatus === 'no_key' && configStatus === 'error') return 'error';
    return runtimeStatus;
}

function categoryFromProviderMeta(meta: ProviderMeta): string {
    const direct = String(meta.default_category || '').toLowerCase();
    if (CATEGORY_LABELS[direct]) return direct;
    const fromPreset = (meta.preset_categories || [])
        .map(item => String(item || '').toLowerCase())
        .find(item => CATEGORY_LABELS[item]);
    if (fromPreset) return fromPreset;
    const capabilities = (meta.capabilities || []).map(item => String(item || '').toLowerCase());
    if (capabilities.includes('audio')) return 'audio';
    if (capabilities.includes('video')) return 'video';
    if (capabilities.includes('image')) return 'image';
    return 'text';
}

function bestConfigForProvider(
    configs: ApiConfig[],
    providerRaw: string,
    runtime?: RuntimeStatus,
): ApiConfig | undefined {
    const provider = normalizeProvider(providerRaw);
    const matches = configs.filter(config => normalizeProvider(config.provider) === provider);
    if (runtime?.db_effective_config_id) {
        const runtimeConfig = matches.find(config => config.config_id === runtime.db_effective_config_id);
        if (runtimeConfig) return runtimeConfig;
    }
    return matches.find(config => config.enabled !== false && Boolean(config.has_key ?? config.api_key_encrypted))
        || matches.find(config => Boolean(config.has_key ?? config.api_key_encrypted))
        || matches.find(config => config.enabled !== false)
        || matches[0];
}

function apiConfigDisplayItemsForCategory(
    category: string,
    items: ApiConfig[],
    runtimeByProvider: Map<string, RuntimeStatus>,
): ApiConfig[] {
    if (category !== 'image') return items;

    const byProvider = new Map<string, ApiConfig[]>();
    const imageItems = items.filter(config => {
        const provider = normalizeProvider(config.provider);
        if (!FRONTEND_IMAGE_PROVIDER_SET.has(provider)) return false;
        byProvider.set(provider, [...(byProvider.get(provider) || []), config]);
        return true;
    });

    return [...imageItems].sort((a, b) => {
        const providerA = normalizeProvider(a.provider);
        const providerB = normalizeProvider(b.provider);
        const providerOrder = FRONTEND_IMAGE_PROVIDER_ORDER.indexOf(providerA) - FRONTEND_IMAGE_PROVIDER_ORDER.indexOf(providerB);
        if (providerOrder !== 0) return providerOrder;

        const activeId = bestConfigForProvider(
            byProvider.get(providerA) || [],
            providerA,
            runtimeByProvider.get(providerA),
        )?.config_id;
        const activeA = a.config_id === activeId;
        const activeB = b.config_id === activeId;
        if (activeA !== activeB) return activeA ? -1 : 1;

        const enabledA = a.enabled !== false;
        const enabledB = b.enabled !== false;
        if (enabledA !== enabledB) return enabledA ? -1 : 1;

        return String(a.name || a.config_id || '').localeCompare(String(b.name || b.config_id || ''));
    });
}

function apiConfigCardTitle(config: ApiConfig, meta?: ProviderMeta, category?: string): string {
    const provider = normalizeProvider(config.provider);
    const configuredName = String(config.name || '').trim();
    if (configuredName) return configuredName;
    if (category === 'image' && provider === 'gemini-image') return 'Laozhang.ai / Gemini 图像';
    if (category === 'image' && provider === 'doubao') return '火山引擎 / 豆包图像';
    return config.name || meta?.label || provider;
}

function providerQuickHealthFrom(
    map: Record<string, ProviderHealth>,
    provider: string | undefined | null,
    modelName?: string | null,
): ProviderHealth | undefined {
    const providerKey = normalizeProvider(provider);
    if (!providerKey) return undefined;
    const exact = map[providerHealthKey(providerKey, modelName)];
    const providerLevel = map[providerKey];
    const providerLevelVerified = Boolean(
        providerLevel?.status === 'ok'
        && providerLevel?.health?.ok
        && providerLevel?.health?.real_generation
    );
    if (providerLevelVerified && (!exact || exact.status === 'connectivity_ok' || exact.status === 'unknown')) {
        return providerLevel;
    }
    return exact || providerLevel;
}

function jsonRecordFrom(value: ApiConfig['request_template']): JsonRecord {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {
            return {};
        }
    }
    return {};
}

function jsonTextFrom(value: ApiConfig['request_template']): string {
    const record = jsonRecordFrom(value);
    return Object.keys(record).length ? JSON.stringify(record, null, 2) : '';
}

function parseJsonText(value: string, label: string): JsonRecord {
    const text = value.trim();
    if (!text) return {};
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`${label} 必须是 JSON object`);
        }
        return parsed;
    } catch (err: any) {
        throw new Error(`${label} 不是有效 JSON：${err?.message || 'parse error'}`);
    }
}

function extraFieldKeys(field: ProviderExtraField): string[] {
    const keys = [field.field, ...(field.aliases || [])]
        .map(item => String(item || '').trim())
        .filter(Boolean);
    return Array.from(new Set(keys));
}

function extraSourceForField(
    field: ProviderExtraField,
    requestTemplate: JsonRecord,
    headers: JsonRecord,
): JsonRecord {
    return field.target === 'headers' ? headers : requestTemplate;
}

function extraValuesFromRecords(
    fields: ProviderExtraField[] = [],
    requestTemplate: JsonRecord = {},
    headers: JsonRecord = {},
): Record<string, string> {
    const values: Record<string, string> = {};
    fields.forEach(field => {
        const source = extraSourceForField(field, requestTemplate, headers);
        for (const key of extraFieldKeys(field)) {
            if (source[key] !== undefined && source[key] !== null) {
                values[field.field] = String(source[key]);
                break;
            }
        }
    });
    return values;
}

function extraFieldValueFromForm(form: ApiConfigFormState, field: ProviderExtraField): string {
    if (form.extra_values[field.field] !== undefined) return form.extra_values[field.field];
    const requestTemplate = jsonRecordFrom(form.request_template);
    const headers = jsonRecordFrom(form.headers);
    return extraValuesFromRecords([field], requestTemplate, headers)[field.field] || '';
}

function applyExtraValuesToRecords(
    fields: ProviderExtraField[] = [],
    values: Record<string, string>,
    requestTemplate: JsonRecord,
    headers: JsonRecord,
) {
    fields.forEach(field => {
        const source = extraSourceForField(field, requestTemplate, headers);
        const value = String(values[field.field] || '').trim();
        if (value) {
            source[field.field] = value;
            return;
        }
        extraFieldKeys(field).forEach(key => {
            delete source[key];
        });
    });
}

function normalizeApiModelBindings(
    bindings: ApiModelBinding[] | undefined,
    legacyModelName: string = '',
    options: ApiModelBinding[] = [],
): ApiModelBinding[] {
    const findOption = (modelName: string, rawOperation: string, scope: string) => {
        const optionByOperation = options.find(candidate => (
            String(candidate.operation || '').trim().toLowerCase() === rawOperation
            && normalizeModelUsageScope(candidate.scope) === scope
        ));
        const optionByModel = options.find(candidate => (
            String(candidate.model_name || '').trim().toLowerCase() === modelName.toLowerCase()
            && normalizeModelUsageScope(candidate.scope) === scope
        ));
        const legacyOption = options.find(candidate => String(candidate.operation || '').trim().toLowerCase() === rawOperation)
            || options.find(candidate => String(candidate.model_name || '').trim().toLowerCase() === modelName.toLowerCase());
        return optionByOperation || (!optionByOperation ? optionByModel : undefined) || legacyOption;
    };
    const source = Array.isArray(bindings) && bindings.length
        ? bindings
        : legacyModelName
            ? [{
                operation: options.find(item => item.model_name === legacyModelName)?.operation || 'default',
                label: options.find(item => item.model_name === legacyModelName)?.label || '默认操作',
                model_name: legacyModelName,
                scope: 'workflow',
            }]
            : [];
    const normalized = new Map<string, ApiModelBinding>();
    source.forEach(item => {
        const modelName = String(item?.model_name || '').trim();
        const rawOperation = String(item?.operation || '').trim().toLowerCase();
        const scope = normalizeModelUsageScope(item?.scope);
        if (!modelName || !rawOperation) return;
        const option = findOption(modelName, rawOperation, scope);
        const optionByOperation = Boolean(option && String(option.operation || '').trim().toLowerCase() === rawOperation);
        const operation = option && (rawOperation === 'default' || !optionByOperation) ? option.operation : rawOperation;
        if (!operation) return;
        const normalizedScope = normalizeModelUsageScope(option?.scope || scope);
        const normalizedBinding: ApiModelBinding = {
            operation,
            label: String(option?.label || item.label || operation),
            model_name: modelName,
            scope: normalizedScope,
            scope_label: item.scope_label || option?.scope_label || modelUsageScopeLabel(normalizedScope),
            front_model_key: String(option?.front_model_key || item.front_model_key || '').trim(),
            default_display_name: String(option?.default_display_name || item.default_display_name || '').trim(),
            default_description: String(option?.default_description || item.default_description || '').trim(),
            display_name: String(item.display_name || '').trim(),
            description: String(item.description || '').trim(),
            published: item.published !== false,
        };
        normalizedBinding.label = publicApiModelBindingLabel('', normalizedBinding);
        normalized.set(`${normalizedScope}::${operation}`, normalizedBinding);
    });
    return Array.from(normalized.values());
}

function mergeMissingKnownModelBindings(
    bindings: ApiModelBinding[],
    options: ApiModelBinding[] = [],
): ApiModelBinding[] {
    if (!options.length) return bindings;
    const byOperation = new Map(bindings.map(binding => [modelBindingKey(binding), binding]));
    options.forEach(option => {
        const key = modelBindingKey(option);
        if (!byOperation.has(key)) byOperation.set(key, option);
    });
    return Array.from(byOperation.values());
}

function providerRequiresCompleteModelBindings(provider: string): boolean {
    return ['deepseek', 'gemini-text', 'gemini-image', 'doubao', 'seedance', 'dashscope', 'minimax'].includes(normalizeProvider(provider));
}

function defaultModelBindings(meta?: ProviderMeta): ApiModelBinding[] {
    return normalizeApiModelBindings(meta?.model_binding_options, meta?.default_model_name || '', meta?.model_binding_options || []);
}

function apiConfigModelBindings(config: ApiConfig, meta?: ProviderMeta): ApiModelBinding[] {
    const bindings = normalizeApiModelBindings(
        config.model_bindings,
        config.model_name || '',
        meta?.model_binding_options || [],
    );
    const provider = normalizeProvider(config.provider);
    const complete = providerRequiresCompleteModelBindings(provider)
        ? mergeMissingKnownModelBindings(bindings, meta?.model_binding_options || [])
        : bindings;
    return applyPublicApiModelBindingLabels(provider, complete);
}

function emptyConfigForm(): ApiConfigFormState {
    return {
        name: '',
        provider: '',
        endpoint: '',
        api_key: '',
        api_key_preview: '',
        has_key: false,
        bulk_api_keys: '',
        bulk_mode: false,
        model_name: '',
        model_bindings: [],
        proxy_mode: 'direct',
        custom_proxy: '',
        request_template: '',
        headers: '',
        extra_values: {},
        category: 'text',
        enabled: true,
    };
}

function providerMetaToForm(meta: ProviderMeta): ApiConfigFormState {
    const provider = normalizeProvider(meta.provider);
    return {
        ...emptyConfigForm(),
        name: meta.default_config_name || meta.label || provider,
        provider,
        endpoint: meta.default_endpoint || '',
        model_name: meta.default_model_name || '',
        model_bindings: defaultModelBindings(meta),
        proxy_mode: meta.default_proxy_mode || 'direct',
        category: categoryFromProviderMeta(meta),
    };
}

function configToForm(
    config: ApiConfig,
    extraFields: ProviderExtraField[] = [],
    bindingOptions: ApiModelBinding[] = [],
): ApiConfigFormState {
    const requestTemplate = jsonRecordFrom(config.request_template);
    const headers = jsonRecordFrom(config.headers);
    const normalizedBindings = normalizeApiModelBindings(
        config.model_bindings,
        config.model_name || '',
        bindingOptions,
    );
    const completedBindings = providerRequiresCompleteModelBindings(config.provider)
        ? mergeMissingKnownModelBindings(normalizedBindings, bindingOptions)
        : normalizedBindings;
    const modelBindings = applyPublicApiModelBindingLabels(config.provider, completedBindings);
    return {
        config_id: config.config_id,
        name: config.name || '',
        provider: config.provider || '',
        endpoint: config.endpoint || '',
        api_key: '',
        api_key_preview: config.api_key_preview || '',
        has_key: Boolean(config.has_key ?? config.api_key_encrypted),
        bulk_api_keys: '',
        bulk_mode: false,
        model_name: config.model_name || '',
        model_bindings: modelBindings,
        proxy_mode: config.proxy_mode || 'direct',
        custom_proxy: config.custom_proxy || '',
        request_template: jsonTextFrom(config.request_template),
        headers: jsonTextFrom(config.headers),
        extra_values: extraValuesFromRecords(extraFields, requestTemplate, headers),
        category: config.category || apiConfigCategories(config)[0],
        enabled: config.enabled !== false,
    };
}

function envRefreshMessage(result: { env_refreshed?: boolean | null }, action: string): string {
    if (result.env_refreshed === false) return `${action}已保存，但运行时环境刷新失败`;
    if (result.env_refreshed === true) return `${action}已保存并生效`;
    return `${action}已保存`;
}

function conflictDisableSuffix(result: { disabled_conflicting_config_ids?: string[] }): string {
    const count = result.disabled_conflicting_config_ids?.length || 0;
    return count > 0 ? `，已自动关闭 ${count} 条同 provider 冲突配置` : '';
}

function activationDisableSuffix(result: { disabled_config_ids?: string[] }): string {
    const count = result.disabled_config_ids?.length || 0;
    return count > 0 ? `，已自动关闭 ${count} 条同 provider 旧 Key` : '';
}

function splitBulkApiKeys(value: string): string[] {
    return Array.from(new Set(
        String(value || '')
            .split(/[\n,，；;]+/)
            .map(item => item.trim())
            .filter(Boolean)
    ));
}

function formatBytes(bytes?: number): string {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
    }
    return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function trashPreviewUrl(item: TrashFile): string {
    const url = String(item.file_url || '').trim();
    if (!url) return '';
    if (url.startsWith('/storage/') || url.startsWith('/uploads/') || url.startsWith('/api/files/')) {
        return url;
    }
    if (/^https?:\/\//i.test(url)) {
        return url;
    }
    return '';
}

function isPreviewableTrashImage(item: TrashFile): boolean {
    if (!item.disk_exists) return false;
    const type = String(item.file_type || '').toLowerCase();
    const url = trashPreviewUrl(item).split('?', 1)[0].toLowerCase();
    return type === 'image' || /\.(webp|png|jpe?g|gif|bmp|svg)$/i.test(url);
}

function trashDownloadUrl(item: TrashFile): string {
    if (item.download_url) return item.download_url;
    if (!item.file_id) return '';
    return `/api/admin/trash/files/${encodeURIComponent(item.file_id)}/download`;
}

function trashDownloadName(item: TrashFile): string {
    const raw = String(item.media_name || item.file_name || item.file_url || item.file_path || item.file_id || 'download');
    const tail = raw.split(/[\\/]/).filter(Boolean).pop() || raw;
    return tail.replace(/[\\/:*?"<>|]+/g, '_') || 'download';
}

function restoreVisibilityClass(item: TrashFile): string {
    if (item.restore_visibility === 'normal') return 'border-g75 bg-g50 text-g400';
    if (item.restore_visibility === 'missing_disk') return 'border-r75 bg-r50 text-r400';
    return 'border-y200 bg-y50 text-y400';
}

function restoreVisibilityText(item: TrashFile): string {
    if (item.restore_visibility === 'normal') return '可恢复到关联位置';
    if (item.restore_visibility === 'missing_disk') return '缺少磁盘文件';
    if (item.restore_visibility === 'file_record_only') return '可能仅恢复记录';
    return '恢复状态未知';
}

const RUNTIME_ISSUE_LABELS: Record<string, string> = {
    missing_key: '缺少 Key',
    missing_endpoint: '缺少 Endpoint',
    db_multiple_keyed_enabled_configs: '多条启用配置共享同一 Key',
    db_endpoint_conflict: '启用配置 Endpoint 冲突',
    custom_proxy_missing: '自定义代理未填写',
    health_error: '健康检查异常',
    health_no_key: '健康检查缺少 Key',
};

const FAILOVER_REASON_LABELS: Record<string, string> = {
    missing_key: '主 provider 缺少 Key',
    health_error: '主 provider 健康检查异常',
};

function runtimeIssueText(issues?: string[]): string {
    if (!Array.isArray(issues) || !issues.length) return '';
    return issues.map(issue => RUNTIME_ISSUE_LABELS[issue] || issue).join('，');
}

function failoverReasonText(reason?: string): string {
    if (!reason) return '-';
    return FAILOVER_REASON_LABELS[reason] || reason;
}

function fallbackEntryText(entry: RuntimeFallbackEntry): string {
    const provider = normalizeProvider(entry.provider);
    const model = String(entry.model_name || '').trim();
    return model ? `${provider} / ${model}` : provider;
}

function sourceText(source?: string | null, env?: string | null): string {
    if (!source) return '-';
    if (source === 'missing') return '未配置';
    if (source === 'preset') return '预设';
    return env || source;
}

function keySourceText(runtime?: RuntimeStatus, configHasKey?: boolean): string {
    if (configHasKey) return 'DB 已保存 Key';
    if (runtime?.has_key) {
        const source = sourceText(runtime.api_key_source, runtime.api_key_env);
        return source && source !== '-' ? `运行时环境：${source}` : '运行时环境有 Key';
    }
    return '未配置 Key';
}

function configTestEndpointText(test?: ApiConfigTest): string {
    if (!test) return '';
    const parts: string[] = [];
    if (test.used_runtime_endpoint) {
        parts.push(`Endpoint 来源：运行时 ${sourceText(test.runtime_endpoint_source, test.runtime_endpoint_env)}`);
    } else if (test.endpoint_source === 'db') {
        parts.push('Endpoint 来源：DB 记录');
    } else if (test.endpoint_source === 'missing') {
        parts.push('Endpoint 未配置');
    } else if (test.endpoint_source) {
        parts.push(`Endpoint 来源：${test.endpoint_source}`);
    }
    if (test.endpoint_matches_runtime === false) {
        parts.push('与运行时 Endpoint 不一致');
    }
    return parts.join('；');
}

function configTestRuntimeWarning(test?: ApiConfigTest): string {
    if (!test) return '';
    if (test.config_enabled === false) {
        return '此条 DB 配置未启用，真实调用不会使用它';
    }
    if (test.is_runtime_effective === false) {
        const effective = test.runtime_effective_config_name || test.runtime_effective_config_id;
        return effective
            ? `真实调用当前使用：${effective}`
            : '此条 DB 配置未成为运行时生效配置';
    }
    return '';
}

function dbKeyStateText(hasSavedKey: boolean, runtimeHasKey: boolean): string {
    if (hasSavedKey) return 'DB 已保存 Key';
    if (runtimeHasKey) return 'DB 未保存 Key，真实调用使用运行时 Key';
    return 'DB 未保存 Key';
}

function dbKeyStateClass(hasSavedKey: boolean, runtimeHasKey: boolean): string {
    if (hasSavedKey) return 'text-g400';
    if (runtimeHasKey) return 'text-y400';
    return 'text-r400';
}

function firstFiniteNumber(source: JsonRecord, keys: string[]): number | undefined {
    for (const key of keys) {
        const raw = source[key];
        const value = typeof raw === 'number'
            ? raw
            : typeof raw === 'string'
                ? Number(raw.match(/-?\d+(?:\.\d+)?/)?.[0])
                : NaN;
        if (Number.isFinite(value)) return value;
    }
    return undefined;
}

function compactNumber(value: number, digits = 2): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(digits).replace(/\.?0+$/, '');
}

function normalizePercentValue(value: number): number {
    const percent = Math.abs(value) <= 1 ? value * 100 : value;
    return Math.max(0, Math.min(100, percent));
}

function providerUsageText(health?: ProviderHealth, configTest?: ApiConfigTest): string {
    const source = { ...(configTest || {}), ...(health?.health || {}), ...(health || {}) } as JsonRecord;
    const balance = firstFiniteNumber(source, [
        'balance_cny',
        'remaining_cny',
        'credit_cny',
        'balance',
        'remaining_balance',
        'credit_remaining',
        'quota_balance',
    ]);
    if (typeof balance === 'number') {
        const currency = String(source.currency || source.balance_currency || source.unit || 'CNY').toUpperCase();
        return `剩余：${compactNumber(balance)} ${currency}`;
    }

    const hours = firstFiniteNumber(source, [
        'remaining_hours',
        'hours_remaining',
        'hours_left',
        'package_hours_remaining',
    ]);
    const remainingPercent = firstFiniteNumber(source, [
        'remaining_percent',
        'quota_percent',
        'package_percent',
        'plan_remaining_percent',
        'traffic_percent',
    ]);
    const usedPercent = firstFiniteNumber(source, [
        'usage_percent',
        'used_percent',
        'plan_usage_percent',
    ]);
    const percent = typeof remainingPercent === 'number'
        ? normalizePercentValue(remainingPercent)
        : typeof usedPercent === 'number'
            ? 100 - normalizePercentValue(usedPercent)
            : undefined;

    if (typeof hours === 'number' && typeof percent === 'number') {
        return `${compactNumber(hours)}小时：${compactNumber(percent, 1)}%`;
    }
    if (typeof percent === 'number') {
        return `套餐余量：${compactNumber(percent, 1)}%`;
    }

    const tokens = firstFiniteNumber(source, ['remaining_tokens', 'tokens_remaining', 'token_balance']);
    if (typeof tokens === 'number') return `剩余 Token：${compactNumber(tokens, 0)}`;

    const verifiedByGeneration = Boolean(
        (health?.status === 'ok' && health?.health?.real_generation)
        || (health?.health?.ok && health?.health?.real_generation)
        || (configTest?.ok && configTest.real_generation)
    );
    if (verifiedByGeneration) return '真实生成已验证，余量未返回';

    return '余量：暂无数据';
}

function isNoKeyTest(test?: ApiConfigTest): boolean {
    return test?.error === 'No API key configured';
}

function isUnsupportedRealGenerationTest(test?: ApiConfigTest): boolean {
    return Boolean(test?.real_generation && String(test.status || '').toLowerCase() === 'unsupported');
}

function configTestTitle(test?: ApiConfigTest): string {
    return test?.real_generation ? '真实生成测试（可能产生费用）：' : 'DB 配置测试：';
}

function configTestResultClass(test: ApiConfigTest | undefined, hasRuntimeWarning: boolean): string {
    if (!test) return '';
    if (test.ok) {
        return hasRuntimeWarning
            ? 'border-y200 bg-y50 text-y400'
            : 'border-g75 bg-g50 text-g400';
    }
    const status = healthStatusFromConfigTest(test);
    if (status === 'connectivity_ok' || status === 'blocked_region' || status === 'no_key') {
        return 'border-y200 bg-y50 text-y400';
    }
    return 'border-r75 bg-r50 text-r400';
}

function configTestLabelText(
    test: ApiConfigTest | undefined,
    runtimeWarningText: string,
    messages: {
        runtimeKeyOk: string;
        dbOk: string;
        noKey: string;
        error: string;
    },
): string {
    if (!test) return '';
    if (test.real_generation) {
        if (test.ok) {
            return `真实生成已返回${test.output_type ? ` ${test.output_type}` : '结果'}`;
        }
        if (isUnsupportedRealGenerationTest(test)) {
            return '此 provider 暂不支持后台真实生成测试，请到业务页面验证';
        }
        if (isNoKeyTest(test)) {
            return '未保存 Key，无法真实生成';
        }
        return '真实生成异常';
    }
    if (test.ok) {
        return runtimeWarningText || (test.used_runtime_key ? messages.runtimeKeyOk : messages.dbOk);
    }
    if (isNoKeyTest(test)) return messages.noKey;
    if (isConnectivityOnlyConfigTest(test)) {
        return 'DB 配置连接成功，Key 与 Endpoint 可用；尚未验证真实生成能力';
    }
    return messages.error;
}

const HealthBadge: React.FC<{ status: HealthStatus }> = ({ status }) => {
    const view = statusView(status);
    return (
        <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold ${view.badge}`}>
            <span className={`w-2 h-2 rounded-full ${view.dot}`} />
            <span className="font-mono">{view.label}</span>
            <span>{view.text}</span>
        </span>
    );
};

const ProviderCredentialLinks: React.FC<{
    meta?: ProviderMeta;
    endpoint?: string;
    compact?: boolean;
    showHelp?: boolean;
}> = ({
    meta,
    endpoint,
    compact = false,
    showHelp = true,
}) => {
    const links = providerCredentialLinksForEndpoint(meta, endpoint);
    if (!links?.docs_url && !links?.console_url && !links?.key_help) return null;
    return (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${compact ? 'mt-1' : 'mt-2'}`}>
            {links.console_url && (
                <a
                    href={links.console_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:text-primary-hover"
                >
                    <ExternalLink className="w-3 h-3" />
                    控制台
                </a>
            )}
            {links.docs_url && (
                <a
                    href={links.docs_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:text-primary-hover"
                >
                    <ExternalLink className="w-3 h-3" />
                    API 文档
                </a>
            )}
            {showHelp && links.key_help && (
                <span className="text-n100 break-words">{links.key_help}</span>
            )}
        </div>
    );
};

const ProviderOperationPaths: React.FC<{
    meta?: ProviderMeta;
    runtime?: RuntimeStatus;
    compact?: boolean;
    collapsed?: boolean;
}> = ({
    meta,
    runtime,
    compact = false,
    collapsed = false,
}) => {
    const operationUrls = runtime?.operation_urls || meta?.default_operation_url_templates || {};
    const entries = Object.entries(meta?.operation_paths || operationUrls)
        .map(([operation, path]) => [operation, String(path || ''), String(operationUrls[operation] || '')] as const)
        .filter(([operation, path, url]) => operation && (path || url))
        .sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length) return null;

    const renderRows = () => (
        <div className="grid gap-1">
            {entries.map(([operation, path, url]) => (
                <div key={operation} className="grid gap-1 sm:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
                    <span className="font-mono text-n700 break-all">{operation}</span>
                    <span className="font-mono text-n300 break-all">{url || path}</span>
                    {url && path && url !== path && (
                        <span className="font-mono text-n100 break-all sm:col-start-2">{path}</span>
                    )}
                </div>
            ))}
        </div>
    );

    if (collapsed) {
        return (
            <details className={`rounded border border-n40 bg-n20 px-3 py-2 text-[11px] text-n100 ${compact ? 'mt-2' : 'mt-3'}`}>
                <summary className="flex cursor-pointer select-none items-center justify-between gap-3 font-semibold text-n700">
                    <span className="uppercase tracking-wider">API Paths</span>
                    <span className="rounded bg-n0 px-1.5 py-0.5 font-mono text-[10px] text-n100">
                        {entries.length}
                    </span>
                </summary>
                <div className="mt-2">
                    {renderRows()}
                </div>
            </details>
        );
    }

    return (
        <div className={`rounded border border-n40 bg-n20 px-3 py-2 text-[11px] text-n100 ${compact ? 'mt-2' : 'mt-3'}`}>
            <div className="mb-1 flex items-center justify-between gap-3 font-semibold uppercase tracking-wider text-n100">
                <span>API Paths</span>
                <span className="rounded bg-n0 px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-n100">
                    {entries.length}
                </span>
            </div>
            <div className="grid gap-1">
                {entries.map(([operation, path, url]) => (
                    <div key={operation} className="grid gap-1 sm:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
                        <span className="font-mono text-n700 break-all">{operation}</span>
                        <span className="font-mono text-n300 break-all">{url || path}</span>
                        {url && path && url !== path && (
                            <span className="font-mono text-n100 break-all sm:col-start-2">{path}</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

const ProviderHealthMonitorStrip: React.FC<{ state: ProviderHealthMonitorState | null }> = ({ state }) => {
    if (!state) return null;
    const enabled = state.enabled !== false;
    const running = state.loop_running === true;
    const hasError = Boolean(state.last_error);
    const summary = state.last_summary || {};
    const badgeClass = !enabled
        ? 'bg-n20 text-n300'
        : hasError
            ? 'bg-r50 text-r400'
            : running
                ? 'bg-g50 text-g400'
                : 'bg-y50 text-y400';
    const label = !enabled ? 'disabled' : hasError ? 'error' : running ? 'running' : 'idle';
    return (
        <section className="rounded-md border border-n40 bg-n0 px-3 py-2 shadow-card flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-n300">
            <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-semibold ${badgeClass}`}>
                <Activity className="w-3.5 h-3.5" />
                <span>自动巡检</span>
                <span className="font-mono">{label}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
                <Timer className="w-3.5 h-3.5 text-n100" />
                <span>最近完成</span>
                <span className="font-mono text-n700">{formatTime(state.last_sweep_completed_at || undefined)}</span>
            </span>
            <span className="font-mono text-n700">
                {typeof state.last_sweep_duration_ms === 'number' ? `${state.last_sweep_duration_ms} ms` : '- ms'}
            </span>
            <span className="font-mono text-n700">
                ok {summary.ok ?? 0} / reachable {summary.connectivity_ok ?? 0} / error {summary.error ?? 0} / no_key {summary.no_key ?? 0}
            </span>
            <span className="font-mono text-n100">
                source {state.last_sweep_source || '-'}
            </span>
            {!state.redis_configured && (
                <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 bg-y50 text-y400 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Redis cache offline
                </span>
            )}
            {state.last_error && (
                <span className="min-w-0 flex-1 text-r400 truncate" title={state.last_error}>
                    {state.last_error}
                </span>
            )}
        </section>
    );
};

const ApiConfigEditorModal: React.FC<{
    form: ApiConfigFormState;
    providers: ProviderMeta[];
    saving: boolean;
    onChange: (next: ApiConfigFormState) => void;
    onClose: () => void;
    onSubmit: () => void;
}> = ({ form, providers, saving, onChange, onClose, onSubmit }) => {
    const isEdit = Boolean(form.config_id);
    const providerOptions = useMemo(() => {
        const seen = new Set<string>();
        const out = providers
            .map(item => ({ provider: normalizeProvider(item.provider), label: item.label || item.provider }))
            .filter(item => {
                if (!item.provider || seen.has(item.provider)) return false;
                seen.add(item.provider);
                return true;
            });
        const current = normalizeProvider(form.provider);
        if (current && !seen.has(current)) out.unshift({ provider: current, label: current });
        return out;
    }, [form.provider, providers]);

    const patch = (fields: Partial<ApiConfigFormState>) => onChange({ ...form, ...fields });
    const selectedProvider = normalizeProvider(form.provider);
    const selectedMeta = providers.find(item => normalizeProvider(item.provider) === selectedProvider);
    const extraFields = selectedMeta?.extra_fields || [];
    const bindingOptions = selectedMeta?.model_binding_options || [];
    const usageScopes = selectedMeta?.model_usage_scopes?.length ? selectedMeta.model_usage_scopes : DEFAULT_MODEL_USAGE_SCOPES;
    const accessModes = selectedMeta?.access_modes || [];
    const activeAccessModeMeta = providerAccessModeForEndpoint(accessModes, form.endpoint);
    const activeAccessMode = activeAccessModeMeta?.mode || '';
    const lockGeneratedFields = isEdit && Boolean(selectedMeta);
    const lockedInputClass = 'bg-n20 text-n100 cursor-not-allowed';
    const normalInputClass = 'bg-n0 text-n800 focus:border-primary focus:outline-none';
    const updateBinding = (index: number, next: ApiModelBinding) => {
        patch({
            model_bindings: form.model_bindings.map((item, itemIndex) => itemIndex === index ? next : item),
            model_name: index === 0 ? next.model_name : form.model_name,
        });
    };
    const addBinding = () => {
        const used = new Set(form.model_bindings.map(item => modelBindingKey(item)));
        const option = bindingOptions.find(item => !used.has(modelBindingKey(item)));
        const next = option
            ? { ...option }
            : {
                operation: `operation-${form.model_bindings.length + 1}`,
                label: '自定义操作',
                model_name: '',
                scope: 'workflow',
                scope_label: modelUsageScopeLabel('workflow', usageScopes),
            };
        patch({ model_bindings: [...form.model_bindings, next] });
    };
    const removeBinding = (index: number) => {
        const next = form.model_bindings.filter((_, itemIndex) => itemIndex !== index);
        patch({ model_bindings: next, model_name: next[0]?.model_name || '' });
    };
    const selectAccessMode = (mode: ProviderAccessMode) => {
        const source = form.model_bindings.length ? form.model_bindings : defaultModelBindings(selectedMeta);
        const nextBindings = applyPublicApiModelBindingLabels(selectedProvider, source.map(binding => ({
            ...binding,
            model_name: mode.model_map?.[binding.operation] || binding.model_name,
        })));
        patch({
            endpoint: mode.endpoint,
            model_bindings: nextBindings,
            model_name: nextBindings[0]?.model_name || form.model_name,
        });
    };

    return (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-n900/40 backdrop-blur-sm p-4">
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    onSubmit();
                }}
                className="modal-surface w-full max-w-3xl bg-n0 border border-n40 rounded-md shadow-bottom overflow-hidden flex flex-col"
            >
                <div className="responsive-toolbar flex items-center justify-between gap-3 px-5 py-4 border-b border-n40 bg-n0">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-n800">{isEdit ? '编辑 API 配置' : '新增 API 配置'}</h2>
                        <div className="text-xs text-n100 mt-0.5">
                            {isEdit ? 'Key 留空时保留现有密钥；预设生成的协议字段已锁定' : '新增配置需要填写 API Key'}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="px-2 py-1 rounded border border-n40 text-n300 hover:bg-n20 disabled:opacity-60"
                    >
                        关闭
                    </button>
                </div>

                <div className="p-5 overflow-y-auto overflow-x-hidden space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">名称</span>
                            <input
                                required
                                value={form.name}
                                onChange={event => patch({ name: event.target.value })}
                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 focus:border-primary focus:outline-none"
                                placeholder="Gemini Text"
                            />
                        </label>
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">Provider</span>
                            <select
                                required
                                value={form.provider}
                                disabled={lockGeneratedFields}
                                onChange={event => {
                                    const provider = normalizeProvider(event.target.value);
                                    const nextMeta = providers.find(item => normalizeProvider(item.provider) === provider);
                                    patch({
                                        provider,
                                        endpoint: nextMeta?.default_endpoint || form.endpoint,
                                        model_name: nextMeta?.default_model_name || '',
                                        model_bindings: defaultModelBindings(nextMeta),
                                        category: nextMeta ? categoryFromProviderMeta(nextMeta) : form.category,
                                    });
                                }}
                                className={`w-full rounded border border-n40 px-3 py-2 text-sm ${lockGeneratedFields ? lockedInputClass : normalInputClass}`}
                            >
                                <option value="">选择 provider</option>
                                {providerOptions.map(item => (
                                    <option key={item.provider} value={item.provider}>
                                        {item.label} ({item.provider})
                                    </option>
                                ))}
                            </select>
                            {lockGeneratedFields && (
                                <span className="mt-1 block text-[11px] text-n100">已有配置的 provider 由预设生成，不能在编辑时改成其他厂商。</span>
                            )}
                        </label>
                    </div>

                    {accessModes.length > 0 && (
                        <section className="border-y border-n40 py-3">
                            <div className="text-xs font-medium text-n300 mb-2">厂商调用通道</div>
                            <div className="inline-flex max-w-full rounded border border-n40 bg-n20 p-0.5" role="group" aria-label="厂商调用通道">
                                {accessModes.map(mode => {
                                    const active = activeAccessMode === mode.mode;
                                    return (
                                        <button
                                            key={mode.mode}
                                            type="button"
                                            onClick={() => selectAccessMode(mode)}
                                            className={`px-3 py-1.5 text-xs font-medium rounded-sm ${active ? 'bg-primary text-white' : 'bg-transparent text-n700 hover:bg-n0'}`}
                                        >
                                            {mode.label || mode.mode}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="mt-2 text-[11px] text-n100">
                                {activeAccessModeMeta?.description
                                    || (activeAccessMode === 'agent_plan'
                                        ? '使用 Agent Plan 专属 Key，并从套餐燃料值扣除。'
                                        : '使用厂商对应通道创建的 API Key。')}
                                {activeAccessModeMeta?.console_url && (
                                    <a
                                        href={activeAccessModeMeta.console_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="ml-2 font-medium text-primary hover:underline"
                                    >
                                        打开对应控制台
                                    </a>
                                )}
                            </div>
                        </section>
                    )}

                    <label className="block min-w-0">
                        <span className="block text-xs font-medium text-n300 mb-1">Endpoint</span>
                        <textarea
                            required
                            value={form.endpoint}
                            onChange={event => patch({ endpoint: event.target.value })}
                            rows={3}
                            className="w-full min-h-[76px] resize-y rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono leading-relaxed break-all focus:border-primary focus:outline-none"
                            placeholder="https://api.example.com/v1"
                        />
                    </label>

                    {selectedMeta && (
                        <div className="rounded border border-n40 bg-n20 px-3 py-2">
                            <div className="text-[11px] font-semibold text-n300 mb-1">Key 获取入口</div>
                            <ProviderCredentialLinks meta={selectedMeta} endpoint={form.endpoint} compact />
                        </div>
                    )}

                    {!isEdit && (
                        <label className="inline-flex items-center gap-2 text-sm text-n700">
                            <input
                                type="checkbox"
                                checked={form.bulk_mode}
                                onChange={event => patch({ bulk_mode: event.target.checked })}
                            />
                            <span>批量添加多个 API Key</span>
                        </label>
                    )}

                    <div className="grid grid-cols-1 gap-4">
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">API Key</span>
                            {isEdit && (
                                <div className={`mb-1 inline-flex rounded border px-2 py-0.5 text-[11px] font-mono ${
                                    form.has_key ? 'border-g75 bg-g50 text-g400' : 'border-y200 bg-y50 text-y400'
                                }`}>
                                    {form.has_key ? `当前 Key：${form.api_key_preview || '****'}` : '当前未保存 Key'}
                                </div>
                            )}
                            <input
                                type="password"
                                required={!isEdit && !form.bulk_mode}
                                value={form.api_key}
                                disabled={form.bulk_mode && !isEdit}
                                onChange={event => patch({ api_key: event.target.value })}
                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono focus:border-primary focus:outline-none"
                                placeholder={isEdit ? `留空保留${form.api_key_preview ? ` ${form.api_key_preview}` : '现有'} Key` : 'sk-...'}
                            />
                            {isEdit && (
                                <span className="mt-1 block text-[11px] text-n100">只在需要替换密钥时填写；留空会保留上方显示的当前 Key。</span>
                            )}
                        </label>
                    </div>

                    {form.bulk_mode && !isEdit && (
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">API Key 列表</span>
                            <textarea
                                required
                                value={form.bulk_api_keys}
                                onChange={event => patch({ bulk_api_keys: event.target.value })}
                                rows={5}
                                className="w-full min-h-[120px] resize-y rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono leading-relaxed break-all focus:border-primary focus:outline-none"
                                placeholder="每行一个 Key，或用逗号分隔。第一个 Key 默认生效。"
                            />
                            <span className="mt-1 block text-[11px] text-n100">每个 Key 生成一张独立 API 卡片；第一张卡默认生效，所有卡片使用下方相同的操作绑定。</span>
                        </label>
                    )}

                    <section className="border-y border-n40 py-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-xs font-semibold text-n700">前台操作与模型绑定</div>
                                <div className="mt-0.5 text-[11px] text-n100">一张 API 卡可以分别绑定流程化制作和自由创作；同一场景下同一个操作只能对应一个模型。</div>
                            </div>
                            <button
                                type="button"
                                onClick={addBinding}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-n40 bg-n0 text-xs font-medium text-n700 hover:bg-n20"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                添加绑定
                            </button>
                        </div>
                        <div className="mt-3 space-y-2">
                            {form.model_bindings.map((binding, index) => {
                                const bindingScope = normalizeModelUsageScope(binding.scope);
                                const scopedBindingOptions = bindingOptions.filter(item => normalizeModelUsageScope(item.scope) === bindingScope);
                                const selectableOptions = scopedBindingOptions.length ? scopedBindingOptions : bindingOptions;
                                const selectedOption = selectableOptions.find(item => String(item.operation || '').trim().toLowerCase() === String(binding.operation || '').trim().toLowerCase())
                                    || bindingOptions.find(item => modelBindingOptionMatches(item, binding));
                                return (
                                    <div key={`${modelBindingKey(binding)}-${index}`} className="rounded border border-n40 bg-n20 p-3">
                                      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(140px,0.6fr)_minmax(180px,0.8fr)_minmax(0,1.4fr)_32px]">
                                        <label className="block min-w-0">
                                            <span className="block text-[11px] font-medium text-n300 mb-1">使用场景</span>
                                            <select
                                                value={bindingScope}
                                                onChange={event => {
                                                    const scope = normalizeModelUsageScope(event.target.value);
                                                    const option = bindingOptions.find(item => (
                                                        String(item.operation || '').trim().toLowerCase() === String(binding.operation || '').trim().toLowerCase()
                                                        && normalizeModelUsageScope(item.scope) === scope
                                                    ));
                                                    updateBinding(index, {
                                                        ...binding,
                                                        scope,
                                                        scope_label: modelUsageScopeLabel(scope, usageScopes),
                                                        label: option?.label || binding.label,
                                                        model_name: option?.model_name || binding.model_name,
                                                        front_model_key: option?.front_model_key || binding.front_model_key,
                                                        default_display_name: option?.default_display_name || binding.default_display_name,
                                                        default_description: option?.default_description || binding.default_description,
                                                    });
                                                }}
                                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 focus:border-primary focus:outline-none"
                                            >
                                                {usageScopes.map(scopeMeta => {
                                                    const scope = normalizeModelUsageScope(scopeMeta.scope);
                                                    return (
                                                        <option key={scope} value={scope}>{scopeMeta.label || modelUsageScopeLabel(scope, usageScopes)}</option>
                                                    );
                                                })}
                                            </select>
                                            <span className="mt-1 block font-mono text-[10px] text-n100">{bindingScope}</span>
                                        </label>
                                        <label className="block min-w-0">
                                            <span className="block text-[11px] font-medium text-n300 mb-1">前台操作</span>
                                            {selectedOption ? (
                                                <select
                                                    value={binding.operation}
                                                    onChange={event => {
                                                        const operation = event.target.value;
                                                        const option = selectableOptions.find(item => item.operation === operation);
                                                        updateBinding(index, {
                                                            operation,
                                                            label: option?.label || operation,
                                                            model_name: option?.model_name || binding.model_name,
                                                            scope: bindingScope,
                                                            scope_label: modelUsageScopeLabel(bindingScope, usageScopes),
                                                            front_model_key: option?.front_model_key,
                                                            default_display_name: option?.default_display_name,
                                                            default_description: option?.default_description,
                                                            display_name: '',
                                                            description: '',
                                                            published: option?.published !== false,
                                                        });
                                                    }}
                                                    className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 focus:border-primary focus:outline-none"
                                                >
                                                    {selectableOptions.map(option => (
                                                        <option key={modelBindingKey(option)} value={option.operation}>{option.label || option.operation}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    required
                                                    value={binding.operation}
                                                    onChange={event => updateBinding(index, {
                                                        ...binding,
                                                        operation: event.target.value.trim().toLowerCase(),
                                                        label: event.target.value,
                                                        scope: bindingScope,
                                                        scope_label: modelUsageScopeLabel(bindingScope, usageScopes),
                                                    })}
                                                    className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono focus:border-primary focus:outline-none"
                                                    placeholder="operation-code"
                                                />
                                            )}
                                            <span className="mt-1 block font-mono text-[10px] text-n100">{binding.operation}</span>
                                        </label>
                                        <label className="block min-w-0">
                                            <span className="block text-[11px] font-medium text-n300 mb-1">厂商模型 ID</span>
                                            <input
                                                required
                                                value={binding.model_name}
                                                onChange={event => updateBinding(index, { ...binding, model_name: event.target.value })}
                                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono focus:border-primary focus:outline-none"
                                                placeholder="model-name"
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => removeBinding(index)}
                                            className="mt-5 inline-flex h-8 w-8 items-center justify-center rounded border border-r75 bg-r50 text-danger hover:bg-r50"
                                            title="删除绑定"
                                            aria-label="删除绑定"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                      {binding.front_model_key && (
                                        <div className="mt-3 grid gap-3 border-t border-n40 pt-3 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.25fr)_auto]">
                                            <label className="flex min-w-[92px] items-center gap-2 self-start pt-6 text-xs font-medium text-n500">
                                                <button
                                                    type="button"
                                                    role="switch"
                                                    aria-label="前台上架"
                                                    aria-checked={binding.published !== false}
                                                    onClick={() => updateBinding(index, { ...binding, published: binding.published === false })}
                                                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${binding.published !== false ? 'bg-success' : 'bg-n70'}`}
                                                >
                                                    <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-n0 shadow transition-transform ${binding.published !== false ? 'translate-x-4' : 'translate-x-0'}`} />
                                                </button>
                                                {binding.published !== false ? '已上架' : '未上架'}
                                            </label>
                                            <label className="block min-w-0">
                                                <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-n300">
                                                    前台展示名称
                                                    <span className={`rounded px-1 py-0.5 text-[9px] ${binding.display_name ? 'bg-b50 text-primary' : 'bg-n40 text-n200'}`}>
                                                        {binding.display_name ? '已自定义' : '默认'}
                                                    </span>
                                                </span>
                                                <input
                                                    value={binding.display_name || ''}
                                                    onChange={event => updateBinding(index, { ...binding, display_name: event.target.value })}
                                                    className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 focus:border-primary focus:outline-none"
                                                    placeholder={binding.default_display_name || '前台模型名称'}
                                                />
                                                <span className="mt-1 block truncate text-[10px] text-n100">默认：{binding.default_display_name || '-'}</span>
                                            </label>
                                            <label className="block min-w-0">
                                                <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-n300">
                                                    模型说明
                                                    <span className={`rounded px-1 py-0.5 text-[9px] ${binding.description ? 'bg-b50 text-primary' : 'bg-n40 text-n200'}`}>
                                                        {binding.description ? '已自定义' : '默认'}
                                                    </span>
                                                </span>
                                                <input
                                                    value={binding.description || ''}
                                                    onChange={event => updateBinding(index, { ...binding, description: event.target.value })}
                                                    className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 focus:border-primary focus:outline-none"
                                                    placeholder={binding.default_description || '例如：首尾帧标准视频模型'}
                                                />
                                                <span className="mt-1 block truncate text-[10px] text-n100">默认：{binding.default_description || '-'}</span>
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => updateBinding(index, { ...binding, display_name: '', description: '' })}
                                                disabled={!binding.display_name && !binding.description}
                                                className="self-start mt-5 rounded border border-n40 bg-n0 px-2.5 py-2 text-[11px] text-n300 hover:bg-n20 disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                恢复默认
                                            </button>
                                        </div>
                                      )}
                                    </div>
                                );
                            })}
                            {form.model_bindings.length === 0 && (
                                <div className="border border-dashed border-n40 px-3 py-4 text-center text-xs text-n100">尚未绑定前台操作，请添加至少一条绑定。</div>
                            )}
                        </div>
                    </section>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">分类</span>
                            <select
                                value={form.category}
                                disabled={lockGeneratedFields}
                                onChange={event => patch({ category: event.target.value })}
                                className={`w-full rounded border border-n40 px-3 py-2 text-sm ${lockGeneratedFields ? lockedInputClass : normalInputClass}`}
                            >
                                {Object.entries(CATEGORY_LABELS).filter(([key]) => key !== 'other').map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">代理模式</span>
                            <select
                                value={form.proxy_mode}
                                onChange={event => patch({ proxy_mode: event.target.value })}
                                className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 focus:border-primary focus:outline-none"
                            >
                                <option value="direct">direct</option>
                                <option value="custom">custom</option>
                                <option value="agent">agent</option>
                            </select>
                        </label>
                        <label className="flex items-center gap-2 pt-6 min-w-0">
                            <input
                                type="checkbox"
                                checked={form.enabled}
                                onChange={event => patch({ enabled: event.target.checked })}
                            />
                            <span className="text-sm text-n700">启用配置</span>
                        </label>
                    </div>

                    {form.proxy_mode === 'custom' && (
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">自定义代理</span>
                            <textarea
                                value={form.custom_proxy}
                                onChange={event => patch({ custom_proxy: event.target.value })}
                                rows={2}
                                className="w-full min-h-[64px] resize-y rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono leading-relaxed break-all focus:border-primary focus:outline-none"
                                placeholder="http://127.0.0.1:7890"
                            />
                        </label>
                    )}

                    {extraFields.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {extraFields.map(field => (
                                <label key={field.field} className="block min-w-0">
                                    <span className="block text-xs font-medium text-n300 mb-1">{field.label || field.field}</span>
                                    <input
                                        type={field.secret || field.input_type === 'password' ? 'password' : 'text'}
                                        value={extraFieldValueFromForm(form, field)}
                                        onChange={event => patch({
                                            extra_values: {
                                                ...form.extra_values,
                                                [field.field]: event.target.value,
                                            },
                                        })}
                                        className="w-full rounded border border-n40 bg-n0 px-3 py-2 text-sm text-n800 font-mono focus:border-primary focus:outline-none"
                                        placeholder={field.placeholder || field.env_key || field.field}
                                    />
                                    {(field.help || field.env_key) && (
                                        <span className="mt-1 block text-[11px] text-n100">
                                            {field.help || `Hot-reloads into ${field.env_key}`}
                                        </span>
                                    )}
                                </label>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">Request Template JSON</span>
                            <textarea
                                value={form.request_template}
                                disabled={lockGeneratedFields}
                                onChange={event => patch({ request_template: event.target.value })}
                                rows={5}
                                className={`w-full min-h-[120px] resize-y rounded border border-n40 px-3 py-2 text-sm font-mono leading-relaxed break-all ${lockGeneratedFields ? lockedInputClass : normalInputClass}`}
                                placeholder='{"group_id":"..."}'
                            />
                            {lockGeneratedFields && (
                                <span className="mt-1 block text-[11px] text-n100">预设生成的底层请求模板已锁定；需要配置的额外字段会在上方单独显示。</span>
                            )}
                        </label>
                        <label className="block min-w-0">
                            <span className="block text-xs font-medium text-n300 mb-1">Headers JSON</span>
                            <textarea
                                value={form.headers}
                                disabled={lockGeneratedFields}
                                onChange={event => patch({ headers: event.target.value })}
                                rows={5}
                                className={`w-full min-h-[120px] resize-y rounded border border-n40 px-3 py-2 text-sm font-mono leading-relaxed break-all ${lockGeneratedFields ? lockedInputClass : normalInputClass}`}
                                placeholder='{"X-Custom":"value"}'
                            />
                            {lockGeneratedFields && (
                                <span className="mt-1 block text-[11px] text-n100">预设生成的底层 Headers 已锁定，避免误改认证和生成协议。</span>
                            )}
                        </label>
                    </div>
                </div>

                <div className="responsive-toolbar flex items-center justify-end gap-2 px-5 py-4 border-t border-n40 bg-n20">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="px-4 py-2 rounded text-sm border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                    >
                        取消
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:opacity-60"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        保存
                    </button>
                </div>
            </form>
        </div>
    );
};

const API_CARD_ACTION_BUTTON_BASE = 'inline-flex h-8 min-w-[4.5rem] shrink-0 items-center justify-center gap-1.5 rounded px-2.5 text-[11px] font-medium leading-none whitespace-nowrap';
const API_CARD_ACTION_BUTTON_SECONDARY = `${API_CARD_ACTION_BUTTON_BASE} border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60`;
const API_CARD_ACTION_BUTTON_SUCCESS = `${API_CARD_ACTION_BUTTON_BASE} border border-g75 bg-g50 text-g400 hover:bg-g50 disabled:opacity-60`;
const API_CARD_ACTION_BUTTON_PRIMARY = `${API_CARD_ACTION_BUTTON_BASE} text-white bg-primary hover:bg-primary-hover disabled:opacity-60`;
const API_CARD_ACTION_BUTTON_DANGER = `${API_CARD_ACTION_BUTTON_BASE} border border-danger/30 bg-r50 text-danger hover:bg-r50 disabled:opacity-60`;

const ApiConfigCard: React.FC<{
    config: ApiConfig;
    categoryView?: string;
    meta?: ProviderMeta;
    runtime?: RuntimeStatus;
    health?: ProviderHealth;
    configTest?: ApiConfigTest;
    checking: boolean;
    testingConfig: boolean;
    realTestingConfig: boolean;
    onCheck: (provider: string, modelName?: string | null) => void;
    onTestConfig: (config: ApiConfig) => void;
    onRealTestConfig: (config: ApiConfig, categoryView?: string) => void;
    onEdit: (config: ApiConfig) => void;
    onActivate: (config: ApiConfig) => void;
    onToggle: (config: ApiConfig) => void;
    onDelete: (config: ApiConfig) => void;
}> = ({
    config,
    categoryView,
    meta,
    runtime,
    health,
    configTest,
    checking,
    testingConfig,
    realTestingConfig,
    onCheck,
    onTestConfig,
    onRealTestConfig,
    onEdit,
    onActivate,
    onToggle,
    onDelete,
}) => {
    const provider = normalizeProvider(config.provider);
    const realGenerationBlocked = categoryView === 'video'
        || (!categoryView && Boolean(meta && categoryFromProviderMeta(meta) === 'video'));
    const cardTitle = apiConfigCardTitle(config, meta, categoryView);
    const modelBindings = uniqueModelBindingsForDisplay(bindingsForCategory(
        apiConfigModelBindings(config, meta),
        config.provider,
        categoryView,
    ) as ApiModelBinding[]);
    const categoryModelName = modelBindings[0]?.model_name
        || config.model_name
        || runtime?.runtime_model_name
        || null;
    const runtimeHasKey = typeof runtime?.has_key === 'boolean' ? runtime.has_key : Boolean(config.has_key ?? config.api_key_encrypted);
    const configHasKey = Boolean(config.has_key ?? config.api_key_encrypted);
    const status = mergedHealthStatus(health, runtime, runtimeHasKey, configTest);
    const view = statusView(status);
    // A model-specific health record is newer and more precise than the
    // runtime summary. Do not fall back to a stale runtime error when that
    // record exists and reports no error.
    const rawHealthError = health?.health
        ? String(health.health.error || '')
        : String(runtime?.health_error || '');
    const healthLatency = typeof health?.latency_ms === 'number' ? health.latency_ms : runtime?.health_latency_ms;
    const healthCheckedAt = health?.checked_at || runtime?.health_checked_at || runtime?.health_cached_at;
    const usageText = providerUsageText(health, configTest);
    const runtimeIssues = status === 'ok'
        ? (runtime?.issues || []).filter(issue => issue !== 'health_error')
        : runtime?.issues;
    const runtimeIssue = runtimeIssueText(runtimeIssues);
    const runtimeEndpoint = runtime?.endpoint || '';
    const dbEndpoint = config.endpoint || '';
    const verifiedByGeneration = Boolean(
        (configTest?.ok && configTest.real_generation)
        || (health?.status === 'ok' && health?.health?.ok && health?.health?.real_generation)
    );
    const healthError = verifiedByGeneration
        ? ''
        : apiConfigErrorMessage(provider, dbEndpoint || runtimeEndpoint, rawHealthError);
    const accessModeMeta = providerAccessModeForEndpoint(meta?.access_modes || [], dbEndpoint || runtimeEndpoint);
    const accessMode = accessModeMeta?.mode || '';
    const runtimeDbEndpointMismatch = endpointMismatch(runtimeEndpoint, dbEndpoint);
    const effectiveConfig = runtime?.db_effective_config_name || runtime?.db_effective_config_id || '';
    const isRuntimeActive = Boolean(
        config.config_id
        && runtime?.db_effective_config_id
        && config.config_id === runtime.db_effective_config_id
    );
    const keyedCount = runtime?.db_keyed_enabled_config_count || 0;
    const endpointCount = runtime?.db_enabled_endpoint_count || 0;
    const fallbackText = (runtime?.fallback || [])
        .map(fallbackEntryText)
        .filter(Boolean)
        .join('，');
    const selectedFailover = [
        runtime?.failover_selected_provider,
        runtime?.failover_selected_model_name,
    ].filter(Boolean).join(' / ');
    const failoverActive = Boolean(runtime?.failover_active);
    const configTestRuntimeWarningText = configTest?.ok ? configTestRuntimeWarning(configTest) : '';
    const configTestUsesRuntimeKey = Boolean(configTest?.ok && (configTest.used_runtime_key || configTestRuntimeWarningText));
    const configTestTitleText = configTestTitle(configTest);
    const configTestClass = configTestResultClass(configTest, configTestUsesRuntimeKey);
    const configTestLabel = configTestLabelText(configTest, configTestRuntimeWarningText, {
        runtimeKeyOk: '运行时连通正常；此条 DB 记录仍未保存 Key',
        dbOk: '此条记录连通正常',
        noKey: '此条 DB 记录未保存 Key',
        error: '此条记录异常',
    });
    const configTestKeySource = !configTest
        ? ''
        : configTest.used_runtime_key
            ? `运行时 ${configTest.key_env || 'Key'}`
            : configTest.key_source === 'db'
                ? 'DB 保存 Key'
                : configTest.key_source === 'missing'
                    ? '未配置 Key'
                    : configTest.key_source || '';
    const configTestEndpoint = configTestEndpointText(configTest);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const effectiveActionLabel = config.enabled === false ? '启用' : !isRuntimeActive ? '设为生效' : '禁用';
    const effectiveActionTitle = config.enabled === false
        ? '启用此 Key 并设为当前生效配置'
        : !isRuntimeActive
            ? '设为当前生效配置'
            : '禁用当前生效配置';
    const handleEffectiveAction = () => {
        if (!isRuntimeActive) {
            onActivate(config);
            return;
        }
        onToggle(config);
    };

    return (
        <>
        <article className={`${config.enabled === false ? 'bg-n30 border-n50 opacity-70' : 'bg-n0 border-n40 hover:shadow-atlas hover:border-primary'} border rounded-md shadow-card px-3 py-2 min-w-0 transition-colors`}>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${view.dot}`} title={view.text} />
                    <h3 className="truncate text-sm font-semibold text-n800 leading-snug" title={cardTitle}>{cardTitle}</h3>
                    <HealthBadge status={status} />
                    {isRuntimeActive && (
                        <span className="shrink-0 rounded bg-g50 text-g400 px-1.5 py-0.5 text-[10px] font-semibold">当前生效 Key</span>
                    )}
                    {accessModeMeta && (
                        <span className="hidden shrink-0 rounded border border-n40 bg-n20 px-1.5 py-0.5 text-[10px] font-semibold text-n700 md:inline-flex">
                            {accessModeMeta.label || accessMode}
                        </span>
                    )}
                    {config.api_key_preview && (
                        <span className="hidden shrink-0 rounded bg-n20 text-n300 px-1.5 py-0.5 text-[10px] font-mono md:inline-flex">{config.api_key_preview}</span>
                    )}
                    {!config.enabled && (
                        <span className="shrink-0 rounded bg-r50 text-danger px-1.5 py-0.5 text-[10px] font-semibold">禁用</span>
                    )}
                    {!configHasKey && (
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${runtimeHasKey ? 'bg-y50 text-y400' : 'bg-r50 text-r400'}`}>
                            DB 未保存 Key
                        </span>
                    )}
                    {runtimeHasKey && !configHasKey && (
                        <span className="hidden shrink-0 rounded bg-g50 text-g400 px-1.5 py-0.5 text-[10px] font-semibold xl:inline-flex">运行时 Key 可用</span>
                    )}
                    <span className="hidden shrink-0 text-[11px] text-n100 lg:inline">
                        {modelBindings.length} 个{categoryView ? `${CATEGORY_LABELS[categoryView] || categoryView}` : '操作'}绑定
                    </span>
                    <span className="hidden min-w-0 truncate font-mono text-[11px] text-n100 xl:inline" title={provider}>{provider}</span>
                </div>

                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <button
                        type="button"
                        onClick={handleEffectiveAction}
                        disabled={!config.config_id || (!isRuntimeActive && !configHasKey)}
                        className={!isRuntimeActive ? API_CARD_ACTION_BUTTON_SUCCESS : API_CARD_ACTION_BUTTON_SECONDARY}
                        title={effectiveActionTitle}
                    >
                        {!isRuntimeActive && <KeyRound className="w-3.5 h-3.5" />}
                        {effectiveActionLabel}
                    </button>
                    <button
                        type="button"
                        onClick={() => setDetailsOpen(true)}
                        className={API_CARD_ACTION_BUTTON_SECONDARY}
                    >
                        <ServerCog className="w-3.5 h-3.5" />
                        详情
                    </button>
                    <button
                        type="button"
                        onClick={() => onCheck(provider, categoryModelName)}
                        disabled={checking || !provider}
                        className={API_CARD_ACTION_BUTTON_SECONDARY}
                        title="检测当前实际生效的 Key、Endpoint 和模型是否连通"
                    >
                        {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        连通性检测
                    </button>
                    <button
                        type="button"
                        onClick={() => onEdit(config)}
                        className={API_CARD_ACTION_BUTTON_PRIMARY}
                    >
                        <Edit3 className="w-3.5 h-3.5" />
                        配置 / 修改 API Key
                    </button>
                    <button
                        type="button"
                        onClick={() => onDelete(config)}
                        className={API_CARD_ACTION_BUTTON_DANGER}
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除
                    </button>
                </div>
            </div>
        </article>

        {detailsOpen && (
            <div
                className="fixed inset-0 z-[10002] flex items-center justify-center bg-n900/50 backdrop-blur-sm p-4"
                onClick={() => setDetailsOpen(false)}
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${cardTitle} 详情`}
                    className="w-full max-w-5xl max-h-[86vh] overflow-hidden rounded-md border border-n40 bg-n0 shadow-bottom"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="flex items-center justify-between gap-3 border-b border-n40 bg-n30 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${view.dot}`} />
                            <h3 className="truncate text-sm font-semibold text-n800">{cardTitle}</h3>
                            <HealthBadge status={status} />
                        </div>
                        <button
                            type="button"
                            onClick={() => setDetailsOpen(false)}
                            className="rounded p-1 text-n100 hover:bg-n20 hover:text-n800"
                            aria-label="关闭详情"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="max-h-[calc(86vh-4rem)] overflow-y-auto p-4">
                    <section className="mt-3 border-y border-n40 py-3">
                        <div className="text-[10px] uppercase tracking-wider text-n100">前台操作与模型绑定</div>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                            {modelBindings.map(binding => (
                                <div key={modelBindingKey(binding)} className="min-w-0 border-l-2 border-primary pl-2">
                                    <div className="text-xs font-medium text-n700">
                                        <span className="mr-1 rounded bg-n20 px-1 py-0.5 text-[10px] text-n300">{binding.scope_label || modelUsageScopeLabel(binding.scope)}</span>
                                        {binding.label || binding.operation}
                                    </div>
                                    <div className="mt-0.5 font-mono text-[11px] text-n100 break-all">{binding.model_name}</div>
                                </div>
                            ))}
                        </div>
                    </section>
                    <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
                        <div className="min-w-0 rounded bg-n20 border border-n40 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wider text-n100 mb-1">Runtime</div>
                            <div className="font-mono text-xs text-n700 break-all">{formatEndpoint(runtimeEndpoint || dbEndpoint)}</div>
                            {runtimeDbEndpointMismatch && (
                                <div className="mt-1 text-[11px] text-y400 break-all">
                                    DB Endpoint: <span className="font-mono">{formatEndpoint(dbEndpoint)}</span>
                                </div>
                            )}
                            <div className="mt-2 grid gap-1 text-[11px] text-n100 sm:grid-cols-2">
                                <div className="min-w-0">
                                    Key: <span className="font-mono text-n700 break-all">{sourceText(runtime?.api_key_source, runtime?.api_key_env)}</span>
                                </div>
                                <div className="min-w-0">
                                    Key 状态: <span className="font-mono text-n700 break-all">{keySourceText(runtime, configHasKey)}</span>
                                </div>
                                <div className="min-w-0">
                                    Endpoint: <span className="font-mono text-n700 break-all">{sourceText(runtime?.endpoint_source, runtime?.endpoint_env)}</span>
                                </div>
                                <div className="min-w-0">
                                    Model: <span className="font-mono text-n700 break-all">{runtime?.runtime_model_name || categoryModelName || '-'}</span>
                                </div>
                                <div className="min-w-0">
                                    Model source: <span className="font-mono text-n700 break-all">{sourceText(runtime?.model_source, runtime?.model_env || undefined)}</span>
                                </div>
                                <div className="min-w-0">
                                    Proxy: <span className="font-mono text-n700">{config.proxy_mode || runtime?.proxy_mode || 'direct'}</span>
                                </div>
                                <div className="min-w-0">
                                    Source: <span className="font-mono text-n700">{runtime?.runtime_source || '-'}</span>
                                </div>
                            </div>
                            {(effectiveConfig || keyedCount > 1 || endpointCount > 1) && (
                                <div className="mt-2 border-t border-n40 pt-2 text-[11px] text-n100">
                                    {effectiveConfig && (
                                        <div className="min-w-0">
                                            生效配置: <span className="font-mono text-n700 break-all">{effectiveConfig}</span>
                                        </div>
                                    )}
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                        {keyedCount > 0 && (
                                            <span className="rounded bg-n0 border border-n40 px-1.5 py-0.5">启用 Key {keyedCount}</span>
                                        )}
                                        {endpointCount > 0 && (
                                            <span className="rounded bg-n0 border border-n40 px-1.5 py-0.5">Endpoint {endpointCount}</span>
                                        )}
                                    </div>
                                </div>
                            )}
                            {runtimeIssue && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {runtimeIssue.split('，').map(issue => (
                                        <span key={issue} className="rounded bg-y50 text-y400 px-1.5 py-0.5 text-[10px] font-semibold">{issue}</span>
                                    ))}
                                </div>
                            )}
                            {(failoverActive || fallbackText) && (
                                <div className={`mt-2 rounded border px-2 py-1.5 text-[11px] break-words ${
                                    failoverActive
                                        ? 'border-y200 bg-y50 text-y400'
                                        : 'border-n40 bg-n0 text-n100'
                                }`}>
                                    <span className="font-semibold">{failoverActive ? '已切换备用' : '备用链路'}</span>
                                    ：
                                    <span className="font-mono text-n700">
                                        {failoverActive ? (selectedFailover || '-') : fallbackText}
                                    </span>
                                    {failoverActive && (
                                        <span className="ml-2">
                                            原因：{failoverReasonText(runtime?.failover_reason)}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="min-w-0 rounded bg-n20 border border-n40 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-n100">生效配置状态</span>
                                <HealthBadge status={status} />
                                <span className="text-[11px] text-n100 font-mono">{health?.health?.status_code || '-'}</span>
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                                <div className="min-w-0">
                                    <div className="text-n100 flex items-center gap-1"><Timer className="w-3 h-3" /> 最近延迟</div>
                                    <div className="text-n700 font-mono">{typeof healthLatency === 'number' ? `${healthLatency} ms` : '-'}</div>
                                </div>
                                <div className="min-w-0">
                                    <div className="text-n100">最后检测</div>
                                    <div className="text-n700 font-mono break-words">{formatTime(healthCheckedAt)}</div>
                                </div>
                                <div className="min-w-0">
                                    <div className="text-n100">余量</div>
                                    <div className="text-n700 font-mono break-words">{usageText}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {healthError && (
                        <div className="mt-2 rounded border border-r75 bg-r50 px-3 py-2 text-[11px] text-r400 break-words">
                            {healthError}
                        </div>
                    )}

                    <section className="mt-2 rounded border border-n40 bg-n20 px-3 py-2 text-[11px]">
                        <div className="font-semibold text-n700">高级测试</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => onTestConfig(config)}
                                disabled={testingConfig || !config.config_id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                                title="只测试这条数据库记录保存的 Key、Endpoint 和模型；结果不会覆盖生效配置健康状态"
                            >
                                {testingConfig ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                                测当前 DB
                            </button>
                            <button
                                type="button"
                                onClick={() => onRealTestConfig(config, categoryView)}
                                disabled={realGenerationBlocked || realTestingConfig || !configHasKey || !config.config_id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium border border-y200 bg-y50 text-y400 hover:bg-y50 disabled:opacity-60"
                                title={realGenerationBlocked
                                    ? '视频生成会创建付费任务，请到业务页面验证'
                                    : '发起一次真实生成请求验证可用性，可能产生厂商费用'}
                            >
                                {realTestingConfig ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertCircle className="w-3 h-3" />}
                                {realGenerationBlocked ? '视频测试已阻止' : '真实生成'}
                            </button>
                            <button
                                type="button"
                                onClick={() => onCheck(provider, categoryModelName)}
                                disabled={checking || !provider}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                                title="检测实际生成调用会使用的生效 Key、Endpoint 和模型"
                            >
                                {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                测运行时
                            </button>
                        </div>
                    </section>

                    {configTest && (
                        <div className={`mt-2 rounded border px-3 py-2 text-[11px] break-words ${configTestClass}`}>
                            <span className="font-semibold">{configTestTitleText}</span>
                            <span>{configTestLabel}</span>
                            {configTest.real_generation && configTest.billable && (
                                <span className="ml-1 rounded border border-y200 bg-y50 px-1.5 py-0.5 text-[10px] font-semibold text-y400">
                                    可能产生费用
                                </span>
                            )}
                            {configTestKeySource && (
                                <span className="ml-1">；Key 来源：{configTestKeySource}</span>
                            )}
                            {configTestEndpoint && (
                                <span className="ml-1">；{configTestEndpoint}</span>
                            )}
                            <span className="mx-1 text-n100">/</span>
                            <span className="font-mono text-n700">
                                {typeof configTest.latency_ms === 'number' ? `${configTest.latency_ms} ms` : '- ms'}
                            </span>
                            <span className="mx-1 text-n100">/</span>
                            <span className="font-mono text-n700">HTTP {configTest.status_code || '-'}</span>
                            <span className="mx-1 text-n100">/</span>
                            <span>{formatTime(configTest.checked_at)}</span>
                            {configTest.url && (
                                <div className="mt-1 font-mono text-n700 break-all">{formatEndpoint(configTest.url)}</div>
                            )}
                            {configTest.endpoint_matches_runtime === false && configTest.runtime_endpoint && (
                                <div className="mt-1 font-mono text-y400 break-all">
                                    运行时 Endpoint: {formatEndpoint(configTest.runtime_endpoint)}
                                </div>
                            )}
                            {configTest.error && (
                                <div className="mt-1 whitespace-pre-line">
                                    {apiConfigErrorMessage(provider, dbEndpoint || runtimeEndpoint, configTest.error)}
                                </div>
                            )}
                        </div>
                    )}

                    {meta?.notes && (
                        <div className="mt-2 text-[11px] text-n100 leading-relaxed break-words">{meta.notes}</div>
                    )}
                    <ProviderOperationPaths meta={meta} runtime={runtime} />
                    <ProviderCredentialLinks meta={meta} endpoint={runtimeEndpoint || dbEndpoint} />
                    </div>
                </div>
            </div>
        )}
        </>
    );
};

const ProviderQuickCard: React.FC<{
    meta: ProviderMeta;
    configs: ApiConfig[];
    runtime?: RuntimeStatus;
    health?: ProviderHealth;
    configTest?: ApiConfigTest;
    checking: boolean;
    testingConfig: boolean;
    testingConfigMap: Record<string, boolean>;
    realTestingConfigMap: Record<string, boolean>;
    onConfigure: (meta: ProviderMeta) => void;
    onAddConfig: (meta: ProviderMeta) => void;
    onEditConfig: (config: ApiConfig) => void;
    onActivate: (config: ApiConfig) => void;
    onToggle: (config: ApiConfig) => void;
    onDelete: (config: ApiConfig) => void;
    onTestConfig: (config: ApiConfig) => void;
    onRealTestConfig: (config: ApiConfig, categoryView?: string) => void;
    onCheck: (provider: string, modelName?: string | null) => void;
}> = ({
    meta,
    configs,
    runtime,
    health,
    configTest,
    checking,
    testingConfig,
    testingConfigMap,
    realTestingConfigMap,
    onConfigure,
    onAddConfig,
    onEditConfig,
    onActivate,
    onToggle,
    onDelete,
    onTestConfig,
    onRealTestConfig,
    onCheck,
}) => {
    const provider = normalizeProvider(meta.provider);
    const realGenerationBlocked = categoryFromProviderMeta(meta) === 'video';
    const primaryConfig = bestConfigForProvider(configs, provider, runtime);
    const activeConfigId = runtime?.db_effective_config_id || primaryConfig?.config_id || '';
    const sortedConfigs = [...configs].sort((a, b) => {
        const aActive = a.config_id === activeConfigId ? 1 : 0;
        const bActive = b.config_id === activeConfigId ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        const aEnabled = a.enabled !== false ? 1 : 0;
        const bEnabled = b.enabled !== false ? 1 : 0;
        if (aEnabled !== bEnabled) return bEnabled - aEnabled;
        const aHasKey = Number(Boolean(a.has_key ?? a.api_key_encrypted));
        const bHasKey = Number(Boolean(b.has_key ?? b.api_key_encrypted));
        if (aHasKey !== bHasKey) return bHasKey - aHasKey;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
    const hasSavedKey = configs.some(config => Boolean(config.has_key ?? config.api_key_encrypted));
    const runtimeHasKey = typeof runtime?.has_key === 'boolean' ? runtime.has_key : hasSavedKey;
    const status = mergedHealthStatus(health, runtime, runtimeHasKey, configTest);
    const view = statusView(status);
    const latency = typeof health?.latency_ms === 'number' ? health.latency_ms : runtime?.health_latency_ms;
    const checkedAt = health?.checked_at || runtime?.health_checked_at || runtime?.health_cached_at;
    const usageText = providerUsageText(health, configTest);
    const endpoint = runtime?.endpoint || primaryConfig?.endpoint || meta.default_endpoint || '';
    const primaryDbEndpoint = primaryConfig?.endpoint || '';
    const runtimePrimaryEndpointMismatch = endpointMismatch(runtime?.endpoint, primaryDbEndpoint);
    const modelNameHint = primaryConfig?.model_name || meta.default_model_name || null;
    const modelName = modelNameHint || runtime?.runtime_model_name || null;
    const model = modelName || '';
    const enabledCount = configs.filter(config => config.enabled !== false).length;
    const keySource = keySourceText(runtime, hasSavedKey);
    const keySourceClass = runtimeHasKey || hasSavedKey ? 'text-g400' : 'text-r400';
    const dbKeyText = dbKeyStateText(hasSavedKey, runtimeHasKey);
    const dbKeyClass = dbKeyStateClass(hasSavedKey, runtimeHasKey);
    const quickConfigTestRuntimeWarningText = configTest?.ok ? configTestRuntimeWarning(configTest) : '';
    const quickConfigTestUsesRuntimeKey = Boolean(configTest?.ok && (configTest.used_runtime_key || quickConfigTestRuntimeWarningText));
    const quickConfigTestTitle = configTestTitle(configTest);
    const quickConfigTestClass = configTestResultClass(configTest, quickConfigTestUsesRuntimeKey);
    const quickConfigTestLabel = configTestLabelText(configTest, quickConfigTestRuntimeWarningText, {
        runtimeKeyOk: '运行时连通正常；DB 仍未保存 Key',
        dbOk: 'DB 配置可用',
        noKey: 'DB 配置未保存 Key',
        error: 'DB 配置异常',
    });
    const quickConfigTestKeySource = !configTest
        ? ''
        : configTest.used_runtime_key
            ? `运行时 ${configTest.key_env || 'Key'}`
            : configTest.key_source === 'db'
                ? 'DB 保存 Key'
                : configTest.key_source === 'missing'
                    ? '未配置 Key'
                    : configTest.key_source || '';
    const quickConfigTestEndpoint = configTestEndpointText(configTest);

    return (
        <article className={`w-full bg-n0 border rounded-md shadow-card p-4 min-w-0 ${
            status === 'ok' ? 'border-g75' : status === 'no_key' || status === 'error' ? 'border-r75' : 'border-y200'
        }`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`w-2.5 h-2.5 rounded-full ${view.dot}`} />
                        <h3 className="text-sm font-semibold text-n800 break-words">{meta.label || provider}</h3>
                        <span className="text-[10px] rounded bg-n20 border border-n40 px-1.5 py-0.5 text-n100 font-mono">
                            {provider}
                        </span>
                    </div>
                    <div className="mt-1 text-[11px] text-n100 break-words">
                        {meta.vendor || '-'} · {CATEGORY_LABELS[categoryFromProviderMeta(meta)] || '其他'}
                    </div>
                    <ProviderCredentialLinks meta={meta} endpoint={endpoint} compact showHelp={false} />
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[10px] uppercase tracking-wider text-n100">生效配置状态</span>
                    <HealthBadge status={status} />
                </div>
            </div>

            <div className="mt-3 grid gap-2 text-[11px]">
                <div className="min-w-0">
                    <div className="text-n100">Endpoint</div>
                    <div className="font-mono text-n700 break-all">{formatEndpoint(endpoint)}</div>
                    {runtimePrimaryEndpointMismatch && (
                        <div className="mt-1 text-y400 break-all">
                            DB Endpoint: <span className="font-mono">{formatEndpoint(primaryDbEndpoint)}</span>
                        </div>
                    )}
                </div>
                <div className="min-w-0">
                    <div className="text-n100">操作绑定</div>
                    <div className="font-mono text-n700 break-all">{primaryConfig ? apiConfigModelBindings(primaryConfig, meta).length : 0}</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <div className="text-n100">配置</div>
                        <div className="font-mono text-n700">{configs.length}</div>
                    </div>
                    <div>
                        <div className="text-n100">启用</div>
                        <div className="font-mono text-n700">{enabledCount}</div>
                    </div>
                    <div>
                        <div className="text-n100">延迟</div>
                        <div className="font-mono text-n700">{typeof latency === 'number' ? `${latency} ms` : '-'}</div>
                    </div>
                </div>
                <div className="text-[11px] text-n100">
                    生效 Key：<span className={`font-mono break-words ${keySourceClass}`}>{keySource}</span>
                </div>
                <div className="text-[11px] text-n100">
                    DB Key：<span className={`font-mono break-words ${dbKeyClass}`}>{dbKeyText}</span>
                </div>
                <div className="text-[11px] text-n100">
                    最后检测：<span className="font-mono text-n700 break-words">{formatTime(checkedAt)}</span>
                </div>
                <div className="text-[11px] text-n100">
                    余量：<span className="font-mono text-n700 break-words">{usageText}</span>
                </div>
                {runtime?.issues?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                        {runtimeIssueText(runtime.issues).split('，').map(issue => (
                            <span key={issue} className="rounded bg-y50 text-y400 px-1.5 py-0.5 text-[10px] font-semibold">{issue}</span>
                        ))}
                    </div>
                ) : null}
            </div>

            {sortedConfigs.length > 0 && (
                <details className="mt-3 rounded border border-n40 bg-n20 overflow-hidden text-[11px]">
                    <summary className="cursor-pointer select-none border-b border-n40 px-3 py-2 font-semibold text-n700">
                        API Key ({sortedConfigs.length})
                    </summary>
                    <div className="flex items-center justify-between gap-2 border-b border-n40 px-3 py-2">
                        <div className="text-[11px] font-semibold text-n700">API Key 列表</div>
                        <button
                            type="button"
                            onClick={() => onAddConfig(meta)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-n40 bg-n0 text-n700 hover:bg-n20"
                            title="为该厂商继续添加一个或多个 Key"
                        >
                            <Plus className="w-3 h-3" />
                            添加 Key
                        </button>
                    </div>
                    <div className="divide-y divide-n40">
                        {sortedConfigs.map(config => {
                            const hasKey = Boolean(config.has_key ?? config.api_key_encrypted);
                            const active = config.config_id === activeConfigId;
                            const bindings = uniqueModelBindingsForDisplay(apiConfigModelBindings(config, meta));
                            return (
                                <div key={config.config_id} className="px-3 py-2">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="font-medium text-n800 break-words">{config.name || config.config_id}</span>
                                                {active && (
                                                    <span className="rounded bg-g50 text-g400 px-1.5 py-0.5 text-[10px] font-semibold">当前生效</span>
                                                )}
                                                {config.enabled === false && (
                                                    <span className="rounded bg-r50 text-r400 px-1.5 py-0.5 text-[10px] font-semibold">禁用</span>
                                                )}
                                                {config.api_key_preview && (
                                                    <span className="rounded bg-n0 border border-n40 text-n300 px-1.5 py-0.5 text-[10px] font-mono">{config.api_key_preview}</span>
                                                )}
                                                {!hasKey && (
                                                    <span className="rounded bg-y50 text-y400 px-1.5 py-0.5 text-[10px] font-semibold">未保存 Key</span>
                                                )}
                                            </div>
                                            <div className="mt-1 font-mono text-[10px] text-n100 break-all">
                                                {formatEndpoint(config.endpoint || endpoint)}
                                            </div>
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {bindings.map(binding => (
                                                    <span key={modelBindingKey(binding)} className="rounded border border-n40 bg-n0 px-1.5 py-0.5 text-[10px] text-n700">
                                                        <span className="mr-1 rounded bg-n20 px-1 text-n300">{binding.scope_label || modelUsageScopeLabel(binding.scope)}</span>
                                                        {binding.label || binding.operation} → <span className="font-mono">{binding.model_name}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap justify-end gap-1.5">
                                            {!active && (
                                                <button
                                                    type="button"
                                                    onClick={() => onActivate(config)}
                                                    disabled={!hasKey || !config.config_id}
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-g75 bg-g50 text-g400 hover:bg-g50 disabled:opacity-50"
                                                >
                                                    <KeyRound className="w-3 h-3" />
                                                    设为生效
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => onEditConfig(config)}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-n40 bg-n0 text-n700 hover:bg-n20"
                                            >
                                                <Edit3 className="w-3 h-3" />
                                                编辑
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onToggle(config)}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-n40 bg-n0 text-n700 hover:bg-n20"
                                            >
                                                {config.enabled === false ? '启用' : '禁用'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onDelete(config)}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-danger/30 bg-r50 text-danger hover:bg-r50"
                                            >
                                                删除
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </details>
            )}

            <ProviderOperationPaths meta={meta} runtime={runtime} compact collapsed />

            <div className="mt-3 flex flex-wrap gap-2">
                {primaryConfig ? (
                    <>
                        <button
                            type="button"
                            onClick={() => onEditConfig(primaryConfig)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-primary hover:bg-primary-hover"
                            title="打开配置弹窗，可修改 Endpoint、模型名和 API Key"
                        >
                            <KeyRound className="w-3.5 h-3.5" />
                            配置 / 修改 API Key
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={() => onConfigure(meta)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-primary hover:bg-primary-hover"
                        title="新增此厂商的 Endpoint、模型名和 API Key"
                    >
                        <KeyRound className="w-3.5 h-3.5" />
                        配置 / 修改 API Key
                    </button>
                )}
                {primaryConfig && (
                    <button
                        type="button"
                        onClick={() => onAddConfig(meta)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20"
                        title="为该厂商继续添加一个或多个 Key"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        添加 Key
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => onCheck(provider, model || null)}
                    disabled={checking || !provider}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                    title="检测当前实际生效的 Key、Endpoint 和模型是否连通"
                >
                    {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    连通性检测
                </button>
            </div>

            <details className="mt-3 rounded border border-n40 bg-n20 px-3 py-2 text-[11px]">
                <summary className="cursor-pointer select-none font-semibold text-n700">高级测试</summary>
                <div className="mt-2 space-y-2">
                    {primaryConfig && (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-n100">当前卡片</span>
                            <button
                                type="button"
                                onClick={() => onTestConfig(primaryConfig)}
                                disabled={testingConfig || !primaryConfig.config_id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                                title="只测试当前卡片选中的数据库记录，不切换生效 Key"
                            >
                                {testingConfig ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                                测当前 DB
                            </button>
                            <button
                                type="button"
                                onClick={() => onRealTestConfig(primaryConfig)}
                                disabled={
                                    realGenerationBlocked
                                    ||
                                    Boolean(realTestingConfigMap[primaryConfig.config_id])
                                    || !Boolean(primaryConfig.has_key ?? primaryConfig.api_key_encrypted)
                                    || !primaryConfig.config_id
                                }
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium border border-y200 bg-y50 text-y400 hover:bg-y50 disabled:opacity-60"
                                title={realGenerationBlocked
                                    ? '视频生成会创建付费任务，请到业务页面验证'
                                    : '使用当前卡片选中的 Key 发起一次真实生成请求，可能产生厂商费用'}
                            >
                                {realTestingConfigMap[primaryConfig.config_id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertCircle className="w-3 h-3" />}
                                {realGenerationBlocked ? '视频测试已阻止' : '真实生成'}
                            </button>
                            <button
                                type="button"
                                onClick={() => onCheck(provider, model || null)}
                                disabled={checking || !provider}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                                title="检测实际生成调用会使用的生效 Key、Endpoint 和模型"
                            >
                                {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                测运行时
                            </button>
                        </div>
                    )}

                    {sortedConfigs.length > 0 && (
                        <div className="space-y-1.5 border-t border-n40 pt-2">
                            {sortedConfigs.map(config => {
                                const hasKey = Boolean(config.has_key ?? config.api_key_encrypted);
                                const rowTesting = testingConfig || Boolean(testingConfigMap[config.config_id]);
                                const rowRealTesting = Boolean(realTestingConfigMap[config.config_id]);
                                return (
                                    <div key={`advanced-${config.config_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded bg-n0 border border-n40 px-2 py-1.5">
                                        <span className="min-w-0 font-mono text-n700 break-all">{config.name || config.config_id}</span>
                                        <div className="flex flex-wrap gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => onTestConfig(config)}
                                                disabled={rowTesting || !config.config_id}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                                                title="只测试这一条 Key 记录保存的 Key、Endpoint 和模型；不会把它设为生效"
                                            >
                                                {rowTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                                                测试此 Key
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onRealTestConfig(config)}
                                                disabled={realGenerationBlocked || rowRealTesting || !hasKey || !config.config_id}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-y200 bg-y50 text-y400 hover:bg-y50 disabled:opacity-60"
                                                title={realGenerationBlocked
                                                    ? '视频生成会创建付费任务，请到业务页面验证'
                                                    : '使用这一条 Key 发起一次真实生成请求，可能产生厂商费用；不会把它设为生效'}
                                            >
                                                {rowRealTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertCircle className="w-3 h-3" />}
                                                {realGenerationBlocked ? '视频测试已阻止' : '真实生成'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </details>

            {configTest && (
                <div className={`mt-2 rounded border px-2 py-1.5 text-[11px] break-words ${quickConfigTestClass}`}>
                    <span className="font-semibold">{quickConfigTestTitle}</span>
                    <span>{quickConfigTestLabel}</span>
                    {configTest.real_generation && configTest.billable && (
                        <span className="ml-1 rounded border border-y200 bg-y50 px-1.5 py-0.5 text-[10px] font-semibold text-y400">
                            可能产生费用
                        </span>
                    )}
                    {quickConfigTestKeySource && (
                        <span className="ml-1">Key 来源：{quickConfigTestKeySource}</span>
                    )}
                    {quickConfigTestEndpoint && (
                        <span className="ml-1">；{quickConfigTestEndpoint}</span>
                    )}
                    <span className="mx-1 text-n100">/</span>
                    <span className="font-mono text-n700">{typeof configTest.latency_ms === 'number' ? `${configTest.latency_ms} ms` : '- ms'}</span>
                    <span className="mx-1 text-n100">/</span>
                    <span className="font-mono text-n700">HTTP {configTest.status_code || '-'}</span>
                    {configTest.endpoint_matches_runtime === false && configTest.runtime_endpoint && (
                        <div className="mt-1 font-mono text-y400 break-all">
                            运行时 Endpoint: {formatEndpoint(configTest.runtime_endpoint)}
                        </div>
                    )}
                    {configTest.error && <div className="mt-1">{configTest.error}</div>}
                </div>
            )}
        </article>
    );
};

const AdminRecycleBinPanel: React.FC = () => {
    const [items, setItems] = useState<TrashFile[]>([]);
    const [total, setTotal] = useState(0);
    const [diskBytes, setDiskBytes] = useState(0);
    const [keyword, setKeyword] = useState('');
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<Record<string, boolean>>({});
    const [previewItem, setPreviewItem] = useState<TrashFile | null>(null);

    const loadTrash = useCallback(async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({ limit: '50', offset: '0' });
            if (keyword.trim()) query.set('keyword', keyword.trim());
            const result = await apiJson<TrashFilesResponse>(`/api/admin/trash/files?${query.toString()}`);
            setItems(result.items || []);
            setTotal(result.total || 0);
            setDiskBytes(result.disk_bytes || 0);
        } catch (err: any) {
            crmMessage.error(`回收站加载失败：${err?.message || 'unknown'}`);
        } finally {
            setLoading(false);
        }
    }, [keyword]);

    useEffect(() => {
        loadTrash();
    }, [loadTrash]);

    const setItemBusy = (fileId: string, value: boolean) => {
        setBusy(prev => ({ ...prev, [fileId]: value }));
    };

    const restoreFile = useCallback(async (item: TrashFile) => {
        if (!item.file_id) return;
        const warnings = item.restore_warnings || [];
        if (warnings.length) {
            const ok = await crmConfirm({
                title: '恢复前确认',
                message: `文件：${item.media_name || item.file_name || item.file_id}。${warnings.join('；')} 是否继续恢复？`,
                type: item.restore_visibility === 'missing_disk' ? 'danger' : 'warning',
                confirmText: '继续恢复',
            });
            if (!ok) return;
        }
        setItemBusy(item.file_id, true);
        try {
            const result = await apiJson<TrashRestoreResponse>(`/api/admin/trash/files/${encodeURIComponent(item.file_id)}/restore`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            setPreviewItem(null);
            if (result.restore_warnings?.length) {
                crmMessage.warning(`文件已恢复，但请注意：${result.restore_warnings.join('；')}`);
            } else {
                const targets = result.restore_targets?.length ? `：${result.restore_targets.join('、')}` : '';
                crmMessage.success(`文件已从回收站恢复${targets}`);
            }
            await loadTrash();
        } catch (err: any) {
            crmMessage.error(`恢复失败：${err?.message || 'unknown'}`);
        } finally {
            setItemBusy(item.file_id, false);
        }
    }, [loadTrash]);

    const purgeFile = useCallback(async (item: TrashFile) => {
        if (!item.file_id) return;
        const ok = await crmConfirm({
            title: '彻底释放磁盘空间',
            message: `将永久删除磁盘文件并删除文件库记录，操作不可恢复。文件：${item.file_name || item.file_id}，预计释放 ${formatBytes(item.disk_size_bytes)}。确认继续？`,
            type: 'danger',
            confirmText: '彻底删除',
        });
        if (!ok) return;
        setItemBusy(item.file_id, true);
        try {
            const result = await apiJson<TrashPurgeResponse>(`/api/admin/trash/files/${encodeURIComponent(item.file_id)}/purge`, {
                method: 'DELETE',
                body: JSON.stringify({ risk_ack: true, delete_db_record: true }),
            });
            if (result.success) {
                setPreviewItem(null);
                crmMessage.success(`已释放 ${formatBytes(result.freed_bytes)}`);
            } else {
                crmMessage.error(`释放失败：${result.errors?.[0]?.error || 'unknown'}`);
            }
            await loadTrash();
        } catch (err: any) {
            crmMessage.error(`释放失败：${err?.message || 'unknown'}`);
        } finally {
            setItemBusy(item.file_id, false);
        }
    }, [loadTrash]);

    const downloadTrashFile = useCallback(async (item: TrashFile) => {
        if (!item.file_id || !item.download_available) {
            crmMessage.warning(item.preview_unavailable_reason || '磁盘文件不存在，无法下载。');
            return;
        }
        const url = trashDownloadUrl(item);
        if (!url) {
            crmMessage.warning('缺少下载地址。');
            return;
        }
        setItemBusy(item.file_id, true);
        try {
            const blob = await apiBlob(url, { method: 'GET' }, '下载回收站文件', { includeContentType: false });
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = trashDownloadName(item);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            crmMessage.success('已开始下载。');
        } catch (err: any) {
            crmMessage.error(`下载失败：${err?.message || '文件不存在或无权限'}`);
            await loadTrash();
        } finally {
            setItemBusy(item.file_id, false);
        }
    }, [loadTrash]);

    return (
        <section className="bg-n0 border border-n40 rounded-md shadow-card p-4 min-w-0">
            <div className="responsive-toolbar flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-n100">
                        <Trash2 className="w-3.5 h-3.5" />
                        Recycle Bin
                    </div>
                    <h2 className="mt-1 text-sm font-semibold text-n800">文件回收站</h2>
                    <p className="mt-0.5 text-xs text-n100">仅展示已软删除文件。释放磁盘会永久删除本地文件；以后切到 OSS 后可调整为对象软删除。</p>
                </div>
                <div className="toolbar-actions">
                    <input
                        value={keyword}
                        onChange={event => setKeyword(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') loadTrash(); }}
                        className="w-52 rounded border border-n40 bg-n0 px-3 py-1.5 text-xs text-n800 focus:border-primary focus:outline-none"
                        placeholder="搜索文件名 / URL"
                    />
                    <button
                        type="button"
                        onClick={loadTrash}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                    >
                        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        刷新
                    </button>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded border border-n40 bg-n20 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-n100">Deleted Files</div>
                    <div className="mt-1 font-mono text-lg font-semibold text-n800">{total}</div>
                </div>
                <div className="rounded border border-n40 bg-n20 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-n100">Current Page Disk</div>
                    <div className="mt-1 font-mono text-lg font-semibold text-n800">{formatBytes(diskBytes)}</div>
                </div>
                <div className="rounded border border-y200 bg-y50 px-3 py-2 md:col-span-2">
                    <div className="text-xs font-semibold text-y400">风险提示</div>
                    <div className="mt-1 text-[11px] text-y400">恢复会撤销文件和素材库软删除，但不会重建已清空的分镜/视频/资产字段；释放磁盘会删除本机 persistent_storage 文件并移除文件记录，不可恢复。</div>
                </div>
            </div>

            <div className="mt-3 overflow-x-auto border border-n40 rounded-md">
                <table className="min-w-full text-xs">
                    <thead className="bg-n20 text-n100">
                        <tr>
                            <th className="text-left font-medium px-3 py-2">预览</th>
                            <th className="text-left font-medium px-3 py-2">文件</th>
                            <th className="text-left font-medium px-3 py-2">类型</th>
                            <th className="text-left font-medium px-3 py-2">磁盘</th>
                            <th className="text-left font-medium px-3 py-2">恢复去向</th>
                            <th className="text-left font-medium px-3 py-2">删除时间</th>
                            <th className="text-right font-medium px-3 py-2">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-n40">
                        {loading ? (
                            <tr>
                                <td colSpan={7} className="px-3 py-8 text-center text-n100">
                                    <Loader2 className="inline w-4 h-4 animate-spin mr-2" />
                                    加载中
                                </td>
                            </tr>
                        ) : items.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-3 py-8 text-center text-n100">暂无回收站文件</td>
                            </tr>
                        ) : items.map(item => (
                            <tr key={item.file_id} className="bg-n0">
                                <td className="px-3 py-2 w-[88px] align-top">
                                    {isPreviewableTrashImage(item) ? (
                                        <button
                                            type="button"
                                            onClick={() => setPreviewItem(item)}
                                            className="group relative block w-16 h-16 overflow-hidden rounded border border-n40 bg-n20 hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                                            title="点击预览"
                                        >
                                            <img
                                                src={trashPreviewUrl(item)}
                                                alt={item.media_name || item.file_name || item.file_id}
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />
                                            <span className="absolute inset-x-0 bottom-0 hidden bg-n900/70 px-1 py-0.5 text-[10px] text-n0 group-hover:block">
                                                预览
                                            </span>
                                        </button>
                                    ) : (
                                        <div className="flex w-16 h-16 flex-col items-center justify-center rounded border border-dashed border-n40 bg-n20 text-[10px] text-n100">
                                            <ImageIcon className="w-4 h-4 mb-1" />
                                            {item.preview_unavailable_reason ? '文件缺失' : '无预览'}
                                        </div>
                                    )}
                                </td>
                                <td className="px-3 py-2 min-w-[260px]">
                                    <div className="font-medium text-n800 break-words">{item.media_name || item.file_name || item.file_id}</div>
                                    <div className="mt-0.5 font-mono text-[11px] text-n100 break-all">{item.file_url || item.file_path || '-'}</div>
                                </td>
                                <td className="px-3 py-2 font-mono text-n700">{item.file_type || '-'}</td>
                                <td className="px-3 py-2">
                                    <div className={item.disk_exists ? 'text-g400' : 'text-n100'}>{item.disk_exists ? '存在' : '不存在'}</div>
                                    <div className="font-mono text-n700">{formatBytes(item.disk_size_bytes)}</div>
                                </td>
                                <td className="px-3 py-2 min-w-[190px]">
                                    <div className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${restoreVisibilityClass(item)}`}>
                                        {restoreVisibilityText(item)}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {(item.restore_targets || ['仅文件记录']).map((target, index) => (
                                            <span key={`${item.file_id}-target-${index}`} className="rounded border border-n40 bg-n20 px-1.5 py-0.5 text-[10px] text-n700">
                                                {target}
                                            </span>
                                        ))}
                                    </div>
                                    {item.restore_warnings?.length ? (
                                        <div className="mt-1 text-[10px] leading-snug text-y400">
                                            {item.restore_warnings.join('；')}
                                        </div>
                                    ) : null}
                                </td>
                                <td className="px-3 py-2 font-mono text-n700">{formatTime(item.deleted_at)}</td>
                                <td className="px-3 py-2">
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => downloadTrashFile(item)}
                                            disabled={Boolean(busy[item.file_id]) || !item.download_available}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-50"
                                            title={item.download_available ? '下载原文件' : (item.preview_unavailable_reason || '磁盘文件不存在，无法下载')}
                                        >
                                            <Download className="w-3.5 h-3.5" />
                                            下载
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => restoreFile(item)}
                                            disabled={Boolean(busy[item.file_id])}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                                        >
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                            恢复
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => purgeFile(item)}
                                            disabled={Boolean(busy[item.file_id]) || !item.purge_eligible}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-danger/30 bg-r50 text-danger hover:bg-r50 disabled:opacity-60"
                                            title={item.purge_blocked_reason || ''}
                                        >
                                            {busy[item.file_id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                            释放磁盘
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {previewItem && isPreviewableTrashImage(previewItem) && (
                <div
                    className="fixed inset-0 z-[10002] flex items-center justify-center bg-n900/70 p-4"
                    onClick={() => setPreviewItem(null)}
                >
                    <div
                        className="w-full max-w-5xl overflow-hidden rounded-md border border-n40 bg-n0 shadow-bottom"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-3 border-b border-n40 px-4 py-3">
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-n800 truncate">
                                    {previewItem.media_name || previewItem.file_name || previewItem.file_id}
                                </div>
                                <div className="mt-0.5 font-mono text-[11px] text-n100 truncate">
                                    {previewItem.file_url || previewItem.file_path || '-'}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPreviewItem(null)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded border border-n40 bg-n0 text-n700 hover:bg-n20"
                                aria-label="关闭预览"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="max-h-[76vh] overflow-auto bg-n900/5 p-4">
                            <img
                                src={trashPreviewUrl(previewItem)}
                                alt={previewItem.media_name || previewItem.file_name || previewItem.file_id}
                                className="mx-auto max-h-[70vh] max-w-full rounded border border-n40 bg-n0 object-contain"
                            />
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
};

const ApiConfigPanel: React.FC = () => {
    const importKeyFileInputRef = useRef<HTMLInputElement | null>(null);
    const [configs, setConfigs] = useState<ApiConfig[]>([]);
    const [providers, setProviders] = useState<ProviderMeta[]>([]);
    const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus[]>([]);
    const [healthMap, setHealthMap] = useState<Record<string, ProviderHealth>>({});
    const [monitorState, setMonitorState] = useState<ProviderHealthMonitorState | null>(null);
    const [configTestMap, setConfigTestMap] = useState<Record<string, ApiConfigTest>>({});
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState<Record<string, boolean>>({});
    const [testingConfig, setTestingConfig] = useState<Record<string, boolean>>({});
    const [realTestingConfig, setRealTestingConfig] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<string>('');
    const [editingForm, setEditingForm] = useState<ApiConfigFormState | null>(null);
    const [saving, setSaving] = useState(false);
    const [sweeping, setSweeping] = useState(false);
    const [refreshingHealth, setRefreshingHealth] = useState(false);
    const [testingAllConfigs, setTestingAllConfigs] = useState(false);
    const [reloadingEnv, setReloadingEnv] = useState(false);
    const [repairingConflicts, setRepairingConflicts] = useState(false);
    const [migratingRuntimeKeys, setMigratingRuntimeKeys] = useState(false);
    const [exportingKeys, setExportingKeys] = useState(false);
    const [importingKeys, setImportingKeys] = useState(false);
    const [activeCategory, setActiveCategory] = useState<string>(() => {
        try {
            if (typeof window === 'undefined') return 'text';
            const saved = window.localStorage.getItem('admin_api_config_category');
            return saved && CATEGORY_LABELS[saved] ? saved : 'text';
        } catch {
            return 'text';
        }
    });

    const loadConfigs = useCallback(async (options?: { showLoading?: boolean }) => {
        const showLoading = options?.showLoading !== false;
        if (showLoading) setLoading(true);
        setError('');
        try {
            const data = await apiJson<ApiConfigsResponse>('/api/admin/api-configs');
            const rows = (data.api_configs || data.configs || []).filter(item => normalizeProvider(item.provider) !== 'comfyui');
            setConfigs(rows);
            setProviders(data.providers || []);
            setRuntimeStatus(data.runtime_status || []);
            setMonitorState(data.monitor_state || null);
            setHealthMap(buildProviderHealthMap(data.provider_health || []));


            const persistedTests = buildConfigTestMapFromHealth(rows, data.provider_health || []);
            if (Object.keys(persistedTests).length > 0) {
                setConfigTestMap(prev => ({ ...prev, ...persistedTests }));
            }
        } catch (err: any) {
            const message = err?.message || '加载 API 配置失败';
            setError(message);
            crmMessage.error(`API 配置加载失败：${message}`);
        } finally {
            if (showLoading) setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadConfigs();
    }, [loadConfigs]);

    const refreshHealthCache = useCallback(async () => {
        setRefreshingHealth(true);
        try {
            const result = await apiJson<ProviderHealthCacheResponse>('/api/admin/api-configs/health/cache');
            const rows = result.provider_health || [];
            setMonitorState(result.monitor_state || null);
            setHealthMap(buildProviderHealthMap(rows));
            const summary = result.summary || {};
            crmMessage.success(`状态已刷新：ok ${summary.ok ?? 0} / reachable ${summary.connectivity_ok ?? 0} / error ${summary.error ?? 0} / no_key ${summary.no_key ?? 0}`);
        } catch (err: any) {
            crmMessage.error(`刷新状态失败：${err?.message || 'unknown'}`);
        } finally {
            setRefreshingHealth(false);
        }
    }, []);

    const providerMetaMap = useMemo(() => {
        const out = new Map<string, ProviderMeta>();
        providers.forEach(item => out.set(normalizeProvider(item.provider), item));
        return out;
    }, [providers]);

    const runtimeMap = useMemo(() => {
        const out = new Map<string, RuntimeStatus>();
        runtimeStatus.forEach(item => {
            const provider = normalizeProvider(item.provider);
            if (provider && !out.has(provider)) out.set(provider, item);
        });
        return out;
    }, [runtimeStatus]);

    const runtimeByKey = useMemo(() => {
        const out = new Map<string, RuntimeStatus>();
        runtimeStatus.forEach(item => {
            const provider = normalizeProvider(item.provider);
            if (!provider) return;
            const key = runtimeStatusKey(provider, item.model_name || item.runtime_model_name);
            if (!out.has(key)) out.set(key, item);
        });
        return out;
    }, [runtimeStatus]);

    const runtimeForProviderModel = useCallback((providerRaw: string, modelName?: string | null): RuntimeStatus | undefined => {
        const provider = normalizeProvider(providerRaw);
        if (!provider) return undefined;
        const model = String(modelName || '').trim();
        return runtimeByKey.get(runtimeStatusKey(provider, model)) || runtimeMap.get(provider);
    }, [runtimeByKey, runtimeMap]);

    const runtimeForConfig = useCallback((config: ApiConfig): RuntimeStatus | undefined => {
        const provider = normalizeProvider(config.provider);
        return runtimeForProviderModel(provider, config.model_name || '');
    }, [runtimeForProviderModel]);

    const grouped = useMemo(() => {
        const out: Record<string, ApiConfig[]> = {};
        configs.forEach(config => {
            const meta = providerMetaMap.get(normalizeProvider(config.provider));
            apiConfigCategories(config, meta?.capabilities || []).forEach(category => {
                if (!out[category]) out[category] = [];
                out[category].push(config);
            });
        });
        return out;
    }, [configs, providerMetaMap]);

    const categoryTabs = useMemo(() => {
        return API_CONFIG_CATEGORY_ORDER
            .filter(category => category !== 'other' || (grouped.other || []).length > 0)
            .map(category => ({
                key: category,
                label: CATEGORY_LABELS[category] || category,
                count: apiConfigDisplayItemsForCategory(category, grouped[category] || [], runtimeMap).length,
            }));
    }, [grouped, runtimeMap]);

    const activeCategoryItems = useMemo(
        () => apiConfigDisplayItemsForCategory(activeCategory, grouped[activeCategory] || [], runtimeMap),
        [activeCategory, grouped, runtimeMap],
    );

    const selectCategory = useCallback((category: string) => {
        setActiveCategory(category);
        try {
            if (typeof window !== 'undefined') {
                window.localStorage.setItem('admin_api_config_category', category);
            }
        } catch {}
    }, []);

    useEffect(() => {
        if (categoryTabs.some(tab => tab.key === activeCategory)) return;
        selectCategory('text');
    }, [activeCategory, categoryTabs, selectCategory]);

    const configsByProvider = useMemo(() => {
        const out = new Map<string, ApiConfig[]>();
        configs.forEach(config => {
            const provider = normalizeProvider(config.provider);
            if (!provider) return;
            const existing = out.get(provider) || [];
            existing.push(config);
            out.set(provider, existing);
        });
        return out;
    }, [configs]);

    const summary = useMemo(() => {
        const providerIds = Array.from(new Set(configs.map(item => normalizeProvider(item.provider)).filter(Boolean)));
        const dbKeyedProviders = Array.from(new Set(
            configs
                .filter(item => Boolean(item.has_key ?? item.api_key_encrypted))
                .map(item => normalizeProvider(item.provider))
                .filter(Boolean)
        ));
        const dbKeyedProviderSet = new Set(dbKeyedProviders);
        const runtimeKeyedProviders = Array.from(new Set(
            runtimeStatus
                .filter(item => item.has_key)
                .map(item => normalizeProvider(item.provider))
                .filter(Boolean)
        ));
        const runtimeOnlyKeyProviders = runtimeKeyedProviders.filter(provider => !dbKeyedProviderSet.has(provider));
        const counts = { ok: 0, error: 0, no_key: 0, blocked_region: 0, connectivity_ok: 0, unknown: 0 };
        providerIds.forEach(provider => {
            const runtime = runtimeMap.get(provider);
            counts[healthStatusFrom(providerHealthFrom(healthMap, provider, runtime?.runtime_model_name), runtime)] += 1;
        });
        return {
            total: configs.length,
            providers: providerIds.length,
            configured: configs.filter(item => Boolean(item.has_key ?? item.api_key_encrypted)).length,
            dbKeyedProviders: dbKeyedProviders.length,
            runtimeKeyedProviders: runtimeKeyedProviders.length,
            runtimeOnlyKeyProviders,
            counts,
        };
    }, [configs, healthMap, runtimeMap, runtimeStatus]);

    const testProvider = useCallback(async (providerRaw: string, modelName?: string | null) => {
        const provider = normalizeProvider(providerRaw);
        if (!provider) return;
        const model = String(modelName || '').trim();
        const query = new URLSearchParams();
        if (model) query.set('model_name', model);
        const suffix = query.toString() ? `?${query.toString()}` : '';
        const displayName = model ? `${provider} / ${model}` : provider;
        const checkKey = providerHealthKey(provider, model);
        setChecking(prev => ({ ...prev, [checkKey]: true }));
        try {
            const result = await apiJson<ProviderHealth>(`/api/admin/api-configs/${encodeURIComponent(provider)}/health${suffix}`);
            setHealthMap(prev => {
                const next = { ...prev };
                putProviderHealth(next, result, model);
                return next;
            });
            await loadConfigs({ showLoading: false });
            const status = healthStatusFromResult(result);
            if (status === 'ok') {
                crmMessage.success(`${provider} 连接正常 (${result.latency_ms ?? '-'} ms)`);
            } else if (status === 'no_key') {
                crmMessage.warning(`${provider} 缺少 API Key`);
            } else if (status === 'connectivity_ok') {
                crmMessage.warning(`${provider} 连接可达，但真实生成未验证 (${result.latency_ms ?? '-'} ms)`);
            } else if (status === 'blocked_region') {
                crmMessage.warning(`${provider} 地区受限：${result.health?.error || result.status || 'unknown'}`);
            } else {
                crmMessage.error(`${provider} 连接异常：${result.health?.error || result.status || 'unknown'}`);
            }
        } catch (err: any) {
            crmMessage.error(`${provider} 测试失败：${err?.message || 'unknown'}`);
        } finally {
            setChecking(prev => ({ ...prev, [checkKey]: false }));
        }
    }, [loadConfigs]);

    const testConfig = useCallback(async (config: ApiConfig) => {
        const configId = config.config_id;
        if (!configId) return;
        setTestingConfig(prev => ({ ...prev, [configId]: true }));
        try {
            const startedAt = performance.now();
            const result = await apiJson<ApiConfigTestResponse>(`/api/admin/api-configs/${encodeURIComponent(configId)}/test`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const latencyMs = Math.round(performance.now() - startedAt);
            const test = { ...(result.test || {}), latency_ms: latencyMs };
            setConfigTestMap(prev => ({
                ...prev,
                [configId]: mergeConfigTestPreservingVerification(prev[configId], test),
            }));
            if (test.ok) {
                const runtimeWarning = configTestRuntimeWarning(test);
                if (runtimeWarning) {
                    crmMessage.warning(`${config.name || config.provider} ${runtimeWarning}`);
                } else if (test.used_runtime_key) {
                    crmMessage.warning(`${config.name || config.provider} 运行时 Key 可用，但 DB 未保存 Key`);
                } else {
                    crmMessage.success(`${config.name || config.provider} 配置可用`);
                }
            } else if (test.error === 'No API key configured') {
                crmMessage.warning(`${config.name || config.provider} 缺少 API Key`);
            } else if (healthStatusFromConfigTest(test) === 'connectivity_ok') {
                crmMessage.warning(`${config.name || config.provider} 连接可达，但真实生成未验证`);
            } else if (healthStatusFromConfigTest(test) === 'blocked_region') {
                crmMessage.warning(`${config.name || config.provider} 地区受限：${test.error || `HTTP ${test.status_code || '-'}`}`);
            } else {
                const errorMessage = apiConfigErrorMessage(
                    config.provider,
                    config.endpoint,
                    test.error || `HTTP ${test.status_code || '-'}`,
                );
                crmMessage.error(`${config.name || config.provider} 配置异常：${errorMessage}`);
            }
        } catch (err: any) {
            crmMessage.error(`配置测试失败：${err?.message || 'unknown'}`);
        } finally {
            setTestingConfig(prev => ({ ...prev, [configId]: false }));
        }
    }, []);

    const realTestConfig = useCallback(async (config: ApiConfig, categoryView?: string) => {
        const configId = config.config_id;
        if (!configId) return;
        const displayName = config.name || config.provider || configId;
        const ok = await crmConfirm({
            title: '真实生成测试',
            message: `将使用「${displayName}」向厂商发起一次真实生成请求。该操作可能产生费用，是否继续？`,
            type: 'warning',
            confirmText: '开始测试',
        });
        if (!ok) return;

        setRealTestingConfig(prev => ({ ...prev, [configId]: true }));
        crmMessage.info(`${displayName} 真实生成测试已开始，火山引擎可能需要 10-30 秒返回`);
        try {
            const startedAt = performance.now();
            const result = await apiJson<ApiConfigTestResponse>(`/api/admin/api-configs/${encodeURIComponent(configId)}/real-test`, {
                method: 'POST',
                body: JSON.stringify({ category: categoryView || '' }),
            });
            const latencyMs = Math.round(performance.now() - startedAt);
            const test: ApiConfigTest = {
                ...(result.test || {}),
                latency_ms: result.test?.latency_ms ?? latencyMs,
                real_generation: true,
                billable: result.test?.billable ?? true,
            };
            setConfigTestMap(prev => ({ ...prev, [configId]: test }));
            const providerHealth = result.provider_health || providerHealthFromRealGenerationTest(config, test);
            if (providerHealth) {
                setHealthMap(prev => {
                    const next = { ...prev };
                    putProviderHealth(next, providerHealth, test.model_name || config.model_name || null);
                    return next;
                });
            }
            await loadConfigs({ showLoading: false });
            if (test.ok) {
                crmMessage.success(`${displayName} 真实生成测试通过${test.output_type ? `（${test.output_type}）` : ''}`);
            } else if (isUnsupportedRealGenerationTest(test)) {
                crmMessage.warning(`${displayName} 暂不支持后台真实生成测试，请到业务页面验证`);
            } else if (isNoKeyTest(test)) {
                crmMessage.warning(`${displayName} 缺少 API Key`);
            } else {
                const errorMessage = apiConfigErrorMessage(
                    config.provider,
                    config.endpoint,
                    test.error || `HTTP ${test.status_code || '-'}`,
                );
                crmMessage.error(`${displayName} 真实生成测试失败：${errorMessage}`);
            }
        } catch (err: any) {
            crmMessage.error(`真实生成测试失败：${err?.message || 'unknown'}`);
        } finally {
            setRealTestingConfig(prev => ({ ...prev, [configId]: false }));
        }
    }, [loadConfigs]);

    const testAllConfigs = useCallback(async () => {
        if (!configs.length) return;
        setTestingAllConfigs(true);
        try {
            const result = await apiJson<ApiConfigBatchTestResponse>('/api/admin/api-configs/test-all', {
                method: 'POST',
                body: JSON.stringify({ enabled_only: false }),
            });
            const rows = result.config_tests || [];
            setConfigTestMap(prev => {
                const next = { ...prev };
                rows.forEach(item => {
                    if (item.config_id && item.test) {
                        next[item.config_id] = mergeConfigTestPreservingVerification(
                            next[item.config_id],
                            item.test,
                        );
                    }
                });
                return next;
            });
            const summary = result.summary || {};
            crmMessage.success(
                `配置测试完成：ok ${summary.ok ?? 0} / reachable ${summary.connectivity_ok ?? 0} / no_key ${summary.no_key ?? 0} / auth ${summary.auth_error ?? 0} / error ${summary.error ?? 0}`
            );
        } catch (err: any) {
            crmMessage.error(`批量配置测试失败：${err?.message || 'unknown'}`);
        } finally {
            setTestingAllConfigs(false);
        }
    }, [configs]);

    const sweepProviders = useCallback(async () => {
        const targets = Array.from(configsByProvider.entries())
            .map(([provider, providerConfigs]) => {
                const runtimeHint = runtimeMap.get(provider);
                const primaryConfig = bestConfigForProvider(providerConfigs, provider, runtimeHint);
                const modelNameHint = primaryConfig?.model_name || runtimeHint?.runtime_model_name || providerMetaMap.get(provider)?.default_model_name || null;
                const runtime = runtimeForProviderModel(provider, modelNameHint);
                return {
                    provider,
                    model_name: modelNameHint || runtime?.runtime_model_name || undefined,
                };
            })
            .filter(target => target.provider);
        if (!targets.length) return;
        setSweeping(true);
        try {
            const result = await apiJson<ProviderHealthSweepResponse>('/api/admin/api-configs/health/sweep', {
                method: 'POST',
                body: JSON.stringify({ targets }),
            });
            const rows = result.provider_health || [];
            setMonitorState(result.monitor_state || null);
            setHealthMap(prev => {
                const next = { ...prev };
                rows.forEach(item => {
                    putProviderHealth(next, item);
                });
                return next;
            });
            await loadConfigs({ showLoading: false });
            const summary = result.summary || {};
            crmMessage.success(`巡检完成：ok ${summary.ok ?? 0} / reachable ${summary.connectivity_ok ?? 0} / error ${summary.error ?? 0} / no_key ${summary.no_key ?? 0}`);
        } catch (err: any) {
            crmMessage.error(`批量巡检失败：${err?.message || 'unknown'}`);
        } finally {
            setSweeping(false);
        }
    }, [configsByProvider, loadConfigs, providerMetaMap, runtimeForProviderModel, runtimeMap]);

    const reloadRuntimeEnv = useCallback(async () => {
        setReloadingEnv(true);
        try {
            const result = await apiJson<ApiConfigReloadEnvResponse>('/api/admin/api-configs/reload-env', {
                method: 'POST',
                body: JSON.stringify({}),
            });
            if (result.env_refreshed) {
                crmMessage.success(`运行时已刷新：加载 ${result.loaded ?? 0} 条配置`);
            } else {
                crmMessage.warning(`运行时刷新失败：${result.error || 'unknown'}`);
            }
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`运行时刷新失败：${err?.message || 'unknown'}`);
        } finally {
            setReloadingEnv(false);
        }
    }, [loadConfigs]);

    const repairProviderConflicts = useCallback(async () => {
        setRepairingConflicts(true);
        try {
            const dryRun = await apiJson<ApiConfigRepairConflictsResponse>('/api/admin/api-configs/repair-conflicts', {
                method: 'POST',
                body: JSON.stringify({ dry_run: true }),
            });
            const wouldDisable = dryRun.would_disable ?? 0;
            const wouldMerge = dryRun.would_merge ?? 0;
            const wouldAbsorb = dryRun.would_absorb_placeholders ?? 0;
            if (!wouldDisable && !wouldMerge && !wouldAbsorb) {
                crmMessage.success('API 卡片结构正常，没有重复凭证或生效冲突');
                return;
            }

            const ok = await crmConfirm({
                title: '整理 API 卡片',
                message: `将合并 ${wouldMerge} 组相同 API Key 卡片、吸收 ${wouldAbsorb} 组旧模型占位卡，并关闭 ${wouldDisable} 条同厂商重复生效卡。操作与模型绑定会被汇总保留。是否继续？`,
                type: 'warning',
                confirmText: '整理',
            });
            if (!ok) return;

            const result = await apiJson<ApiConfigRepairConflictsResponse>('/api/admin/api-configs/repair-conflicts', {
                method: 'POST',
                body: JSON.stringify({ dry_run: false }),
            });
            const disabled = result.total_disabled ?? 0;
            const merged = result.total_merged_cards ?? 0;
            const absorbed = result.total_absorbed_placeholder_groups ?? 0;
            const message = `已合并 ${merged} 组重复 API 卡、吸收 ${absorbed} 组旧模型占位卡，关闭 ${disabled} 条生效冲突`;
            if (result.env_refreshed === false) crmMessage.warning(`${message}，但运行时刷新失败`);
            else crmMessage.success(`${message}并刷新运行时`);
            setConfigTestMap({});
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`整理 API 卡片失败：${err?.message || 'unknown'}`);
        } finally {
            setRepairingConflicts(false);
        }
    }, [loadConfigs]);

    const openCreate = useCallback(() => {
        setEditingForm(emptyConfigForm());
    }, []);

    const openCreateForProvider = useCallback((meta: ProviderMeta) => {
        setEditingForm(providerMetaToForm(meta));
    }, []);

    const openEdit = useCallback((config: ApiConfig) => {
        const provider = normalizeProvider(config.provider);
        const meta = providerMetaMap.get(provider);
        setEditingForm(configToForm(config, meta?.extra_fields || [], meta?.model_binding_options || []));
    }, [providerMetaMap]);

    const saveConfig = useCallback(async () => {
        if (!editingForm) return;
        const name = editingForm.name.trim();
        const provider = normalizeProvider(editingForm.provider);
        const endpoint = editingForm.endpoint.trim();
        const apiKey = editingForm.api_key.trim();
        const bulkApiKeys = splitBulkApiKeys(editingForm.bulk_api_keys);
        const modelBindings = normalizeApiModelBindings(
            editingForm.model_bindings,
            editingForm.model_name,
            providerMetaMap.get(provider)?.model_binding_options || [],
        );
        if (!name || !provider || !endpoint) {
            crmMessage.warning('请填写名称、provider 和 endpoint');
            return;
        }
        if (!editingForm.config_id && editingForm.bulk_mode && bulkApiKeys.length === 0) {
            crmMessage.warning('请至少填写一个 API Key');
            return;
        }
        if (!editingForm.config_id && !editingForm.bulk_mode && !apiKey) {
            crmMessage.warning('新增 API 配置需要填写 API Key');
            return;
        }
        if (modelBindings.length === 0) {
            crmMessage.warning('请至少添加一条前台操作与模型绑定');
            return;
        }
        const rawOperations = editingForm.model_bindings
            .map(item => modelBindingKey(item))
            .filter(Boolean);
        if (new Set(rawOperations).size !== rawOperations.length) {
            crmMessage.warning('同一张 API 卡中，同一使用场景下一个前台操作只能绑定一次');
            return;
        }

        let requestTemplate: JsonRecord;
        let headers: JsonRecord;
        const extraFields = providerMetaMap.get(provider)?.extra_fields || [];
        try {
            requestTemplate = parseJsonText(editingForm.request_template, 'Request Template');
            headers = parseJsonText(editingForm.headers, 'Headers');
        } catch (err: any) {
            crmMessage.warning(err?.message || '高级配置 JSON 格式错误');
            return;
        }
        applyExtraValuesToRecords(
            extraFields,
            {
                ...extraValuesFromRecords(extraFields, requestTemplate, headers),
                ...editingForm.extra_values,
            },
            requestTemplate,
            headers,
        );

        setSaving(true);
        try {
            const body: Record<string, any> = {
                name,
                provider,
                endpoint,
                model_name: modelBindings[0]?.model_name || '',
                model_bindings: modelBindings,
                proxy_mode: editingForm.proxy_mode || 'direct',
                custom_proxy: editingForm.proxy_mode === 'custom' ? editingForm.custom_proxy.trim() : '',
                request_template: requestTemplate,
                headers,
                category: editingForm.category || '',
                enabled: editingForm.enabled,
            };
            if (apiKey) body.api_key = apiKey;

            const isEdit = Boolean(editingForm.config_id);
            const result = isEdit
                ? await apiJson<ApiConfigWriteResponse>(`/api/admin/api-configs/${editingForm.config_id}`, {
                    method: 'PUT',
                    body: JSON.stringify(body),
                })
                : editingForm.bulk_mode
                ? await apiJson<ApiConfigWriteResponse>('/api/admin/api-configs/bulk-keys', {
                    method: 'POST',
                    body: JSON.stringify({
                        ...body,
                        api_keys: bulkApiKeys,
                        name_prefix: name,
                        activate_index: 0,
                    }),
                })
                : await apiJson<ApiConfigWriteResponse>('/api/admin/api-configs', {
                    method: 'POST',
                    body: JSON.stringify({ ...body, api_key: apiKey }),
                });

            const skippedSuffix = result.skipped_existing
                ? `，已跳过 ${result.skipped_existing} 个已有 API Key`
                : '';
            const message = `${envRefreshMessage(result, isEdit ? '配置' : '新配置')}${conflictDisableSuffix(result)}${skippedSuffix}`;
            if (result.env_refreshed === false) crmMessage.warning(message);
            else crmMessage.success(message);
            setEditingForm(null);
            setConfigTestMap(prev => {
                if (!editingForm.config_id) return prev;
                const next = { ...prev };
                delete next[editingForm.config_id];
                return next;
            });
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`保存失败：${err?.message || 'unknown'}`);
        } finally {
            setSaving(false);
        }
    }, [editingForm, loadConfigs, providerMetaMap]);

    const toggleConfig = useCallback(async (config: ApiConfig) => {
        const nextEnabled = config.enabled === false;
        try {
            const result = await apiJson<ApiConfigWriteResponse>(`/api/admin/api-configs/${config.config_id}`, {
                method: 'PUT',
                body: JSON.stringify({ enabled: nextEnabled }),
            });
            const action = nextEnabled ? '启用' : '禁用';
            const message = `${envRefreshMessage(result, action)}${conflictDisableSuffix(result)}`;
            if (result.env_refreshed === false) crmMessage.warning(message);
            else crmMessage.success(message);
            setConfigTestMap(prev => {
                const next = { ...prev };
                delete next[config.config_id];
                return next;
            });
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`切换失败：${err?.message || 'unknown'}`);
        }
    }, [loadConfigs]);

    const activateConfig = useCallback(async (config: ApiConfig) => {
        if (!config.config_id) return;
        try {
            const result = await apiJson<ApiConfigWriteResponse>(`/api/admin/api-configs/${config.config_id}/activate`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const message = `${envRefreshMessage(result, 'Key 已切换')}${activationDisableSuffix(result)}`;
            if (result.env_refreshed === false) crmMessage.warning(message);
            else crmMessage.success(message);
            setConfigTestMap(prev => {
                const next = { ...prev };
                delete next[config.config_id];
                return next;
            });
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`Key 切换失败：${err?.message || 'unknown'}`);
        }
    }, [loadConfigs]);

    const deleteConfig = useCallback(async (config: ApiConfig) => {
        const ok = await crmConfirm({
            title: '删除 API 配置',
            message: `确认删除「${config.name || config.provider}」？删除后运行时环境会重新刷新。`,
            type: 'danger',
            confirmText: '删除',
        });
        if (!ok) return;
        try {
            const result = await apiJson<ApiConfigWriteResponse>(`/api/admin/api-configs/${config.config_id}`, {
                method: 'DELETE',
            });
            const message = envRefreshMessage(result, '配置');
            if (result.env_refreshed === false) crmMessage.warning(message);
            else crmMessage.success('配置已删除并刷新');
            setConfigTestMap(prev => {
                const next = { ...prev };
                delete next[config.config_id];
                return next;
            });
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`删除失败：${err?.message || 'unknown'}`);
        }
    }, [loadConfigs]);

    const exportKeyBackup = useCallback(async () => {
        if (configs.length === 0) {
            crmMessage.warning('暂无可导出的 API 配置');
            return;
        }
        const ok = await crmConfirm({
            title: '导出 API 密钥',
            message: '导出的 JSON 文件会包含明文 API Key，请只保存在可信位置。是否继续导出？',
            type: 'warning',
            confirmText: '导出',
        });
        if (!ok) return;

        setExportingKeys(true);
        try {
            const blob = await apiBlob('/api/admin/api-configs/export-keys', { method: 'POST' }, '导出 API 密钥');
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = `ostory-api-keys-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            crmMessage.success('API 密钥备份已开始下载');
        } catch (err: any) {
            crmMessage.error(`导出失败：${err?.message || 'unknown'}`);
        } finally {
            setExportingKeys(false);
        }
    }, [configs.length]);

    const openImportKeyBackup = useCallback(async () => {
        const ok = await crmConfirm({
            title: '导入 API 密钥备份',
            message: '请选择由本页导出的 JSON 备份文件。默认跳过已存在的同名、同端点、同模型配置，不覆盖当前 Key。',
            type: 'warning',
            confirmText: '选择文件',
        });
        if (!ok) return;
        importKeyFileInputRef.current?.click();
    }, []);

    const importKeyBackupFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setImportingKeys(true);
        try {
            const text = await file.text();
            const payload = JSON.parse(text);
            const importConfigs = Array.isArray(payload)
                ? payload
                : Array.isArray(payload?.configs)
                ? payload.configs
                : Array.isArray(payload?.api_configs)
                ? payload.api_configs
                : null;
            if (!Array.isArray(importConfigs) || importConfigs.length === 0) {
                crmMessage.warning('导入文件里没有可用的 API 配置');
                return;
            }
            const result = await apiJson<ApiConfigImportResponse>('/api/admin/api-configs/import-keys', {
                method: 'POST',
                body: JSON.stringify({
                    configs: importConfigs,
                    overwrite_existing: false,
                    enable_imported: true,
                    dry_run: false,
                }),
            });
            const message = `导入完成：新增 ${result.created ?? 0}，更新 ${result.updated ?? 0}，跳过 ${result.skipped ?? 0}，无效 ${result.invalid ?? 0}`;
            if (result.env_refreshed === false) crmMessage.warning(`${message}，但运行时刷新失败`);
            else crmMessage.success(message);
            setConfigTestMap({});
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`导入失败：${err?.message || '文件格式不正确'}`);
        } finally {
            setImportingKeys(false);
        }
    }, [loadConfigs]);

    const importPresets = useCallback(async () => {
        try {
            const result = await apiJson<ApiConfigImportResponse>('/api/admin/api-configs/import-presets', {
                method: 'POST',
                body: JSON.stringify(RUNTIME_KEY_IMPORT_BODY),
            });
            const message = `导入完成：新增 ${result.imported ?? 0}，更新 ${result.updated_existing ?? 0}，写入Key ${result.env_keys_imported ?? 0}，缺Key ${result.env_keys_missing ?? 0}`;
            if (result.env_refreshed === false) crmMessage.warning(`${message}，但运行时刷新失败`);
            else crmMessage.success(message);
            setConfigTestMap({});
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`导入失败：${err?.message || 'unknown'}`);
        }
    }, [loadConfigs]);

    const migrateRuntimeKeys = useCallback(async () => {
        setMigratingRuntimeKeys(true);
        try {
            const dryRun = await apiJson<ApiConfigImportResponse>('/api/admin/api-configs/import-presets', {
                method: 'POST',
                body: JSON.stringify({ ...RUNTIME_KEY_IMPORT_BODY, dry_run: true }),
            });
            const importableKeys = dryRun.env_keys_imported ?? 0;
            const existingKeys = dryRun.env_keys_existing ?? 0;
            const missingKeys = dryRun.env_keys_missing ?? 0;
            const claimedKeys = dryRun.env_keys_skipped_provider_claimed ?? 0;
            if (importableKeys <= 0) {
                crmMessage.success(`没有可迁移的运行时 Key：已落库 ${existingKeys}，缺 Key ${missingKeys}，重复预设 ${claimedKeys}`);
                return;
            }

            const ok = await crmConfirm({
                title: '迁移运行时 Key',
                message: `将把 ${importableKeys} 个运行时 Key 写入后台 DB 配置，并跳过 ${claimedKeys} 个同 provider 重复预设；缺 Key ${missingKeys}。是否继续？`,
                type: 'warning',
                confirmText: '迁移',
            });
            if (!ok) return;

            const result = await apiJson<ApiConfigImportResponse>('/api/admin/api-configs/import-presets', {
                method: 'POST',
                body: JSON.stringify(RUNTIME_KEY_IMPORT_BODY),
            });
            const message = `运行时 Key 迁移完成：写入 ${result.env_keys_imported ?? 0}，更新 ${result.updated_existing ?? 0}，新增 ${result.imported ?? 0}，缺 Key ${result.env_keys_missing ?? 0}`;
            if (result.env_refreshed === false) crmMessage.warning(`${message}，但运行时刷新失败`);
            else crmMessage.success(message);
            setConfigTestMap({});
            await loadConfigs();
        } catch (err: any) {
            crmMessage.error(`运行时 Key 迁移失败：${err?.message || 'unknown'}`);
        } finally {
            setMigratingRuntimeKeys(false);
        }
    }, [loadConfigs]);

    return (
        <>
        <input
            ref={importKeyFileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={importKeyBackupFile}
        />
        <div className="layout-safe h-full min-h-0 w-full overflow-auto bg-n20">
            <div className="mx-auto max-w-7xl p-5 space-y-4">
                <header className="responsive-toolbar flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-n100">
                            <ServerCog className="w-3.5 h-3.5" />
                            API Providers
                        </div>
                        <h1 className="mt-1 text-xl font-semibold text-n800">厂商 API Key 与 Endpoint</h1>
                    </div>
                    <div className="toolbar-actions">
                        <button
                            type="button"
                            onClick={exportKeyBackup}
                            disabled={exportingKeys || loading || configs.length === 0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                            title="导出包含明文 API Key 的 JSON 备份文件"
                        >
                            {exportingKeys ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            导出密钥
                        </button>
                        <button
                            type="button"
                            onClick={openImportKeyBackup}
                            disabled={importingKeys || loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                            title="导入由本页导出的 API Key JSON 备份"
                        >
                            {importingKeys ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            导入密钥
                        </button>
                        <button
                            type="button"
                            onClick={() => loadConfigs()}
                            disabled={loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                        >
                            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            刷新
                        </button>
                        <button
                            type="button"
                            onClick={refreshHealthCache}
                            disabled={refreshingHealth || loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                        >
                            {refreshingHealth ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                            查看健康缓存
                        </button>
                        <button
                            type="button"
                            onClick={reloadRuntimeEnv}
                            disabled={reloadingEnv || loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                        >
                            {reloadingEnv ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            刷新运行时
                        </button>
                        <button
                            type="button"
                            onClick={sweepProviders}
                            disabled={sweeping || loading || configs.length === 0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                            title="重新检测每个 provider 当前实际生效的运行时配置是否连通"
                        >
                            {sweeping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                            刷新生效健康
                        </button>
                        <button
                            type="button"
                            onClick={repairProviderConflicts}
                            disabled={repairingConflicts || loading || configs.length === 0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-y200 bg-y50 text-y400 hover:bg-y50 disabled:opacity-60"
                        >
                            {repairingConflicts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertCircle className="w-3.5 h-3.5" />}
                            整理 API 卡片
                        </button>
                        <button
                            type="button"
                            onClick={importPresets}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-n40 bg-n0 text-n700 hover:bg-n20"
                        >
                            <ServerCog className="w-3.5 h-3.5" />
                            导入预设模型
                        </button>
                        <button
                            type="button"
                            onClick={migrateRuntimeKeys}
                            disabled={migratingRuntimeKeys || loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-y200 bg-y50 text-y400 hover:bg-y50 disabled:opacity-60"
                        >
                            {migratingRuntimeKeys ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                            迁移运行时 Key
                        </button>
                    </div>
                </header>

                <ProviderHealthMonitorStrip state={monitorState} />

                <section className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">Configs</div>
                        <div className="mt-1 text-2xl font-semibold text-n800 font-mono">{summary.total}</div>
                    </div>
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">Providers</div>
                        <div className="mt-1 text-2xl font-semibold text-n800 font-mono">{summary.providers}</div>
                    </div>
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">Keyed</div>
                        <div className="mt-1 text-2xl font-semibold text-n800 font-mono">{summary.configured}</div>
                    </div>
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">OK</div>
                        <div className="mt-1 text-2xl font-semibold text-success font-mono">{summary.counts.ok}</div>
                    </div>
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">Error</div>
                        <div className="mt-1 text-2xl font-semibold text-danger font-mono">{summary.counts.error}</div>
                    </div>
                    <div className="bg-n0 border border-n40 rounded-md p-3 shadow-card">
                        <div className="text-[10px] uppercase tracking-wider text-n100">No Key</div>
                        <div className="mt-1 text-2xl font-semibold text-r400 font-mono">{summary.counts.no_key}</div>
                    </div>
                </section>

                {error && (
                    <div className="rounded-md border border-r75 bg-r50 px-3 py-2 text-sm text-danger">{error}</div>
                )}

                <JimengAccountCard />
                {summary.runtimeOnlyKeyProviders.length > 0 && (
                    <section className="rounded-md border border-y200 bg-y50 px-3 py-2 shadow-card flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 text-xs text-y400">
                            <span className="font-semibold">运行时 Key 未落库</span>
                            <span className="ml-2">
                                {summary.runtimeOnlyKeyProviders.length} 个 provider 正在使用 env/运行时 Key，后台 DB 暂无保存 Key。
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={migrateRuntimeKeys}
                            disabled={migratingRuntimeKeys || loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-y200 bg-n0 text-y400 hover:bg-y50 disabled:opacity-60"
                        >
                            {migratingRuntimeKeys ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                            迁移运行时 Key
                        </button>
                    </section>
                )}

                <section className="rounded-md border border-n40 bg-n0 px-4 py-3 shadow-card">
                    <div className="flex items-center gap-2 text-xs font-semibold text-n800">
                        <Activity className="w-3.5 h-3.5 text-primary" />
                        连通性与余量
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-n100">
                        每张 API 卡对应一个 Key，并可绑定多个前台操作和模型。连通性检测使用当前生效卡的 Key 与 Endpoint；真实生成测试使用卡内主模型。
                    </p>
                    <details className="mt-2 rounded border border-n40 bg-n20 px-3 py-2 text-[11px]">
                        <summary className="cursor-pointer select-none font-semibold text-n700">全局高级测试</summary>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={testAllConfigs}
                                disabled={testingAllConfigs || loading || configs.length === 0}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                                title="逐条测试数据库中保存的每一条配置，不会切换生效 Key"
                            >
                                {testingAllConfigs ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                                批量测试 DB 配置
                            </button>
                            <button
                                type="button"
                                onClick={sweepProviders}
                                disabled={sweeping || loading || configs.length === 0}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium border border-n40 bg-n0 text-n700 hover:bg-n20 disabled:opacity-60"
                                title="测试当前实际生效的 Key、Endpoint 和模型，不会逐条切换数据库配置"
                            >
                                {sweeping ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                测试生效配置
                            </button>
                        </div>
                    </details>
                </section>

                <section className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="text-sm font-semibold text-n800">厂商快速配置</h2>
                        <p className="mt-0.5 text-xs text-n100">一个 API Key 对应一张卡片；卡片内维护前台操作与模型绑定。</p>
                    </div>
                    <button
                        type="button"
                        onClick={openCreate}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-primary hover:bg-primary-hover"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        新增 API 卡片
                    </button>
                </section>

                {loading ? (
                    <div className="flex items-center justify-center h-64 text-n100">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        加载中
                    </div>
                ) : configs.length === 0 ? (
                    <div className="bg-n0 border border-n40 rounded-md p-10 text-center text-n100">
                        暂无 API 卡片，请点击“新增 API 卡片”开始配置
                    </div>
                ) : (
                    <div className="space-y-3">
                        <section className="rounded-md border border-n40 bg-n0 shadow-card">
                            <div className="ui-tabs">
                                {categoryTabs.map(tab => {
                                    const active = tab.key === activeCategory;
                                    return (
                                        <button
                                            key={tab.key}
                                            type="button"
                                            onClick={() => selectCategory(tab.key)}
                                            className="ui-tab"
                                            aria-pressed={active}
                                        >
                                            <span>{tab.label}</span>
                                            <span className="ui-tab-count">
                                                {tab.count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            {activeCategoryItems.length === 0 ? (
                                <div className="px-4 py-10 text-center text-sm text-n100">
                                    暂无{CATEGORY_LABELS[activeCategory] || activeCategory} API 卡片
                                </div>
                            ) : (
                                <div className="grid gap-3 p-3">
                                    {activeCategoryItems.map(config => {
                                        const provider = normalizeProvider(config.provider);
                                        const runtime = runtimeForConfig(config);
                                        const categoryBinding = bindingsForCategory(
                                            apiConfigModelBindings(config, providerMetaMap.get(provider)),
                                            config.provider,
                                            activeCategory,
                                        )[0];
                                        const modelNameHint = categoryBinding?.model_name || config.model_name || null;
                                        const categoryRuntime = runtimeForProviderModel(provider, modelNameHint) || runtime;
                                        const modelName = modelNameHint || categoryRuntime?.runtime_model_name || null;
                                        return (
                                            <ApiConfigCard
                                                key={`${activeCategory}:${config.config_id}`}
                                                config={config}
                                                categoryView={activeCategory}
                                                meta={providerMetaMap.get(provider)}
                                                runtime={categoryRuntime}
                                                health={providerHealthFrom(healthMap, provider, modelName)}
                                                configTest={configTestMap[config.config_id]}
                                                checking={Boolean(checking[providerHealthKey(provider, modelName)])}
                                                testingConfig={testingAllConfigs || Boolean(testingConfig[config.config_id])}
                                                realTestingConfig={Boolean(realTestingConfig[config.config_id])}
                                                onCheck={testProvider}
                                                onTestConfig={testConfig}
                                                onRealTestConfig={realTestConfig}
                                                onEdit={openEdit}
                                                onActivate={activateConfig}
                                                onToggle={toggleConfig}
                                                onDelete={deleteConfig}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    </div>
                )}
            </div>
        </div>
        {editingForm && (
            <ApiConfigEditorModal
                form={editingForm}
                providers={providers}
                saving={saving}
                onChange={setEditingForm}
                onClose={() => {
                    if (!saving) setEditingForm(null);
                }}
                onSubmit={saveConfig}
            />
        )}
        </>
    );
};

export const AdminSettingsPage: React.FC = () => {
    const [sp] = useSearchParams();
    const raw = sp.get('item') || 'apiconfig';

    if (raw === 'apiconfig' || raw === 'legacy-apiconfig') {
        return <ApiConfigPanel />;
    }

    if (raw === 'recyclebin') {
        return (
            <div className="p-6">
                <AdminRecycleBinPanel />
            </div>
        );
    }

    const page = LEGACY_PAGE_BY_ITEM[raw];
    if (!page) {
        return <ApiConfigPanel />;
    }

    return (
        <div className="h-full w-full min-h-0 min-w-0 overflow-hidden">
            <iframe
                key={page}
                title="legacy-admin"
                src={`${adminPath('legacy')}/?embed=1&v=${LEGACY_VER}&page=${page}#${page}`}
                className="w-full h-full min-w-0 border-0 block bg-n20"
            />
        </div>
    );
};

export default AdminSettingsPage;
