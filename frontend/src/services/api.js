const DEFAULT_BACKEND_PORT = '8080';

export function getDefaultApiBase() {
  if (typeof window === 'undefined') return `http://localhost:${DEFAULT_BACKEND_PORT}`;
  if (window.location.origin === 'null') return `http://localhost:${DEFAULT_BACKEND_PORT}`;
  const { protocol, hostname, port } = window.location;
  const isLocalPreview = ['localhost', '127.0.0.1', '::1'].includes(hostname) && port && port !== DEFAULT_BACKEND_PORT;
  if (isLocalPreview) return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}`;
  return window.location.origin;
}

export function normalizeBase(value) {
  return (value || '').trim().replace(/\/+$/, '');
}

export async function request(apiBase, path, options = {}) {
  const url = `${normalizeBase(apiBase)}${path}`;
  const init = {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
  };
  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`服务返回内容不是 JSON，请检查服务地址：${url}`);
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `操作失败：${response.status}`);
  }
  return data;
}
