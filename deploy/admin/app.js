
let currentPage = 'dashboard';
let dashboardInterval = null;
let apiProviderCatalog = [];
let apiProviderMap = new Map();
let apiProviderStatusMap = new Map();
let apiProviderRuntimeStatusList = [];
let apiProviderRuntimeStatusMap = new Map();
let apiProviderHealthMap = new Map();
let apiProviderCatalogPromise = null;
let workflowCatalogItems = [];
const ADMIN_SHELL_PATH = '/a7k9m3q8x2v6n4p';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function publicProcessingNodeName(value) {
  const raw = String(value || '').trim();
  const numbered = raw.match(/^(?:gpu|agent[_\s-]*gpu|gpu[_\s-]*agent)[_\s-]*(\d+)$/i);
  if (numbered) return `处理节点${numbered[1]}`;
  return raw
    .replace(/ComfyUI/gi, '处理服务')
    .replace(/GPU\s*Agent/gi, '处理节点')
    .replace(/GPU/gi, '处理节点');
}

function normalizeProviderId(provider) {
  return String(provider || '').trim().toLowerCase();
}

function getApiProviderMeta(provider) {
  return apiProviderMap.get(normalizeProviderId(provider)) || null;
}

function hydrateApiProviderCatalog(items) {
  if (!Array.isArray(items)) return;
  apiProviderCatalog = items;
  apiProviderMap = new Map(apiProviderCatalog.map(item => [
    normalizeProviderId(item.provider),
    item,
  ]));
  ensureApiProviderOptions();
}

function hydrateApiProviderStatus(items) {
  if (!Array.isArray(items)) return;
  apiProviderStatusMap = new Map(items.map(item => [
    normalizeProviderId(item.provider),
    item,
  ]));
}

function getApiProviderStatus(provider) {
  return apiProviderStatusMap.get(normalizeProviderId(provider)) || null;
}

function providerRuntimeKey(provider, modelName = '') {
  return `${normalizeProviderId(provider)}::${String(modelName || '').trim()}`;
}

function hydrateApiProviderRuntimeStatus(items) {
  if (!Array.isArray(items)) return;
  apiProviderRuntimeStatusList = items;
  apiProviderRuntimeStatusMap = new Map(items.map(item => [
    providerRuntimeKey(item.provider, item.model_name),
    item,
  ]));
}

function getApiProviderRuntimeStatus(provider, modelName = '') {
  const exact = apiProviderRuntimeStatusMap.get(providerRuntimeKey(provider, modelName));
  if (exact) return exact;
  const normalized = normalizeProviderId(provider);
  return apiProviderRuntimeStatusList.find(item => normalizeProviderId(item.provider) === normalized) || null;
}

function getApiProviderHealth(provider) {
  return apiProviderHealthMap.get(normalizeProviderId(provider)) || null;
}

function hydrateApiProviderHealth(items) {
  if (!Array.isArray(items)) return;
  apiProviderHealthMap = new Map(items.map(item => [
    normalizeProviderId(item.provider),
    item,
  ]));
}

function ensureApiProviderOptions() {
  const select = document.getElementById('api-provider');
  if (!select || !apiProviderCatalog.length) return;

  const existing = new Set(Array.from(select.options).map(opt => opt.value));
  apiProviderCatalog.forEach(item => {
    const provider = item.provider || '';
    if (!provider || existing.has(provider)) return;

    const opt = document.createElement('option');
    opt.value = provider;
    opt.textContent = `${item.label || provider} (${provider})`;
    select.appendChild(opt);
    existing.add(provider);
  });
}

async function fetchApiProviderMeta(force = false) {
  if (!force && apiProviderCatalog.length) return apiProviderCatalog;

  if (!apiProviderCatalogPromise || force) {
    apiProviderCatalogPromise = apiCall('/api/admin/api-configs/presets')
      .then(data => {
        hydrateApiProviderCatalog(data.providers || []);
        return apiProviderCatalog;
      })
      .catch(() => {
        apiProviderCatalog = [];
        apiProviderMap = new Map();
        return [];
      })
      .finally(() => { apiProviderCatalogPromise = null; });
  }

  return apiProviderCatalogPromise;
}

function providerStatusView(status) {
  const key = status?.status || 'unknown';
  const map = {
    ready: { label: 'ready', badge: 'badge-green' },
    missing_key: { label: 'missing key', badge: 'badge-yellow' },
    disabled: { label: 'disabled', badge: 'badge-gray' },
    not_imported: { label: 'not imported', badge: 'badge-gray' },
    unknown: { label: 'unknown', badge: 'badge-gray' },
  };
  return map[key] || map.unknown;
}

function renderProviderStatusBadge(status) {
  if (!status) return '';
  const view = providerStatusView(status);
  return `<span class="badge ${view.badge}" style="font-size:10px">provider ${view.label}</span>`;
}

function renderProviderStatusSummary(statuses) {
  if (!Array.isArray(statuses) || !statuses.length) return '';
  const ready = statuses.filter(s => s.status === 'ready').length;
  const missing = statuses.filter(s => s.status === 'missing_key').length;
  const disabled = statuses.filter(s => s.status === 'disabled').length;
  const notImported = statuses.filter(s => s.status === 'not_imported').length;
  return `
    <span class="flex items-center gap-2"><span class="dot dot-green" style="width:6px;height:6px"></span> providers ready ${ready}</span>
    ${missing > 0 ? `<span class="flex items-center gap-2"><span class="dot dot-gray" style="width:6px;height:6px"></span> missing ${missing}</span>` : ''}
    ${disabled > 0 ? `<span class="flex items-center gap-2"><span class="dot dot-gray" style="width:6px;height:6px"></span> disabled ${disabled}</span>` : ''}
    ${notImported > 0 ? `<span class="flex items-center gap-2"><span class="dot dot-gray" style="width:6px;height:6px"></span> not imported ${notImported}</span>` : ''}
  `;
}

function runtimeStatusView(status) {
  const key = status?.status || 'unknown';
  const map = {
    ready: { label: 'runtime ready', badge: 'badge-green' },
    missing_key: { label: 'runtime missing key', badge: 'badge-yellow' },
    incomplete: { label: 'runtime incomplete', badge: 'badge-yellow' },
    unknown: { label: 'runtime unknown', badge: 'badge-gray' },
  };
  return map[key] || map.unknown;
}

function renderRuntimeStatusBadge(status) {
  if (!status) return '';
  const view = runtimeStatusView(status);
  return `<span class="badge ${view.badge}" style="font-size:10px">${view.label}</span>`;
}

function renderRuntimeStatusSummary(statuses) {
  if (!Array.isArray(statuses) || !statuses.length) return '';
  const ready = statuses.filter(s => s.ready).length;
  return `<span class="flex items-center gap-2"><span class="dot dot-green" style="width:6px;height:6px"></span> runtime ready ${ready}/${statuses.length}</span>`;
}

