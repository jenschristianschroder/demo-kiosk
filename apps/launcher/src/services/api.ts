import { Demo, KioskSettings } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || '';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export async function getDemos(tag?: string): Promise<Demo[]> {
  const params = new URLSearchParams({ active: 'true' });
  if (tag) params.set('tag', tag);
  return fetchJson<Demo[]>(`${API_BASE}/api/demos?${params}`);
}

export async function getDemo(id: string): Promise<Demo> {
  return fetchJson<Demo>(`${API_BASE}/api/demos/${encodeURIComponent(id)}`);
}

export async function getSettings(): Promise<KioskSettings> {
  return fetchJson<KioskSettings>(`${API_BASE}/api/settings`);
}

// Admin CRUD
export async function createDemo(demo: Partial<Demo>): Promise<Demo> {
  return fetchJson<Demo>(`${API_BASE}/api/demos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(demo),
  });
}

export async function updateDemo(id: string, updates: Partial<Demo>): Promise<Demo> {
  return fetchJson<Demo>(`${API_BASE}/api/demos/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function patchDemo(id: string, updates: Partial<Demo>): Promise<Demo> {
  return fetchJson<Demo>(`${API_BASE}/api/demos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function deleteDemo(id: string): Promise<void> {
  return fetchJson<void>(`${API_BASE}/api/demos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function updateSettings(settings: Partial<KioskSettings>): Promise<KioskSettings> {
  return fetchJson<KioskSettings>(`${API_BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
