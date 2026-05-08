// src/lib/api.ts
// Drop-in replacement for supabase.ts — all calls go to your Azure API

const API_URL = import.meta.env.VITE_API_URL || 'https://kuki-api-prod.azurewebsites.net';

function getToken(): string | null {
  return localStorage.getItem('kuki_token');
}

export function setToken(token: string) {
  localStorage.setItem('kuki_token', token);
}

export function clearToken() {
  localStorage.removeItem('kuki_token');
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isFormData = false
): Promise<{ data: T | null; error: string | null }> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return { data: null, error: null };

    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error || 'Request failed' };
    return { data: json as T, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Network error' };
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
export const auth = {
  async signUp(email: string, password: string, name: string, role: 'employer' | 'employee') {
    const { data, error } = await request<{ token: string; user: any }>('POST', '/auth/signup', { email, password, name, role });
    if (data?.token) setToken(data.token);
    return { data, error };
  },

  async signIn(emailOrPhone: string, password: string) {
    const { data, error } = await request<{ token: string; user: any }>('POST', '/auth/login', { emailOrPhone, password });
    if (data?.token) setToken(data.token);
    return { data, error };
  },

  async getSession() {
    const token = getToken();
    if (!token) return { data: { session: null } };
    const { data, error } = await request<{ user: any }>('GET', '/auth/me');
    if (error) return { data: { session: null } };
    return { data: { session: { user: data?.user } } };
  },

  async signOut() {
    await request('POST', '/auth/logout');
    clearToken();
  },
};

// ─── PROFILES ─────────────────────────────────────────────────────────────────
export const profiles = {
  get: (id: string) => request<any>('GET', `/profiles/${id}`),
  update: (id: string, updates: Record<string, any>) => request<any>('PATCH', `/profiles/${id}`, updates),
  list: () => request<any[]>('GET', '/profiles'),
  toggleAds: (id: string, ads_enabled: boolean) => request<any>('PATCH', `/profiles/${id}/ads-toggle`, { ads_enabled }),
  uploadPhoto: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('photo', file);
    return request<{ profile_photo: string }>('POST', `/profiles/${id}/photo`, formData, true);
  },
};

// ─── EMPLOYEES ────────────────────────────────────────────────────────────────
export const employees = {
  list: () => request<any[]>('GET', '/employees'),
  add: (data: Record<string, any>) => request<any>('POST', '/employees', data),
  update: (id: string, updates: Record<string, any>) => request<any>('PATCH', `/employees/${id}`, updates),
  remove: (id: string) => request<any>('DELETE', `/employees/${id}`),
};

// ─── ATTENDANCE ───────────────────────────────────────────────────────────────
export const attendance = {
  list: (params?: { employee_id?: string; from?: string; to?: string }) => {
    const qs = new URLSearchParams(params as any).toString();
    return request<any[]>('GET', `/attendance${qs ? '?' + qs : ''}`);
  },
  clockIn: (data: Record<string, any>) => request<any>('POST', '/attendance/clock-in', data),
  clockOut: (id: string) => request<any>('PATCH', `/attendance/${id}/clock-out`, {}),
  manualEntry: (data: Record<string, any>) => request<any>('POST', '/attendance/manual', data),
};