function renderRuntimeMetaLine(status) {
  if (!status) return '';
  const endpoint = status.endpoint
    ? status.endpoint.replace(/^https?:\/\//, '').slice(0, 42)
    : '-';
  const keySource = status.has_key ? (status.api_key_source || status.api_key_env || 'env') : 'missing';
  const endpointSource = status.endpoint_source || 'missing';
  const proxy = status.proxy_mode || 'direct';
  const runtimeSource = status.runtime_source || 'missing';
  const dbConfig = status.db_effective_config_name || status.db_effective_config_id || '';
  const dbCount = Number(status.db_keyed_enabled_config_count || 0);
  const failover = status.failover || {};
  const failoverActive = !!status.failover_active;
  const failoverText = failoverActive
    ? ` | failover: ${status.failover_selected_provider || '-'} (${status.failover_reason || 'selected'})`
    : (Array.isArray(status.fallback) && status.fallback.length
      ? ` | fallback: ${status.fallback.map(f => f.provider).filter(Boolean).join(', ') || '-'}`
      : '');
  const dbSource = dbConfig
    ? ` | db config: ${dbConfig}${dbCount > 1 ? ` (+${dbCount - 1})` : ''}`
    : '';
  const issues = Array.isArray(status.issues) && status.issues.length
    ? ` | issues: ${status.issues.join(', ')}`
    : '';
  return `
    <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;line-height:1.4">
      runtime key: <span class="mono">${escapeHtml(keySource)}</span>
      | endpoint: <span class="mono">${escapeHtml(endpoint)}</span>
      (<span class="mono">${escapeHtml(endpointSource)}</span>)
      | proxy: <span class="mono">${escapeHtml(proxy)}</span>
      | source: <span class="mono">${escapeHtml(runtimeSource)}</span>${escapeHtml(dbSource)}${escapeHtml(failoverText)}${escapeHtml(issues)}
    </div>`;
}

function providerHealthView(health, runtimeStatus) {
  if (health) {
    const key = health.status || 'unknown';
    const map = {
      ok: { label: '健康正常', badge: 'badge-green', dot: 'dot-green' },
      error: { label: '健康异常', badge: 'badge-red', dot: 'dot-red' },
      no_key: { label: '未配置 Key', badge: 'badge-gray', dot: 'dot-gray' },
      blocked_region: { label: '地区受限', badge: 'badge-yellow', dot: 'dot-yellow' },
      connectivity_ok: { label: '连接可达，生成未验证', badge: 'badge-yellow', dot: 'dot-yellow' },
      unknown: { label: '未知', badge: 'badge-gray', dot: 'dot-gray' },
    };
    return map[key] || map.unknown;
  }
  if (runtimeStatus && runtimeStatus.has_key === false) {
    return { label: '未配置 Key', badge: 'badge-gray', dot: 'dot-gray' };
  }
  return { label: '未检测', badge: 'badge-gray', dot: 'dot-gray' };
}

function renderProviderHealthBadge(provider, runtimeStatus) {
  const health = getApiProviderHealth(provider);
  const view = providerHealthView(health, runtimeStatus);
  return `
    <span class="badge ${view.badge}" style="font-size:10px">
      <span class="dot ${view.dot}" style="width:6px;height:6px;margin-right:4px"></span>${view.label}
    </span>`;
}

function renderProviderHealthLine(provider, runtimeStatus) {
  const health = getApiProviderHealth(provider);
  const view = providerHealthView(health, runtimeStatus);
  const latency = Number.isFinite(Number(health?.latency_ms)) ? `${Number(health.latency_ms)}ms` : '-';
  const checkedAt = health?.checked_at ? String(health.checked_at).replace('T', ' ').replace('Z', '') : '-';
  const detail = health?.health || {};
  const url = detail.url ? String(detail.url).replace(/^https?:\/\//, '').slice(0, 42) : '-';
  const error = detail.error ? ` | error: ${String(detail.error).slice(0, 90)}` : '';
  return `
    <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;line-height:1.4">
      provider health: <span class="mono">${escapeHtml(view.label)}</span>
      | latency: <span class="mono">${escapeHtml(latency)}</span>
      | checked: <span class="mono">${escapeHtml(checkedAt)}</span>
      | url: <span class="mono">${escapeHtml(url)}</span>${escapeHtml(error)}
    </div>`;
}

function renderProviderMetaLine(config) {
  const provider = normalizeProviderId(config.provider);
  const meta = getApiProviderMeta(provider);
  const status = getApiProviderStatus(provider);
  const parts = [];

  if (meta?.vendor) {
    parts.push(`<span>vendor: <span class="mono">${escapeHtml(meta.vendor)}</span></span>`);
  }
  if (meta?.env_key) {
    parts.push(`<span>key: <span class="mono">${escapeHtml(meta.env_key)}</span></span>`);
  }
  if (meta?.endpoint_env_key) {
    parts.push(`<span>endpoint: <span class="mono">${escapeHtml(meta.endpoint_env_key)}</span></span>`);
  }
  const fallbackEnv = Array.isArray(meta?.fallback_env) ? meta.fallback_env.filter(Boolean) : [];
  if (fallbackEnv.length) {
    parts.push(`<span>fallback env: <span class="mono">${escapeHtml(fallbackEnv.join(', '))}</span></span>`);
  }
  const fallbackProviders = Array.isArray(meta?.fallback) ? meta.fallback.map(f => f?.provider).filter(Boolean) : [];
  if (fallbackProviders.length) {
    parts.push(`<span>fallback provider: <span class="mono">${escapeHtml(fallbackProviders.join(', '))}</span></span>`);
  }
  const capabilities = Array.isArray(meta?.capabilities) ? meta.capabilities.filter(Boolean) : [];
  if (capabilities.length) {
    parts.push(`<span>cap: <span class="mono">${escapeHtml(capabilities.join(', '))}</span></span>`);
  }
  if (!meta && provider) {
    parts.push(`<span>provider: <span class="mono">${escapeHtml(provider)}</span></span>`);
  }
  const issueList = Array.isArray(status?.issues) ? status.issues.filter(Boolean) : [];
  if (issueList.length) {
    parts.push(`<span>issues: <span class="mono">${escapeHtml(issueList.join(', '))}</span></span>`);
  }

  return parts.length ? `<div class="api-detail">${parts.join('')}</div>` : '';
}

const CATEGORY_META = {
  text:   { label: '文本 / 推理',  icon: '📝', badge: 'badge-blue' },
  image:  { label: '图像生成',    icon: '🎨', badge: 'badge-pink' },
  video:  { label: '视频生成',    icon: '🎬', badge: 'badge-purple' },
  audio:  { label: '音频 / TTS',  icon: '🔊', badge: 'badge-teal' },
  upscale:{ label: '增强 / 超分', icon: '✨', badge: 'badge-orange' },
  tool:   { label: '工具 / 处理', icon: '🔧', badge: 'badge-gray' },
  other:  { label: '其他',       icon: '📦', badge: 'badge-gray' },
};


document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  currentPage = page;

  if (dashboardInterval) { clearInterval(dashboardInterval); dashboardInterval = null; }

  if (page === 'dashboard')  { fetchDashboard(); dashboardInterval = setInterval(fetchDashboard, 5000); }
  else if (page === 'cluster')   fetchAgents();
  else if (page === 'workflows') fetchWorkflowsDisk();
  else if (page === 'apiconfig') { fetchApiConfigs(); fetchSettings(); }
}


function readStorageItem(storage, key) {
  try {
    return storage?.getItem(key) || '';
  } catch (_) {
    return '';
  }
}

function writeSessionItem(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
  } catch (_) {}
}

function syncLegacyAdminSessionFromParent() {
  try {
    if (!window.parent || window.parent === window.self) return;
    const parentSession = window.parent.sessionStorage;
    const parentToken = readStorageItem(parentSession, 'admin_session_token');
    if (!parentToken) return;

    const localToken = readStorageItem(sessionStorage, 'admin_session_token');
    if (parentToken === localToken) return;

    writeSessionItem('admin_session_token', parentToken);
    writeSessionItem('admin_session_username', readStorageItem(parentSession, 'admin_session_username'));
    writeSessionItem('admin_session_login_at', readStorageItem(parentSession, 'admin_session_login_at'));
  } catch (_) {
    // Cross-origin or storage restrictions should not break the legacy console.
  }
}

function getLegacyAdminToken() {
  syncLegacyAdminSessionFromParent();
  return readStorageItem(sessionStorage, 'admin_session_token') || readStorageItem(localStorage, 'auth_token');
}

