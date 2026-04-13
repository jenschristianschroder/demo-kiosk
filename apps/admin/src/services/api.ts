import { Demo, KioskSettings } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || '';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export const api = {
  getDemos: (): Promise<Demo[]> =>
    fetchJson<Demo[]>(`${API_BASE}/api/demos`),

  getDemo: (id: string): Promise<Demo> =>
    fetchJson<Demo>(`${API_BASE}/api/demos/${encodeURIComponent(id)}`),

  createDemo: (demo: Partial<Demo>): Promise<Demo> =>
    fetchJson<Demo>(`${API_BASE}/api/demos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(demo),
    }),

  updateDemo: (id: string, demo: Partial<Demo>): Promise<Demo> =>
    fetchJson<Demo>(`${API_BASE}/api/demos/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(demo),
    }),

  patchDemo: (id: string, updates: Partial<Demo>): Promise<Demo> =>
    fetchJson<Demo>(`${API_BASE}/api/demos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }),

  deleteDemo: (id: string): Promise<void> =>
    fetchJson<void>(`${API_BASE}/api/demos/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getSettings: (): Promise<KioskSettings> =>
    fetchJson<KioskSettings>(`${API_BASE}/api/settings`),

  updateSettings: (settings: Partial<KioskSettings>): Promise<KioskSettings> =>
    fetchJson<KioskSettings>(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),
};
