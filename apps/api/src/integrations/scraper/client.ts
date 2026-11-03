import { requestJson } from '../../lib/http.ts';

export type ScraperJobStatus = 'pending' | 'working' | 'ok' | 'failed';

export interface ScraperJob {
  id: string;
  status: ScraperJobStatus;
  createdAt: string;
}

export interface CreateScraperJob {
  name: string;
  query: string;
  lang: string;
  depth: number;
  maxTimeSeconds: number;
}

export interface ScraperClient {
  createJob(input: CreateScraperJob): Promise<string>;
  getJob(id: string): Promise<ScraperJob | null>;
  downloadCsv(id: string): Promise<string | null>;
  deleteJob(id: string): Promise<void>;
  ping(): Promise<{ ok: boolean; detail: string }>;
}

export function createScraperClient(baseUrl: string, timeoutMs: number): ScraperClient {
  const url = (p: string) => `${baseUrl.replace(/\/$/, '')}${p}`;
  return {
    async createJob(input) {
      const body = {
        Name: input.name.slice(0, 120),
        keywords: [input.query],
        lang: input.lang,
        depth: input.depth,
        max_time: input.maxTimeSeconds,
        email: false,
        fast_mode: false,
        extra_reviews: false,
      };
      const res = await requestJson<{ id: string }>(url('/api/v1/jobs'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs,
      });
      if (!res?.id) throw new Error('Scraper não retornou id do job');
      return res.id;
    },
    async getJob(id) {
      try {
        const res = await requestJson<{ ID: string; Status: ScraperJobStatus; Date: string }>(url(`/api/v1/jobs/${encodeURIComponent(id)}`), {
          method: 'GET',
          timeoutMs,
        });
        return { id: res.ID, status: res.Status, createdAt: res.Date };
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    async downloadCsv(id) {
      try {
        return await requestJson<string>(url(`/api/v1/jobs/${encodeURIComponent(id)}/download`), {
          method: 'GET',
          timeoutMs: timeoutMs * 3,
          expectText: true,
        });
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    async deleteJob(id) {
      try {
        await requestJson(url(`/api/v1/jobs/${encodeURIComponent(id)}`), { method: 'DELETE', timeoutMs });
      } catch (err) {
        if ((err as { status?: number }).status === 404) return;
        throw err;
      }
    },
    async ping() {
      try {
        await requestJson(url('/api/v1/jobs'), { method: 'GET', timeoutMs: 5000 });
        return { ok: true, detail: 'API de jobs respondeu' };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    },
  };
}