async function apiCall(url, options = {}) {
  try {
    // The same-origin shell shares its short-lived admin session with this embedded view.
    const token = getLegacyAdminToken();
    const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {};
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...authHeader, ...options.headers },
      ...options,
    });
    if (resp.status === 401) {
      try {
        sessionStorage.removeItem('admin_session_token');
        sessionStorage.removeItem('admin_session_username');
        sessionStorage.removeItem('admin_session_login_at');
        sessionStorage.removeItem('admin_session_role');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('username');
      } catch (_) {}
      redirectToAdminLoginForLegacy();
      throw new Error('未授权，请重新登录');
    }
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
    return data;
  } catch (e) {
    showToast(e.message, 'error');
    throw e;
  }
}

async function cleanupStaleTasks() {
  if (!confirm('将超过24小时的排队/处理中任务标记为失败，确认？')) return;
  try {
    const data = await apiCall('/api/admin/tasks/cleanup', { method: 'POST' });
    showToast(`已清理 ${data.cleaned} 个僵尸任务`, 'success');
    fetchDashboard();
  } catch (_) {}
}


function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}


function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }


async function fetchDashboard() {
  document.getElementById('dashboard-time').textContent = new Date().toLocaleString('zh-CN');
  try {
    const data = await apiCall('/api/admin/dashboard');
    const d = data.dashboard;
    const qs = d.queue_stats || {};

    document.getElementById('dashboard-stats').innerHTML = `
      <div class="stat-card accent">
        <div class="stat-label">在线处理节点</div>
        <div class="stat-value">${d.agents_online}<span class="stat-sub">/ ${d.agents_total}</span></div>
      </div>
      <div class="stat-card success">
        <div class="stat-label">健康实例</div>
        <div class="stat-value">${d.instances_healthy}<span class="stat-sub">/ ${d.instances_total}</span></div>
      </div>
      <div class="stat-card warning">
        <div class="stat-label">排队 / 处理中</div>
        <div class="stat-value">${qs.queued || 0}<span class="stat-sub">/ ${qs.processing || 0}</span></div>
      </div>
      <div class="stat-card info">
        <div class="stat-label">今日完成</div>
        <div class="stat-value">${qs.today_completed || 0}</div>
        <div class="stat-extra">avg ${(qs.avg_duration || 0).toFixed(1)}s</div>
      </div>
      <div class="stat-card" style="background:rgba(99,102,241,0.1);border-color:rgba(99,102,241,0.3)">
        <div class="stat-label">累计完成 / 失败</div>
        <div class="stat-value">${qs.completed || 0}<span class="stat-sub">/ ${qs.failed || 0}</span></div>
      </div>
    `;

    const tasks = d.recent_tasks || [];
    if (!tasks.length) {
      document.getElementById('dashboard-tasks').innerHTML = '<div class="empty-state"><p>暂无任务记录</p></div>';
      return;
    }
    const statusBadge = s => {
      const m = { completed: 'badge-green', failed: 'badge-red', processing: 'badge-yellow', queued: 'badge-blue' };
      return `<span class="badge ${m[s] || 'badge-gray'}">${s}</span>`;
    };
    document.getElementById('dashboard-tasks').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>任务 ID</th><th>类型</th><th>状态</th><th>处理节点</th><th>时间</th>
        </tr></thead>
        <tbody>${tasks.map(t => `
          <tr>
            <td class="mono">${(t.task_id || '').slice(0, 16)}…</td>
            <td>${t.task_type || '-'}</td>
            <td>${statusBadge(t.status)}</td>
            <td class="mono" style="font-size:11px">${t.agent_id || '-'}</td>
            <td class="mono" style="font-size:11px">${t.queued_at ? new Date(t.queued_at).toLocaleString('zh-CN') : '-'}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
  } catch (_) {}
}


function toggleRegisterPanel() {
  const p = document.getElementById('register-panel');
  p.classList.toggle('hidden');
  document.getElementById('token-result').classList.add('hidden');
}

async function createAgent() {
  const name = document.getElementById('agent-name').value.trim();
  if (!name) { showToast('请输入节点名称', 'warn'); return; }
  const registry_kind = document.getElementById('agent-registry-kind').value;
  const data = await apiCall('/api/admin/agents', { method: 'POST', body: JSON.stringify({ name, registry_kind }) });
  const token = data.token;
  document.getElementById('token-value').textContent = token;
  document.getElementById('token-command').textContent =
    `curl -fsSL ${location.origin}/storage/tools/processing_agent.py -o processing_agent.py\npython processing_agent.py \\\n  --server ${location.origin} \\\n  --token ${token} \\\n  --ports 8188`;
  document.getElementById('token-result').classList.remove('hidden');
  showToast('处理节点创建成功', 'success');
  fetchAgents();
}

function copyCommand() {
  navigator.clipboard.writeText(document.getElementById('token-command').textContent);
  showToast('命令已复制', 'success');
}

async function fetchAgents() {
  const data = await apiCall('/api/admin/agents');
  const agents = data.agents || [];
  const categories = [
    { kind: 'managed', title: '本地节点', description: '自行管理和配置的节点，含自有设备及可配置的租用云 GPU。未分类历史节点暂列此处，等待确认。' },
    { kind: 'external', title: '外部节点', description: '外部服务商提供、仅有使用权的节点。分类不改变正在执行或排队的任务。' },
  ];
  document.getElementById('agent-list').innerHTML = categories.map(category => {
    const members = agents.filter(agent => (agent.registry_kind || 'managed') === category.kind);
    return `<section aria-label="${category.title}" style="margin-bottom:24px">
      <h3 style="margin-bottom:6px">${category.title} <span class="badge">${members.length}</span></h3>
      <p style="font-size:12px;color:var(--text-3);margin-bottom:12px">${category.description}</p>
      ${members.length ? members.map(a => {
    const displayName = publicProcessingNodeName(a.display_name || a.name || a.agent_id);
    const encodedDisplayName = encodeURIComponent(displayName).replace(/'/g, '%27');
    const instances = (typeof a.comfyui_instances === 'string' ? JSON.parse(a.comfyui_instances) : a.comfyui_instances) || [];
    const stats = (typeof a.stats === 'string' ? JSON.parse(a.stats) : a.stats) || {};
    let systemInfo = {};
    try {
      systemInfo = (typeof a.system_info === 'string' ? JSON.parse(a.system_info) : a.system_info) || {};
    } catch (_) {
      systemInfo = {};
    }
    const agentVersion = systemInfo.agent_version || 'legacy';
    const displayStatus = a.effective_status || a.status || 'offline';
    const isOnline = displayStatus === 'online' || displayStatus === 'busy';
    const dotClass = isOnline ? 'dot-green dot-pulse' : 'dot-red';
    const statusBadge = displayStatus === 'online' ? 'badge-green' : displayStatus === 'busy' ? 'badge-yellow' : 'badge-red';
    return `
      <div class="agent-card">
        <div class="agent-left">
          <span class="dot ${dotClass}"></span>
          <span class="agent-name">${escapeHtml(displayName)}</span>
          <span class="badge ${statusBadge}">${displayStatus}</span>
          ${!a.enabled ? '<span class="badge badge-red">暂停</span>' : ''}
          ${!a.registry_kind ? '<span class="badge badge-yellow">归属待确认</span>' : ''}
        </div>
        <div class="agent-mid">
          ${instances.map(i => {
            const portStatus = String(i.status || 'offline').toLowerCase();
            let tagClass = 'unhealthy';
            let mark = '✗';
            let tip = portStatus;
            if (portStatus === 'healthy') {
              tagClass = 'healthy';
              mark = '✓';
              tip = '正常';
            } else if (['offline', 'unhealthy', 'error', 'down', 'failed'].includes(portStatus)) {
              tagClass = 'unhealthy';
              mark = '✗';
              tip = '离线';
            } else if (['unknown', 'checking', 'unavailable'].includes(portStatus)) {
              tagClass = 'unknown';
              mark = '↻';
              tip = '检测中';
            } else {
              tagClass = 'unknown';
              mark = '?';
              tip = portStatus || '未知';
            }
            return `<span class="port-tag ${tagClass}" title="端口${i.port}: ${tip}" data-port="${i.port}">:${i.port} ${mark}</span>`;
          }).join('')}
        </div>
        <div class="agent-stats">
          <span>完成 <b style="color:var(--text-0)">${stats.tasks_completed || 0}</b></span>
          <span>失败 <b style="color:var(--text-0)">${stats.tasks_failed || 0}</b></span>
          <span title="节点版本" style="font-family:var(--font-mono);font-size:11px;color:${agentVersion === 'legacy' ? 'var(--danger)' : 'var(--success)'}">v ${agentVersion}</span>
          ${a.last_heartbeat ? `<span style="font-family:var(--font-mono);font-size:11px">${new Date(a.last_heartbeat).toLocaleTimeString('zh-CN')}</span>` : ''}
        </div>
        <div class="agent-actions">
          <select class="input agent-registry-select" aria-label="${escapeHtml(displayName)} 节点归属" onchange="setAgentRegistryKind('${a.agent_id}', this)">
            <option value="" ${!a.registry_kind ? 'selected' : ''} disabled>请选择归属</option>
            <option value="managed" ${a.registry_kind === 'managed' ? 'selected' : ''}>本地节点</option>
            <option value="external" ${a.registry_kind === 'external' ? 'selected' : ''}>外部节点</option>
          </select>
          <button class="btn btn-ghost btn-xs" onclick="renameAgent('${a.agent_id}', '${encodedDisplayName}')">改名</button>
          <button class="btn btn-ghost btn-xs" onclick="showAgentCommand('${a.agent_id}')">命令</button>
          <button class="btn btn-ghost btn-xs" onclick="toggleAgent('${a.agent_id}')">${a.enabled ? '暂停' : '启用'}</button>
          <button class="btn btn-danger btn-xs" onclick="deleteAgent('${a.agent_id}')">移除</button>
        </div>
        <div id="cmd-${a.agent_id}" class="agent-command hidden" style="grid-column:1/-1;margin-top:8px;padding:10px;background:var(--bg-0);border-radius:var(--radius-sm);border:1px solid var(--border)">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">Token:</div>
          <code style="font-size:11px;color:var(--accent);word-break:break-all">${a.token}</code>
          <div style="font-size:11px;color:var(--text-3);margin-top:8px;margin-bottom:4px">启动命令:</div>
          <pre style="font-size:11px;color:var(--text-1);white-space:pre-wrap;margin:0">curl -fsSL ${location.origin}/storage/tools/processing_agent.py -o processing_agent.py
python processing_agent.py \\
  --server ${location.origin} \\
  --token ${a.token} \\
  --ports 8188</pre>
          <button class="btn btn-ghost btn-xs" style="margin-top:6px" onclick="navigator.clipboard.writeText('curl -fsSL ${location.origin}/storage/tools/processing_agent.py -o processing_agent.py\\npython processing_agent.py --server ${location.origin} --token ${a.token} --ports 8188');showToast('已复制','success')">复制命令</button>
        </div>
      </div>`;
      }).join('') : `<div class="empty-state"><p>暂无${category.title}</p></div>`}
    </section>`;
  }).join('');
}

async function setAgentRegistryKind(id, select) {
  const previous = select.dataset.savedKind ?? select.querySelector('option[selected]')?.value ?? '';
  const registry_kind = select.value;
  select.disabled = true;
  try {
    await apiCall(`/api/admin/agents/${encodeURIComponent(id)}/registry-kind`, {
      method: 'PUT', body: JSON.stringify({ registry_kind }),
    });
    select.dataset.savedKind = registry_kind;
    showToast('节点归属已保存，任务调度保持不变', 'success');
    await fetchAgents();
  } catch (error) {
    select.value = select.dataset.savedKind ?? previous;
    showToast(error?.message || '保存或刷新失败，请重试', 'error');
  } finally { select.disabled = false; }
}

async function renameAgent(id, encodedCurrentName) {
  const currentName = decodeURIComponent(encodedCurrentName || '');
  const requestedName = window.prompt('请输入新的处理节点显示名称', currentName);
  if (requestedName === null) return;
  const name = requestedName.trim();
  if (!name) {
    showToast('名称不能为空', 'error');
    return;
  }
  if (name === currentName) return;
  await apiCall(`/api/admin/agents/${id}/name`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
  showToast('处理节点名称已更新', 'success');
  fetchAgents();
}

async function toggleAgent(id) {
  await apiCall(`/api/admin/agents/${id}/toggle`, { method: 'PUT' });
  fetchAgents();
}

async function deleteAgent(id) {
  if (!confirm('确定移除此处理节点？')) return;
  await apiCall(`/api/admin/agents/${id}`, { method: 'DELETE' });
  showToast('处理节点已移除', 'success');
  fetchAgents();
}

function showAgentCommand(id) {
  const el = document.getElementById('cmd-' + id);
  if (el) el.classList.toggle('hidden');
}


async function fetchWorkflowsDisk() {
  try {
    const data = await apiCall('/api/admin/workflows/scan-disk');
    const items = (data.workflows || []).filter(w => !w.is_api);
    workflowCatalogItems = items;

    const imported = items.filter(w => w.imported).length;
    const total = items.length;
    document.getElementById('workflow-summary').innerHTML = `
      <div class="flex items-center gap-3" style="font-size:12px;color:var(--text-2)">
        <span>共 <b style="color:var(--text-0)">${total}</b> 个工作流配置</span>
        <span class="flex items-center gap-2"><span class="dot dot-green" style="width:6px;height:6px"></span> 已导入 ${imported}</span>
        ${total - imported > 0 ? `<span class="flex items-center gap-2"><span class="dot dot-gray" style="width:6px;height:6px"></span> 待导入 ${total - imported}</span>` : ''}
      </div>`;

    const grouped = {};
    items.forEach(w => {
      const cat = w.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(w);
    });

    const order = ['image', 'video', 'upscale', 'tool', 'other'];
    let html = '';
    for (const cat of order) {
      const list = grouped[cat];
      if (!list || !list.length) continue;
      const meta = CATEGORY_META[cat] || CATEGORY_META.other;
      html += `
        <div class="category-section">
          <div class="category-title">
            <span>${meta.icon} ${meta.label}</span>
            <span class="category-count">${list.length}</span>
          </div>
          <div class="wf-grid">
            ${list.map(w => renderWorkflowCard(w, meta)).join('')}
          </div>
        </div>`;
    }

    if (!html) {
      html = `<div class="empty-state">
        <div class="empty-icon">⚡</div>
        <p>未找到工作流配置</p>
      </div>`;
    }
    document.getElementById('workflow-content').innerHTML = html;
  } catch (_) {}
}

function renderWorkflowCard(w, meta) {
  const ph = w.placeholders || [];
  const statusBadge = w.imported
    ? '<span class="badge badge-green">已导入</span>'
    : '<span class="badge badge-gray">待导入</span>';
  const typeBadge = w.is_api
    ? '<span class="badge badge-blue" style="font-size:10px">API</span>'
    : '<span class="badge badge-gray" style="font-size:10px">JSON</span>';
  const encodedName = encodeURIComponent(w.name || '');
  const encodedKey = encodeURIComponent(w.key || w.name || '');
  const canImportSingle = !w.imported && !w.is_api && Boolean(w.key || w.name || w.file) && w.can_import !== false;
  const actionHtml = w.imported
    ? `<button class="btn btn-ghost btn-xs" onclick="editWorkflowByName('${encodedName}')">编辑</button>`
    : (canImportSingle
      ? (w.requires_upload
        ? `<button class="btn btn-success btn-xs wf-import-btn" onclick="openWorkflowUploadImport(event, '${encodedKey}')" title="导入">导入</button>`
        : `<button class="btn btn-success btn-xs wf-import-btn" onclick="importWorkflowByKey(event, '${encodedKey}')" title="导入">导入</button>`)
      : '');

  return `
    <div class="wf-card">
      <div class="wf-icon" style="background:${meta.badge === 'badge-pink' ? 'rgba(236,72,153,0.1)' : meta.badge === 'badge-purple' ? 'rgba(168,85,247,0.1)' : meta.badge === 'badge-orange' ? 'rgba(249,115,22,0.1)' : meta.badge === 'badge-teal' ? 'rgba(20,184,166,0.1)' : 'rgba(113,113,122,0.1)'}">${CATEGORY_META[w.category]?.icon || '📦'}</div>
      <div class="wf-info">
        <div class="wf-name">${escapeHtml(w.name)}</div>
        <div class="wf-file">${escapeHtml(w.file || '(API 调用)')}</div>
        <div class="wf-meta">
          ${statusBadge} ${typeBadge}
          ${ph.length ? `<span style="font-size:10px;color:var(--text-3)">${ph.length} 占位符</span>` : ''}
        </div>
      </div>
      <div class="wf-actions">
        ${actionHtml}
      </div>
    </div>`;
}

async function importAllWorkflows() {
  showToast('正在导入...', 'info');
  try {
    const data = await apiCall('/api/admin/workflows/import-existing', { method: 'POST' });
    showToast(`导入完成: ${data.imported} 个新增, ${data.skipped} 已存在`, 'success');
    fetchWorkflowsDisk();
  } catch (_) {}
}

async function importWorkflowByKey(event, encodedKey) {
  if (event) event.stopPropagation();
  const key = decodeURIComponent(encodedKey || '');
  if (!key) {
    showToast('缺少工作流标识，无法导入', 'warn');
    return;
  }
  showToast('正在导入此工作流...', 'info');
  try {
    const data = await apiCall(`/api/admin/workflows/import-existing/${encodeURIComponent(key)}`, { method: 'POST' });
    const name = data.name || key;
    const action = data.imported > 0
      ? '导入完成'
      : (data.repaired > 0 ? '已同步修复' : '已存在');
    showToast(`${action}: ${name}`, 'success');
    fetchWorkflowsDisk();
  } catch (_) {}
}

function openWorkflowUploadImport(event, encodedKey) {
  if (event) event.stopPropagation();
  const key = decodeURIComponent(encodedKey || '');
  const item = workflowCatalogItems.find(w => String(w.key || w.name || '') === key);
  if (!item) {
    showToast('未找到待导入的工作流配置', 'warn');
    return;
  }
  openWorkflowModal({
    ...item,
    workflow_key: key,
    workflow_json: null,
    _uploadImport: true,
  });
  const fileInput = document.getElementById('wf-json-file');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

async function editWorkflowByName(encodedName) {
  const name = decodeURIComponent(encodedName);
  const data = await apiCall('/api/admin/workflows');
  const templates = data.workflows || data.templates || [];
  const found = templates.find(t => t.name === name);
  if (found) openWorkflowModal(found);
  else showToast('未在数据库中找到此工作流', 'warn');
}


function openWorkflowModal(template = null) {
  const isUploadImport = Boolean(template?._uploadImport);
  const uiCategories = new Set(['image', 'video', 'upscale', 'tool', 'other']);
  const rawCategory = template?.category || 'image';
  const workflowKey = template?.workflow_key
    || template?.key
    || (!uiCategories.has(rawCategory) ? rawCategory : '');
  document.getElementById('wf-modal-title').textContent = isUploadImport
    ? '导入工作流'
    : (template ? '编辑工作流' : '手动添加工作流');
  document.getElementById('wf-id').value = template?.template_id || '';
  document.getElementById('wf-key').value = workflowKey;
  document.getElementById('wf-name').value = template?.name || '';
  document.getElementById('wf-category').value = uiCategories.has(rawCategory) ? rawCategory : 'other';
  document.getElementById('wf-desc').value = template?.description || '';
  const wj = template?.workflow_json;
  document.getElementById('wf-json').value = wj ? (typeof wj === 'string' ? wj : JSON.stringify(wj, null, 2)) : '';
  document.getElementById('wf-nodes').innerHTML = '<p style="font-size:12px;color:var(--text-3)">上传 JSON 后点击"解析节点"</p>';
  document.getElementById('json-status').textContent = '';
  if (isUploadImport) {
    document.getElementById('json-status').innerHTML =
      '<span style="color:var(--text-2)">请选择完整、可执行的处理工作流 JSON；旧备份仅含占位内容，不会直接进入生产链路。</span>';
  }
  if (template?.placeholders) {
    const ph = typeof template.placeholders === 'string' ? JSON.parse(template.placeholders) : template.placeholders;
    renderPlaceholders(ph);
  }
  openModal('workflow-modal');
}

function loadJsonFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('wf-json').value = e.target.result;
    try {
      JSON.parse(e.target.result);
      document.getElementById('json-status').innerHTML = '<span style="color:var(--success)">✓ JSON 格式正确</span>';
    } catch (err) {
      document.getElementById('json-status').innerHTML = `<span style="color:var(--error)">✗ ${err.message}</span>`;
    }
  };
  reader.readAsText(file);
}

async function parseJsonNodes() {
  const jsonStr = document.getElementById('wf-json').value;
  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch (e) { showToast('JSON 格式错误: ' + e.message, 'error'); return; }
  document.getElementById('json-status').innerHTML = '<span style="color:var(--success)">✓ JSON 格式正确</span>';
  try {
    const data = await apiCall('/api/admin/workflows/parse-json', { method: 'POST', body: JSON.stringify(parsed) });
    renderNodeList(data.nodes || []);
  } catch (_) {}
}

function renderNodeList(nodes) {
  if (!nodes.length) {
    document.getElementById('wf-nodes').innerHTML = '<p style="font-size:12px;color:var(--text-3)">未发现可配置节点</p>';
    return;
  }
  document.getElementById('wf-nodes').innerHTML = nodes.map((n, i) => `
    <div style="background:var(--bg-0);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px">
      <label class="flex items-center gap-2" style="cursor:pointer">
        <input type="checkbox" class="node-ph-check" data-idx="${i}" ${n.is_placeholder ? 'checked' : ''} style="accent-color:var(--accent)">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-family:var(--font-mono);color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.node_id}: ${n.class_type}</div>
          <div style="font-size:11px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.field} = ${JSON.stringify(n.current_value).slice(0, 40)}</div>
        </div>
      </label>
      <div class="ph-config ${n.is_placeholder ? '' : 'hidden'}" style="margin-top:8px;margin-left:20px">
        <input type="text" class="ph-key input" style="font-size:12px;padding:5px 8px;margin-bottom:4px" placeholder="占位符键名" value="${n.is_placeholder ? String(n.current_value).replace(/[{}]/g, '') : ''}">
        <input type="text" class="ph-label input" style="font-size:12px;padding:5px 8px" placeholder="显示名称">
      </div>
    </div>
  `).join('');
  document.querySelectorAll('.node-ph-check').forEach(cb => {
    cb.addEventListener('change', e => {
      e.target.closest('div[style*="background"]').querySelector('.ph-config').classList.toggle('hidden', !e.target.checked);
    });
  });
}

function renderPlaceholders(ph) {
  document.getElementById('wf-nodes').innerHTML = ph.map((p, i) => `
    <div style="background:var(--bg-0);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px">
      <label class="flex items-center gap-2">
        <input type="checkbox" class="node-ph-check" data-idx="${i}" checked style="accent-color:var(--accent)">
        <span style="font-size:12px;font-family:var(--font-mono);color:var(--text-1)">${p.key || p}</span>
      </label>
      <div class="ph-config" style="margin-top:8px;margin-left:20px">
        <input type="text" class="ph-key input" style="font-size:12px;padding:5px 8px;margin-bottom:4px" value="${p.key || p}">
        <input type="text" class="ph-label input" style="font-size:12px;padding:5px 8px" value="${p.label || ''}" placeholder="显示名称">
      </div>
    </div>
  `).join('');
}

function collectPlaceholders() {
  const items = [];
  document.querySelectorAll('.node-ph-check:checked').forEach(cb => {
    const container = cb.closest('div[style*="background"]');
    const key = container.querySelector('.ph-key')?.value || '';
    const label = container.querySelector('.ph-label')?.value || key;
    if (key) items.push({ key, label, type: 'text', required: false, default: '' });
  });
  return items;
}

async function saveWorkflow() {
  const id = document.getElementById('wf-id').value;
  const jsonStr = document.getElementById('wf-json').value;
  let wfJson = {};
  if (jsonStr) {
    try { wfJson = JSON.parse(jsonStr); }
    catch (e) { showToast('JSON 格式错误', 'error'); return; }
  }
  const body = {
    name: document.getElementById('wf-name').value,
    category: document.getElementById('wf-category').value,
    description: document.getElementById('wf-desc').value,
    workflow_json: wfJson,
    placeholders: collectPlaceholders(),
    workflow_key: document.getElementById('wf-key').value,
  };
  if (id) {
    await apiCall(`/api/admin/workflows/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    showToast('工作流已更新', 'success');
  } else {
    await apiCall('/api/admin/workflows', { method: 'POST', body: JSON.stringify(body) });
    showToast('工作流已创建', 'success');
  }
  closeModal('workflow-modal');
  fetchWorkflowsDisk();
}

async function toggleWorkflow(id, enabled) {
  await apiCall(`/api/admin/workflows/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) });
  fetchWorkflowsDisk();
}

async function deleteWorkflow(id) {
  if (!confirm('确定删除此工作流模板？')) return;
  await apiCall(`/api/admin/workflows/${id}`, { method: 'DELETE' });
  showToast('工作流已删除', 'success');
  fetchWorkflowsDisk();
}


async function fetchApiConfigs() {
  const [data] = await Promise.all([
    apiCall('/api/admin/api-configs'),
    fetchApiProviderMeta(),
  ]);
  const allConfigs = data.api_configs || data.configs || [];
  const configs = allConfigs.filter(c => c.provider !== 'comfyui');
  hydrateApiProviderCatalog(data.providers || apiProviderCatalog);
  hydrateApiProviderStatus(data.provider_status || []);
  hydrateApiProviderRuntimeStatus(data.runtime_status || []);
  hydrateApiProviderHealth(data.provider_health || []);

  const configured = configs.filter(c => c.api_key_encrypted && c.api_key_encrypted !== '').length;
  const needKey = configs.filter(c => !c.api_key_encrypted || c.api_key_encrypted === '').length;
  const providerStatuses = data.provider_status || [];
  const runtimeStatuses = data.runtime_status || [];

  document.getElementById('config-summary').innerHTML = configs.length > 0 ? `
    <div class="flex items-center gap-3" style="font-size:12px;color:var(--text-2)">
      <span>共 <b style="color:var(--text-0)">${configs.length}</b> 个外部 API</span>
      <span class="flex items-center gap-2"><span class="dot dot-green" style="width:6px;height:6px"></span> 已配置 ${configured}</span>
      ${needKey > 0 ? `<span class="flex items-center gap-2"><span class="dot dot-gray" style="width:6px;height:6px"></span> 待填 Key ${needKey}</span>` : ''}
      ${renderProviderStatusSummary(providerStatuses)}
      ${renderRuntimeStatusSummary(runtimeStatuses)}
    </div>
  ` : '';

  if (!configs.length) {
    document.getElementById('apiconfig-list').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔑</div>
        <p>暂无外部 API 配置</p>
        <button class="btn btn-primary btn-sm" onclick="importApiPresets()">导入预置模型</button>
      </div>`;
    return;
  }

  const grouped = {};
  configs.forEach(c => {
    const cat = guessApiCategory(c);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(c);
  });

  const order = ['text', 'image', 'video', 'audio'];
  let html = '';
  for (const cat of order) {
    const items = grouped[cat];
    if (!items || !items.length) continue;
    const meta = CATEGORY_META[cat] || CATEGORY_META.other;
    html += `
      <div class="category-section">
        <div class="category-title">
          <span>${meta.icon} ${meta.label}</span>
          <span class="category-count">${items.length}</span>
        </div>
        <div class="space-y-2">
          ${items.map(c => renderApiCard(c)).join('')}
        </div>
      </div>`;
  }

  const uncategorized = Object.entries(grouped).filter(([k]) => !order.includes(k));
  for (const [, items] of uncategorized) {
    html += `
      <div class="category-section">
        <div class="category-title"><span>📦 其他</span></div>
        <div class="space-y-2">${items.map(c => renderApiCard(c)).join('')}</div>
      </div>`;
  }

  document.getElementById('apiconfig-list').innerHTML = html;
}

function guessApiCategory(config) {
  // Persisted category is authoritative. Keyword inference is only a read-time
  // compatibility path for rows created before category became required.
  const cat = (config.category || '').toLowerCase();
  if (cat === 'text' || cat === 'image' || cat === 'video' || cat === 'audio') {
    return cat;
  }
  // Check model_name as well as provider; video takes priority for mixed families.
  const p = (config.provider || '').toLowerCase();
  const m = (config.model_name || '').toLowerCase();

  if (
    p.includes('seedance') || p.includes('kling') || p.includes('vidu') || p.includes('happyhorse')
    || p.includes('sora') || p.includes('veo') || p.includes('dashscope') || p.includes('wan2')
    || m.includes('doubao-seedance') || m.includes('kling') || m.includes('vidu')
    || m.includes('happyhorse') || m.includes('wan2.6') || m.startsWith('veo') || m.startsWith('sora-')
  ) return 'video';
  if (p.includes('tts') || p.includes('minimax')
    || m.startsWith('speech-') || m.startsWith('tts-')) return 'audio';
  if (p.includes('gemini-image') || p.includes('laozhang-gpt-image')
    || p === 'doubao' || p.includes('qwen-image')
    || m.startsWith('gpt-image') || m.startsWith('seedream')) return 'image';
  if (p.includes('gemini-text') || p.includes('deepseek')
    || m.startsWith('deepseek-') || m.includes('gemini') && (m.endsWith('-flash') || m.endsWith('-pro'))) return 'text';
  return 'text';
}

function renderApiCard(c) {
  const hasKey = c.api_key_encrypted && c.api_key_encrypted !== '';
  const proxyLabel = c.proxy_mode === 'direct' ? '直连' : c.proxy_mode === 'agent' ? '节点代理' : c.proxy_mode || 'direct';
  const proxyBadge = c.proxy_mode === 'direct' ? 'badge-blue' : 'badge-purple';
  const provider = (c.provider || '').toLowerCase();
  const meta = getApiProviderMeta(provider);
  const providerStatus = getApiProviderStatus(provider);
  const runtimeStatus = getApiProviderRuntimeStatus(provider, c.model_name || '');
  const metaLine = renderProviderMetaLine(c);
  const runtimeLine = renderRuntimeMetaLine(runtimeStatus);
  const providerHealthLine = renderProviderHealthLine(provider, runtimeStatus);
  const usageHints = {
    'minimax': '此密钥同时驱动：Hailuo 视频生成 + 配音页 voice-design / voice-clone（共用 MINIMAX_API_KEY）',
    'gemini-text': '剧本生成 / AI 润色 等文本任务（GEMINI_TEXT_API_KEY）',
    'gemini-image': '设计页 Gemini Image 生图使用此密钥（GEMINI_IMAGE_API_KEY）',
    'doubao': '设计页 Doubao Seedream 5.0 Lite 生图使用此密钥（ARK_API_KEY）',
    'deepseek': '剧本生成的 DeepSeek 文本模型（DEEPSEEK_API_KEY）',
    'sora2': '视频生成 Sora2 模型（SORA2_API_KEY）',
    'veo': '视频生成 Veo 模型（VEO_API_KEY）',
    'dashscope': '阿里云百炼共享 API · 一份 Key 驱动 Wan2.6 + Kling + Vidu + HappyHorse 全部视频族（DASHSCOPE_API_KEY）',
    'seedance': '视频生成 Doubao Seedance 2.0 / 2.0 Fast（SEEDANCE_API_KEY）',
    'laozhang-gpt-image': '分镜页 GPT Image 2 VIP + Gemini Image，使用 laozhang【默认分组】Token（GPT_IMAGE_API_KEY）',
    'laozhang-sora2': '分镜页 GPT Image 2 官方混合，使用 laozhang【Sora2Official 分组】Token（SORA2_GPT_IMAGE_API_KEY）',
  };
  const hint = meta?.notes || usageHints[provider] || '';

  return `
    <div class="api-card">
      <div class="api-status ${hasKey ? 'ok' : 'pending'}"></div>
      <div class="api-info">
        <div class="api-name">
          ${escapeHtml(c.name)}
          ${!c.enabled ? '<span class="badge badge-red" style="margin-left:6px">禁用</span>' : ''}
        </div>
        <div class="api-detail">
          <span class="badge ${proxyBadge}" style="font-size:10px">${proxyLabel}</span>
          ${renderProviderStatusBadge(providerStatus)}
          ${renderRuntimeStatusBadge(runtimeStatus)}
          ${renderProviderHealthBadge(provider, runtimeStatus)}
          <span class="mono">${escapeHtml(c.model_name || '-')}</span>
          <span class="mono">${escapeHtml(c.endpoint ? c.endpoint.replace(/^https?:\/\//, '').slice(0, 56) : '-')}</span>
          ${!hasKey ? '<span style="color:var(--warning);font-weight:600">需要填入 Key</span>' : ''}
        </div>
        ${metaLine}
        ${runtimeLine}
        ${providerHealthLine}
        ${hint ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:4px;line-height:1.4">${escapeHtml(hint)}</div>` : ''}
      </div>
      <div class="api-actions">
        <button class="btn btn-ghost btn-xs" onclick="testApiConfig('${c.config_id}')" title="健康检查">健康</button>
        <button class="btn btn-ghost btn-xs" onclick="testProviderHealth('${provider}')" title="测试当前 provider 的运行时 key/endpoint">运行时</button>
        <button class="btn btn-ghost btn-xs" onclick="toggleApiConfig('${c.config_id}', ${!c.enabled})" title="${c.enabled ? '禁用此配置（生产路径将不再加载它的 Key）' : '启用此配置（reload 后 module 变量立即生效）'}">${c.enabled ? '禁用' : '启用'}</button>
        <button class="btn btn-ghost btn-xs" onclick="editApiConfig('${c.config_id}')">编辑</button>
        <button class="btn btn-danger btn-xs" onclick="deleteApiConfig('${c.config_id}')">删除</button>
      </div>
    </div>`;
}

async function importApiPresets() {
  showToast('正在导入预置模型...', 'info');
  try {
    const data = await apiCall('/api/admin/api-configs/import-presets', { method: 'POST' });
    showToast(`导入完成: ${data.imported} 个新增, ${data.skipped} 已存在`, 'success');
    fetchApiConfigs();
  } catch (_) {}
}

async function importRuntimeEnvKeys() {
  if (!confirm('将当前服务进程环境变量中的 API Key 加密写入数据库，并启用对应配置。继续？')) return;
  showToast('正在从运行时环境导入 Key...', 'info');
  try {
    const preview = await apiCall('/api/admin/api-configs/import-presets', {
      method: 'POST',
      body: JSON.stringify({
        copy_runtime_env_keys: true,
        update_existing_empty_keys: true,
        enable_copied_keys: true,
        dry_run: true,
      }),
    });
    const message = [
      '预览结果：',
      `新增配置：${preview.imported || 0}`,
      `更新空 Key 配置：${preview.updated_existing || 0}`,
      `将写入 Key：${preview.env_keys_imported || 0}`,
      `已有/复用 Key：${preview.env_keys_existing || 0}`,
      `跳过重复 provider：${preview.env_keys_skipped_provider_claimed || 0}`,
      `缺失运行时 Key：${preview.env_keys_missing || 0}`,
      '',
      '确认执行写入？',
    ].join('\n');
    if (!confirm(message)) {
      showToast('已取消运行时 Key 导入', 'info');
      return;
    }
    const data = await apiCall('/api/admin/api-configs/import-presets', {
      method: 'POST',
      body: JSON.stringify({
        copy_runtime_env_keys: true,
        update_existing_empty_keys: true,
        enable_copied_keys: true,
      }),
    });
    showToast(
      `运行时 Key 导入完成: 新增 ${data.imported || 0}, 更新 ${data.updated_existing || 0}, 写入 Key ${data.env_keys_imported || 0}, 已有/复用 ${data.env_keys_existing || 0}, 跳过重复 ${data.env_keys_skipped_provider_claimed || 0}, 缺失 ${data.env_keys_missing || 0}`,
      'success'
    );
    fetchApiConfigs();
  } catch (_) {}
}

function openApiConfigModal(config = null) {
  document.getElementById('api-modal-title').textContent = config ? '编辑 API' : '添加 API';
  document.getElementById('api-id').value = config?.config_id || '';
  document.getElementById('api-name').value = config?.name || '';
  ensureApiProviderOptions();
  // Preserve an unknown stored provider instead of silently saving an empty value.
  const provSel = document.getElementById('api-provider');
  const provVal = config?.provider || '';
  if (provVal && !Array.from(provSel.options).some(o => o.value === provVal)) {
    const opt = document.createElement('option');
    opt.value = provVal;
    opt.textContent = `${provVal}（存量值）`;
    provSel.appendChild(opt);
  }
  provSel.value = provVal;
  document.getElementById('api-model').value = config?.model_name || '';
  document.getElementById('api-endpoint').value = config?.endpoint || '';
  document.getElementById('api-key').value = '';
  document.getElementById('api-custom-proxy').value = config?.custom_proxy || '';

  const catSel = document.getElementById('api-cat');
  if (catSel) catSel.value = config?.category || '';
  const mode = config?.proxy_mode || 'direct';
  document.querySelectorAll('[name="proxy-mode"]').forEach(r => { r.checked = r.value === mode; });
  document.getElementById('custom-proxy-row').classList.toggle('hidden', mode !== 'custom');

  const statusEl = document.getElementById('api-key-status');
  const keyInput = document.getElementById('api-key');
  if (config && config.api_key_encrypted && config.api_key_encrypted !== '' && config.api_key_encrypted !== '***') {
    statusEl.textContent = '';
    keyInput.placeholder = 'sk-...';
  } else if (config && config.api_key_encrypted === '***') {
    statusEl.textContent = '✓ 已配置';
    statusEl.style.color = 'var(--success)';
    keyInput.placeholder = '留空保留现有密钥，填写则替换';
  } else {
    statusEl.textContent = '未配置';
    statusEl.style.color = 'var(--warning)';
    keyInput.placeholder = '请输入 API Key';
  }

  openModal('apiconfig-modal');
}

async function editApiConfig(id) {
  const data = await apiCall('/api/admin/api-configs');
  const config = (data.api_configs || data.configs || []).find(c => c.config_id === id);
  if (config) openApiConfigModal(config);
}

async function saveApiConfig() {
  const id = document.getElementById('api-id').value;
  const mode = document.querySelector('[name="proxy-mode"]:checked')?.value || 'direct';
  const body = {
    name: document.getElementById('api-name').value,
    provider: document.getElementById('api-provider').value,
    endpoint: document.getElementById('api-endpoint').value,
    model_name: document.getElementById('api-model').value,
    proxy_mode: mode,
    custom_proxy: document.getElementById('api-custom-proxy').value,

    category: document.getElementById('api-cat')?.value || '',
  };
  const keyVal = document.getElementById('api-key').value;
  if (keyVal) body.api_key = keyVal;
  if (id) {
    await apiCall(`/api/admin/api-configs/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    showToast('已更新，环境变量已刷新', 'success');
  } else {
    if (!keyVal) { showToast('请输入 API Key', 'warn'); return; }
    await apiCall('/api/admin/api-configs', { method: 'POST', body: JSON.stringify(body) });
    showToast('已创建，环境变量已刷新', 'success');
  }
  closeModal('apiconfig-modal');
  fetchApiConfigs();
}

