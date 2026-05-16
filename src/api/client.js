const AUTH_TOKEN_KEY = 'competitor_auth_token';

export function getAuthToken() {
  return window.localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

export function setAuthToken(token) {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

async function request(path, options = {}) {
  const token = getAuthToken();
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  me: () => request('/api/auth/me'),

  listAdminUsers: () => request('/api/admin/users'),
  createAdminUser: (payload) => request('/api/admin/users', { method: 'POST', body: payload }),
  updateAdminUserPassword: (id, password) => request(`/api/admin/users/${id}/password`, { method: 'PATCH', body: { password } }),
  setAdminUserActive: (id, active) => request(`/api/admin/users/${id}/active`, { method: 'PATCH', body: { active } }),
  listAdminSettings: () => request('/api/admin/settings'),
  saveAdminSetting: (payload) => request('/api/admin/settings', { method: 'PATCH', body: payload }),

  listSites: () => request('/api/sites'),
  createSite: (payload) => request('/api/sites', { method: 'POST', body: payload }),
  updateSite: (id, payload) => request(`/api/sites/${id}`, { method: 'PATCH', body: payload }),
  getSiteExtractRule: (id) => request(`/api/sites/${id}/extract-rule`),
  saveSiteExtractRule: (id, payload) => request(`/api/sites/${id}/extract-rule`, { method: 'PATCH', body: payload }),
  testSiteExtractRule: (id, payload) => request(`/api/sites/${id}/test-extract-rule`, { method: 'POST', body: payload }),
  syncProducts: (id) => request(`/api/sites/${id}/sync-products`, { method: 'POST' }),
  setOwnSite: (id) => request(`/api/sites/${id}/set-own`, { method: 'POST' }),
  unsetOwnSite: (id) => request(`/api/sites/${id}/unset-own`, { method: 'POST' }),

  listProducts: (params = {}) => {
    const search = new URLSearchParams();
    if (params.siteId) search.set('siteId', params.siteId);
    if (params.q) search.set('q', params.q);
    if (params.ownOnly) search.set('ownOnly', '1');
    if (params.includeHidden) search.set('includeHidden', '1');
    if (params.page) search.set('page', params.page);
    if (params.pageSize) search.set('pageSize', params.pageSize);
    return request(`/api/products?${search.toString()}`);
  },
  getProduct: (id) => request(`/api/products/${id}`),
  fetchPageText: (id) => request(`/api/products/${id}/fetch-page`, { method: 'POST' }),
  extractSpecs: (id) => request(`/api/products/${id}/extract-specs`, { method: 'POST' }),
  setProductHidden: (id, hidden) => request(`/api/products/${id}/hidden`, { method: 'PATCH', body: { hidden } }),
  updateSpec: (productId, specKey, payload) => request(`/api/products/${productId}/specs/${encodeURIComponent(specKey)}`, { method: 'PATCH', body: payload }),
  updateSpecs: (productId, payload) => request(`/api/products/${productId}/specs`, { method: 'PATCH', body: payload }),
  refreshPrice: (id) => request(`/api/products/${id}/refresh-price`, { method: 'POST' }),

  listReportOwnProducts: () => request('/api/report-own-products'),

  listRelations: (params = {}) => {
    const search = new URLSearchParams();
    if (params.ownProductId) search.set('ownProductId', params.ownProductId);
    if (params.ownSiteOnly) search.set('ownSiteOnly', '1');
    if (params.q) search.set('q', params.q);
    if (params.page) search.set('page', params.page);
    if (params.pageSize) search.set('pageSize', params.pageSize);
    return request(`/api/relations?${search.toString()}`);
  },
  createRelation: (payload) => request('/api/relations', { method: 'POST', body: payload }),
  deleteRelation: (id) => request(`/api/relations/${id}`, { method: 'DELETE' }),

  createReport: (payload) => request('/api/reports', { method: 'POST', body: payload }),
  previewReport: (payload) => request('/api/reports/preview', { method: 'POST', body: payload }),
  listReports: (params = {}) => {
    const search = new URLSearchParams();
    if (params.ownProductId) search.set('ownProductId', params.ownProductId);
    return request(`/api/reports?${search.toString()}`);
  },
  getReport: (id) => request(`/api/reports/${id}`),
  deleteReport: (id) => request(`/api/reports/${id}`, { method: 'DELETE' }),
  analyzeReport: (id) => request(`/api/reports/${id}/analysis`, { method: 'POST' }),
};
