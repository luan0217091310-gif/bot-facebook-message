import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { assertPublicHttpUrl } from '../src/core/net.js';
import { ReminderStore } from '../src/core/scheduler.js';
import { WatchStore } from '../src/core/watches.js';
import { createWebSearchTool } from '../src/tools/web.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('Web Search, SSRF, Reminders & Website Watcher', () => {
  it('blocks private and localhost URLs against SSRF', () => {
    expect(() => assertPublicHttpUrl('http://localhost:8080/admin')).toThrow(/SSRF/);
    expect(() => assertPublicHttpUrl('http://127.0.0.1/secret')).toThrow(/SSRF/);
    expect(() => assertPublicHttpUrl('http://192.168.1.1/router')).toThrow(/SSRF/);
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(/http/);
    expect(assertPublicHttpUrl('https://example.com/news').hostname).toBe('example.com');
  });

  it('caches Tavily web search queries for 10 minutes', async () => {
    let now = 1000;
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({
      results: [{ title: 'Giá vàng', url: 'https://example.com', raw_content: 'SJC 90 triệu' }],
    }), { status: 200 }));
    const tool = createWebSearchTool('tvly-key', fakeFetch as unknown as typeof fetch, () => now);
    const ctx = { threadId: '1', senderId: '1', isAdmin: true, isGroup: false };

    const r1 = await tool.run({ query: 'Giá  Vàng' }, ctx);
    const r2 = await tool.run({ query: 'giá vàng' }, ctx);
    expect(r1).toContain('SJC 90 triệu');
    expect(r2).toBe(r1);
    expect(fakeFetch).toHaveBeenCalledOnce();

    now += 10 * 60 * 1000 + 5;
    await tool.run({ query: 'giá vàng' }, ctx);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('fires due reminders and persists state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bekane-rem-'));
    dirs.push(dir);
    let now = 10_000;
    const fired: string[] = [];
    const store = new ReminderStore(join(dir, 'reminders.json'), (r) => { fired.push(r.note); }, () => now);
    store.add({ threadId: '-100', senderId: '6864517458', note: 'Uống nước', dueAt: 20_000 });
    expect(await store.tick()).toBe(0);
    now = 25_000;
    expect(await store.tick()).toBe(1);
    expect(fired).toEqual(['Uống nước']);
    expect(store.list()).toEqual([]);
  });

  it('detects clean text changes on watched websites while ignoring dynamic timestamps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bekane-watch-'));
    dirs.push(dir);
    let now = 100_000;
    let pageHtml = '<html><body><h1>Thông báo</h1><p>10:20:30 - Chưa có tin mới</p></body></html>';
    const alerts: string[] = [];
    const fakeFetch = vi.fn(async () => new Response(pageHtml, { status: 200 }));
    const store = new WatchStore(
      join(dir, 'watches.json'),
      (site, preview) => { alerts.push(`${site.label}:${preview}`); },
      fakeFetch as unknown as typeof fetch,
      () => now,
      60_000,
    );

    await store.add({ url: 'https://example.com', label: 'Trang chủ', threadId: '-100' });
    // Timestamp changes but visible text is identical -> 0 alerts
    pageHtml = '<html><body><h1>Thông báo</h1><p>10:25:59 - Chưa có tin mới</p></body></html>';
    expect(await store.checkAll()).toBe(0);
    expect(alerts).toHaveLength(0);

    // Real content changes -> 1 alert
    now += 70_000;
    pageHtml = '<html><body><h1>Thông báo</h1><p>Đã có điểm thi học kỳ!</p></body></html>';
    expect(await store.checkAll()).toBe(1);
    expect(alerts[0]).toContain('Đã có điểm thi học kỳ!');
  });
});