async function testApiConfig(id) {
  showToast('正在执行健康检查...', 'info');
  try {
    const data = await apiCall(`/api/admin/api-configs/${id}/test`, { method: 'POST' });
    const t = data.test || {};
    if (data.success && t.ok) {
      const runtimeWarning = t.config_enabled === false
        ? '此条 DB 配置未启用，真实调用不会使用它'
        : t.is_runtime_effective === false
          ? `真实调用当前使用：${t.runtime_effective_config_name || t.runtime_effective_config_id || '其它配置'}`
          : '';
      showToast(runtimeWarning || `健康检查通过 (HTTP ${t.status_code})`, runtimeWarning ? 'warn' : 'success');
    } else if (
      String(t.status || '').toLowerCase() === 'connectivity_ok'
      || (t.reachable && t.auth_ok && String(t.error || '').toLowerCase().includes('generation is not verified'))
    ) {
      showToast('连接可达，但此检查不代表真实生成成功；请用一次真实生成确认厂商可用性', 'warn');
    } else if (String(t.error || '').includes('User location is not supported')) {
      showToast('Gemini API 地区受限：当前服务器出口不支持 Google AI Studio API', 'warn');
    } else if (t.reachable && t.auth_ok === false) {
      showToast(`认证失败: ${t.error || `HTTP ${t.status_code}`}`, 'error');
    } else if (t.reachable) {
      showToast(`端点可达但校验未通过: ${t.error || `HTTP ${t.status_code}`}`, 'warn');
    } else {
      showToast(`健康检查失败: ${t.error || '未知错误'}`, 'error');
    }
  } catch (_) {}
}

