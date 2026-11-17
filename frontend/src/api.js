const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const store = {
  get: (k) => {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set: (k, v) => {
    try { localStorage.setItem(k, v); } catch { /* ignore */ }
  },
  del: (k) => {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  },
};

export const tokens = {
  get access() { return store.get('accessToken'); },
  get refresh() { return store.get('refreshToken'); },
  set({ accessToken, refreshToken }) {
    if (accessToken) store.set('accessToken', accessToken);
    if (refreshToken) store.set('refreshToken', refreshToken);
  },
  clear() {
    store.del('accessToken');
    store.del('refreshToken');
  },
};

let refreshing = null;

async function refreshTokens() {
  if (!tokens.refresh) return false;
  // Share one in-flight refresh so parallel 401s don't revoke each other's tokens.
  refreshing ??= fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refresh }),
  })
    .then(async (res) => {
      if (!res.ok) return false;
      tokens.set(await res.json());
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function api(path, { method = 'GET', body, retry = true } = {}) {
   // FormData (file uploads) must not get a JSON content type; the browser sets the boundary.
  const isForm = body instanceof FormData;
  const headers = isForm ? {} : { 'Content-Type': 'application/json' };
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  

  if (res.status === 401 && retry && tokens.refresh && (await refreshTokens())) {
    return api(path, { method, body, retry: false });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.errors?.map((e) => `${String(e.field).split('.').pop()}: ${e.msg}`)
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Downloads a file that needs the login token (a plain <a href> link cannot send it).
export async function downloadFile(path, filename) {
  const go = () => fetch(`${API_URL}${path}`, { headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {} });
  let res = await go();
  if (res.status === 401 && tokens.refresh && (await refreshTokens())) res = await go();
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Download failed');
  }
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