// ─── WAGES ────────────────────────────────────────────────────────────────────
export const wages = {
  list: (employee_id?: string) => request<any[]>('GET', `/wages${employee_id ? '?employee_id=' + employee_id : ''}`),
  create: (data: Record<string, any>) => request<any>('POST', '/wages', data),
  update: (id: string, updates: Record<string, any>) => request<any>('PATCH', `/wages/${id}`, updates),
  loans: {
    list: (employee_id?: string) => request<any[]>('GET', `/wages/loans${employee_id ? '?employee_id=' + employee_id : ''}`),
    get: (id: string) => request<any>('GET', `/wages/loans/${id}`),
    create: (data: Record<string, any>) => request<any>('POST', '/wages/loans', data),
    update: (id: string, updates: Record<string, any>) => request<any>('PATCH', `/wages/loans/${id}`, updates),
  },
  bonuses: {
    list: (employee_id?: string) => request<any[]>('GET', `/wages/bonuses${employee_id ? '?employee_id=' + employee_id : ''}`),
    create: (data: Record<string, any>) => request<any>('POST', '/wages/bonuses', data),
  },
  contracts: {
    list: (employee_id?: string) => request<any[]>('GET', `/wages/contracts${employee_id ? '?employee_id=' + employee_id : ''}`),
    create: (data: Record<string, any>) => request<any>('POST', '/wages/contracts', data),
  },
  statements: {
    list: (filters?: { user_id?: string; employee_id?: string }) => {
      const qs = filters ? '?' + new URLSearchParams(filters as any).toString() : '';
      return request<any[]>('GET', `/wages/statements${qs}`);
    },
    create: (data: Record<string, any>) => request<any>('POST', '/wages/statements', data),
  },
};

// ─── QR TRANSACTIONS ──────────────────────────────────────────────────────────
export const qrTransactions = {
  create: (data: Record<string, any>) => request<any>('POST', '/qr-transactions', data),
  getByCode: (qr_code: string) => request<any>('GET', `/qr-transactions?qr_code=${encodeURIComponent(qr_code)}`),
  update: (id: string, updates: Record<string, any>) => request<any>('PATCH', `/qr-transactions/${id}`, updates),
};

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
export const messages = {
  list: () => request<any[]>('GET', '/messages'),
  send: (receiver_id: string, content: string) => request<any>('POST', '/messages', { receiver_id, content }),
  markRead: (id: string) => request<any>('PATCH', `/messages/${id}/read`, {}),
  jobs: {
    list: () => request<any[]>('GET', '/messages/jobs'),
    create: (data: Record<string, any>) => request<any>('POST', '/messages/jobs', data),
    apply: (job_id: string) => request<any>('POST', `/messages/jobs/${job_id}/apply`, {}),
  },
};

// ─── ADMIN ────────────────────────────────────────────────────────────────────
export const admin = {
  stats: () => request<any>('GET', '/admin/stats'),
  jobRoles: {
    list: () => request<any[]>('GET', '/admin/job-roles'),
    create: (data: Record<string, any>) => request<any>('POST', '/admin/job-roles', data),
    update: (id: string, data: Record<string, any>) => request<any>('PATCH', `/admin/job-roles/${id}`, data),
    delete: (id: string) => request<any>('DELETE', `/admin/job-roles/${id}`),
  },
  ads: {
    list: () => request<any[]>('GET', '/admin/ads'),
    create: (data: Record<string, any>) => request<any>('POST', '/admin/ads', data),
    update: (id: string, data: Record<string, any>) => request<any>('PATCH', `/admin/ads/${id}`, data),
    delete: (id: string) => request<any>('DELETE', `/admin/ads/${id}`),
    impressions: () => request<Record<string, number>>('GET', '/admin/ad-impressions'),
    recordView: (ad_id: string) => request<any>('POST', '/admin/ad-impressions', { ad_id }),
  },
  subscriptions: {
    list: () => request<any[]>('GET', '/admin/subscriptions'),
    approve: (id: string) => request<any>('PATCH', `/admin/subscriptions/${id}/approve`, {}),
  },
  loginLogs: () => request<any[]>('GET', '/admin/login-logs'),
  planChanges: {
    list: () => request<any[]>('GET', '/admin/plan-changes'),
    create: (data: Record<string, any>) => request<any>('POST', '/admin/plan-changes', data),
    review: (id: string, status: string, reviewed_by?: string) =>
      request<any>('PATCH', `/admin/plan-changes/${id}`, { status, reviewed_by }),
  },
  ratings: {
    list: (filters?: { employee_id?: string; employer_id?: string }) => {
      const qs = filters ? '?' + new URLSearchParams(filters as any).toString() : '';
      return request<any[]>('GET', `/admin/ratings${qs}`);
    },
    upsert: (data: Record<string, any>) => request<any>('POST', '/admin/ratings', data),
  },
};