async function testProviderHealth(provider) {
  const normalized = normalizeProviderId(provider);
  if (!normalized) return;
  showToast(`正在测试 provider: ${normalized}`, 'info');
  try {
    const data = await apiCall(`/api/admin/api-configs/${encodeURIComponent(normalized)}/health`);
    apiProviderHealthMap.set(normalized, data);
    if (data.status === 'ok') {
      showToast(`provider ${normalized} 正常 (${data.latency_ms}ms)`, 'success');
    } else if (data.status === 'no_key') {
      showToast(`provider ${normalized} 未配置 Key`, 'warn');
    } else if (data.status === 'blocked_region') {
      showToast(`provider ${normalized} 地区受限：当前服务器出口不支持 Gemini API`, 'warn');
    } else if (data.status === 'connectivity_ok') {
      showToast(`provider ${normalized} 连接可达，但真实生成未验证`, 'warn');
    } else {
      const detail = data.health || {};
      showToast(`provider ${normalized} 异常: ${detail.error || data.status || 'unknown'}`, 'error');
    }
    fetchApiConfigs();
  } catch (_) {}
}







async function toggleApiConfig(id, nextEnabled) {
  try {
    await apiCall(`/api/admin/api-configs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: nextEnabled }),
    });
    showToast(nextEnabled ? '已启用，环境变量已刷新' : '已禁用，环境变量已刷新', 'success');
    fetchApiConfigs();
  } catch (e) {
    showToast(`切换失败: ${e?.message || '未知错误'}`, 'error');
  }
}

async function deleteApiConfig(id) {
  if (!confirm('确定删除此 API 配置？')) return;
  await apiCall(`/api/admin/api-configs/${id}`, { method: 'DELETE' });
  showToast('已删除', 'success');
  fetchApiConfigs();
}

document.querySelectorAll('[name="proxy-mode"]').forEach(r => {
  r.addEventListener('change', e => {
    document.getElementById('custom-proxy-row').classList.toggle('hidden', e.target.value !== 'custom');
  });
});


async function fetchSettings() {
  const data = await apiCall('/api/admin/settings');
  const settings = data.settings || [];
  const keys = ['proxy_http', 'proxy_https', 'proxy_socks5', 'proxy_no_proxy'];
  const labels = { proxy_http: 'HTTP 代理', proxy_https: 'HTTPS 代理', proxy_socks5: 'SOCKS5 代理', proxy_no_proxy: '不代理' };
  const descs = { proxy_http: 'http://127.0.0.1:7890', proxy_https: 'http://127.0.0.1:7890', proxy_socks5: 'socks5://127.0.0.1:7891', proxy_no_proxy: '127.0.0.1,localhost' };
  document.getElementById('proxy-settings').innerHTML = keys.map(k => {
    const s = settings.find(x => x.key === k);
    return `<div>
      <label class="input-label">${labels[k]}</label>
      <input id="setting-${k}" type="text" value="${s?.value || ''}" class="input" placeholder="${descs[k] || ''}">
    </div>`;
  }).join('');
}

async function saveGlobalSettings() {
  const settings = {};
  ['proxy_http', 'proxy_https', 'proxy_socks5', 'proxy_no_proxy'].forEach(k => {
    const el = document.getElementById('setting-' + k);
    if (el) settings[k] = el.value;
  });
  await apiCall('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ settings }) });
  showToast('代理设置已保存', 'success');
}




const VALID_PAGES = ['dashboard', 'cluster', 'workflows', 'apiconfig'];

function targetPage() {
  // Query deep links take priority over the legacy hash route.
  const q = new URLSearchParams(location.search).get('page');
  if (VALID_PAGES.includes(q)) return q;
  const h = (location.hash || '').replace(/^#/, '');
  return VALID_PAGES.includes(h) ? h : 'dashboard';
}

function legacyShellItem(page) {
  return page === 'apiconfig' ? 'legacy-apiconfig' : page;
}

function redirectToAdminLoginForLegacy() {
  const from = ADMIN_SHELL_PATH + '/settings?item=' + encodeURIComponent(legacyShellItem(targetPage()));
  const loginUrl = '/login?redirect=' + encodeURIComponent(from);
  if (window.top && window.top !== window.self) {
    window.top.location.href = loginUrl;
  } else {
    window.location.href = loginUrl;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const embed = new URLSearchParams(location.search).get('embed') === '1';
  // Standalone access returns to the authenticated shell; embedded access stays local.
  if (!embed && window.self === window.top) {
    location.replace(ADMIN_SHELL_PATH + '/settings?item=' + legacyShellItem(targetPage()));
    return;
  }
  if (embed) document.body.classList.add('embedded');
  navigateTo(targetPage());
});
window.addEventListener('hashchange', () => navigateTo(targetPage()));
