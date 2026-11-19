import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertPublicHttpUrl, htmlToCleanText, safeFetch } from './net.js';

export interface WatchedSite {
  id: string;
  url: string;
  label: string;
  threadId: string;
  topicId?: number;
  lastHash?: string;
  lastCheckedAt?: number;
  lastAlertAt?: number;
  createdAt: number;
}

export function cleanTextHash(html: string): string {
  const cleaned = htmlToCleanText(html)
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(cleaned, 'utf8').digest('hex');
}

export class WatchStore {
  private sites: WatchedSite[] = [];
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly filePath: string,
    private readonly onChanged?: (site: WatchedSite, preview: string) => Promise<void> | void,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly cooldownMs = 5 * 60 * 1000,
  ) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.sites = [];
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      this.sites = Array.isArray(parsed) ? (parsed as WatchedSite[]) : [];
    } catch {
      this.sites = [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${this.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.sites, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }

  async add(input: { url: string; label?: string; threadId: string; topicId?: number }): Promise<WatchedSite> {
    const validUrl = assertPublicHttpUrl(input.url).toString();
    const res = await safeFetch(validUrl, {}, this.fetchFn);
    if (!res.ok) throw new Error(`Không thể kết nối tới ${validUrl} (HTTP ${res.status})`);
    const html = await res.text();
    const hash = cleanTextHash(html);
    const site: WatchedSite = {
      id: randomBytes(3).toString('hex'),
      url: validUrl,
      label: input.label?.trim() || validUrl,
      threadId: input.threadId,
      topicId: input.topicId,
      lastHash: hash,
      lastCheckedAt: this.now(),
      createdAt: this.now(),
    };
    this.sites.push(site);
    this.save();
    return site;
  }

  list(threadId?: string): WatchedSite[] {
    return this.sites.filter((s) => !threadId || s.threadId === threadId);
  }

  remove(id: string, threadId?: string): WatchedSite | undefined {
    const idx = this.sites.findIndex((s) => s.id === id && (!threadId || s.threadId === threadId));
    if (idx === -1) return undefined;
    const [removed] = this.sites.splice(idx, 1);
    this.save();
    return removed;
  }

  async checkAll(): Promise<number> {
    let alerts = 0;
    const now = this.now();
    for (const site of this.sites) {
      try {
        const res = await safeFetch(site.url, {}, this.fetchFn);
        if (!res.ok) continue;
        const html = await res.text();
        const nextHash = cleanTextHash(html);
        site.lastCheckedAt = now;
        if (site.lastHash && site.lastHash !== nextHash) {
          site.lastHash = nextHash;
          if (!site.lastAlertAt || now - site.lastAlertAt >= this.cooldownMs) {
            site.lastAlertAt = now;
            alerts++;
            if (this.onChanged) {
              const preview = htmlToCleanText(html).slice(0, 400);
              await this.onChanged(site, preview);
            }
          }
        } else {
          site.lastHash = nextHash;
        }
      } catch {
        // Ignore transient network failures during background watch checks.
      }
    }
    this.save();
    return alerts;
  }

  start(intervalMs = 5 * 60 * 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.checkAll().catch(() => {});
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
