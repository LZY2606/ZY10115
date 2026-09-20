import type { Dataset, Evidence, SolveParams, SolveResult } from '../shared/types.ts';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  listDatasets: () => request<Array<{ id: string; name: string; imageCount: number; catalogCount: number }>>('/api/datasets'),
  getDataset: (id: string) => request<Dataset>(`/api/datasets/${id}`),
  createDataset: (payload: unknown) =>
    request<{ dataset: Dataset; reused: boolean }>('/api/datasets', { method: 'POST', body: JSON.stringify(payload) }),
  addEvidence: (datasetId: string, payload: unknown) =>
    request<{ evidence: Evidence; reused: boolean }>(`/api/datasets/${datasetId}/evidence`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listSolves: (datasetId: string) =>
    request<Array<unknown>>(`/api/datasets/${datasetId}/solves`),
  solve: (datasetId: string, params: SolveParams) =>
    request<{ result: SolveResult; cached: boolean }>(`/api/datasets/${datasetId}/solves`, {
      method: 'POST',
      body: JSON.stringify({ params }),
    }),
  replay: (datasetId: string, rulesVersion: string, params: SolveParams) =>
    request<{ result: SolveResult }>(`/api/datasets/${datasetId}/replay`, {
      method: 'POST',
      body: JSON.stringify({ rulesVersion, params }),
    }),
  getSolve: (hash: string) => request<SolveResult>(`/api/solves/${hash}`),
  exportUrl: (hash: string) => `/api/solves/${hash}/export`,
};
