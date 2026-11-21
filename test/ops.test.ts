import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { SqliteDocStore, FileDocStore, docRef, importTree, migrate } from '../src/core/docstore.js';
import { Metrics } from '../src/core/metrics.js';
import { ThreadHistory } from '../src/core/storage.js';
import { ReminderStore } from '../src/core/scheduler.js';
import { validateEnv } from '../src/core/env.js';
import { createLogger } from '../src/core/logger.js';
import { parseSignedRequest, sessions, attempts } from '../src/web/auth.js';
import { registerWeb } from '../src/web/server.js';

const temp = () => mkdtempSync(join(tmpdir(), 'bk-ops-'));

describe('SQLite repository', () => {
  it('chạy migration một lần và idempotent', () => {
    const db = new SqliteDocStore(':memory:');
    expect(migrate(db.sql)).toBe(2);
    expect(migrate(db.sql)).toBe(2);
  });
  it('tự nhập file JSON cũ ở lần đọc đầu mà không xoá file', () => {
    const dir = temp();
    writeFileSync(join(dir, 'reminders.json'), JSON.stringify([{ id: 'a1', threadId: '5', senderId: '5', note: 'cũ', dueAt: 1, createdAt: 0 }]));
    const db = new SqliteDocStore(join(dir, 'bot.sqlite'), dir);
    const store = new ReminderStore({ store: db, name: 'reminders.json' });
    expect(store.list()[0]?.note).toBe('cũ');
    store.remove('a1');
    expect(new ReminderStore({ store: db, name: 'reminders.json' }).list()).toEqual([]);
    expect(new FileDocStore(dir).read('reminders.json')).toContain('cũ');
  });
  it('lời nhắc còn nguyên sau khi mở lại DB (khởi động lại)', () => {
    const dir = temp(), path = join(dir, 'bot.sqlite');
    const a = new SqliteDocStore(path);
    new ReminderStore({ store: a, name: 'reminders.json' }).add({ threadId: '9', senderId: '9', note: 'x', dueAt: 5 });
    a.close();
    expect(new ReminderStore({ store: new SqliteDocStore(path), name: 'reminders.json' }).list()).toHaveLength(1);
  });
  it('liệt kê hội thoại và importTree', () => {
    const dir = temp();
    mkdirSync(join(dir, 'threads', '42'), { recursive: true });
    writeFileSync(join(dir, 'threads', '42', 'history.jsonl'), JSON.stringify({ role: 'user', text: 'hi', at: 1 }) + '\n');
    const db = new SqliteDocStore(':memory:');
    expect(importTree(db, dir, [join(dir, 'threads', '42', 'history.jsonl')])).toBe(1);
    const h = new ThreadHistory(db, 10, 10000);
    expect(h.keys()).toEqual(['42']);
    expect(h.recent('42')[0]?.text).toBe('hi');
    expect(docRef('facts.json').name).toBe('facts.json');
  });
});

describe('Metrics', () => {
  it('tổng hợp tin nhắn, người dùng, latency, token, tool, lỗi', () => {
    const db = new SqliteDocStore(':memory:'), m = new Metrics(db.sql, 1, () => 1_700_000_000_000);
    m.record('in', 'messenger', 1, 'u1'); m.record('in', 'messenger', 1, 'u2'); m.record('in', 'messenger', 1, 'u1');
    m.record('latency', 'messenger', 100); m.record('latency', 'messenger', 300);
    m.record('tokens', 'x', 500000); m.record('tool', 'web_search'); m.record('tool', 'web_search'); m.record('error');
    const s = m.summary(1);
    expect(s).toMatchObject({ messagesIn: 3, activeUsers: 2, avgLatencyMs: 200, tokens: 500000, estimatedCostUsd: 0.5, errors: 1 });
    expect(s.topTools[0]).toEqual({ name: 'web_search', count: 2 });
  });
});

describe('Kiểm tra cấu hình', () => {
  it('báo lỗi tiếng Việt, liệt kê đủ biến thiếu, không in bí mật', () => {
    let msg = '';
    try { validateEnv({ ENABLED_CHANNELS: 'messenger', AI_API_KEY: 'k', FB_PAGE_ID: 'abc', FB_APP_SECRET: 'supersecretvalue' }); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('Cấu hình .env chưa hợp lệ');
    expect(msg).toContain('FB_PAGE_ID: sai định dạng');
    expect(msg).toContain('FB_PAGE_ACCESS_TOKEN: chưa khai báo');
    expect(msg).toContain('PUBLIC_BASE_URL');
    expect(msg).not.toContain('supersecretvalue');
  });
  it('chấp nhận cấu hình Telegram hợp lệ và bỏ qua biến tuỳ chọn để trống từ .env.example', () => {
    expect(() => validateEnv({
      AI_API_KEY: 'k', TELEGRAM_BOT_TOKEN: '123:' + 'a'.repeat(30), TELEGRAM_BOT_USERNAME: 'bk', ADMIN_TELEGRAM_IDS: '1,2',
      DASHBOARD_PASSWORD: '', AI_BASE_URL: '', STORAGE: '', LOG_LEVEL: '', PORT: '', GRAPH_API_VERSION: '',
    })).not.toThrow();
  });
});

describe('Logger', () => {
  it('ghi JSON và che bí mật', () => {
    const lines: string[] = [];
    const dest = new Writable({ write(c, _e, cb) { lines.push(String(c)); cb(); } });
    const { log, logger } = createLogger(['my-very-secret-token'], { destination: dest });
    log('lỗi gọi API với my-very-secret-token');
    logger.info({ token: 'my-very-secret-token' }, 'obj');
    const a = JSON.parse(lines[0]!), b = JSON.parse(lines[1]!);
    expect(a.level).toBe(50);
    expect(a.msg).not.toContain('my-very-secret-token');
    expect(b.token).toBe('[ĐÃ ẨN]');
  });
});

const signed = (payload: object, secret: string) => {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return createHmac('sha256', secret).update(p).digest('base64url') + '.' + p;
};

describe('Xác thực', () => {
  it('phiên cookie hết hạn và chống giả mạo', () => {
    let now = 1000; const s = sessions('k', 100, () => now);
    const tok = s.issue();
    expect(s.valid(tok)).toBe(true);
    expect(s.valid(tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A'))).toBe(false);
    now = 2000; expect(s.valid(tok)).toBe(false);
  });
  it('khoá IP sau 5 lần sai', () => {
    const a = attempts(); for (let i = 0; i < 5; i++) a.fail('1.1.1.1');
    expect(a.blocked('1.1.1.1')).toBe(true); expect(a.blocked('2.2.2.2')).toBe(false);
  });
  it('signed_request của Meta', () => {
    const r = signed({ algorithm: 'HMAC-SHA256', user_id: '77' }, 'sec');
    expect(parseSignedRequest(r, 'sec')?.user_id).toBe('77');
    expect(parseSignedRequest(r, 'other')).toBeNull();
  });
});

describe('Web: dashboard, privacy, data deletion', () => {
  function fake() {
    const db = new SqliteDocStore(':memory:');
    const history = new ThreadHistory(db, 10, 10000);
    history.append('123', { role: 'user', text: 'xin chào', at: 5 });
    const paused = new Map<string, boolean>();
    const sent: string[] = [];
    const brain = {
      history, metrics: new Metrics(db.sql),
      settings: { get: (id: string) => ({ paused: paused.get(id) ?? false, mode: 'all' }), set: (id: string, c: { paused: boolean }) => paused.set(id, c.paused) },
      facts: { search: () => [], tombstone: () => {} }, reminders: { list: () => [], remove: () => undefined }, watches: { list: () => [], remove: () => undefined },
    };
    const adapter = { channel: 'telegram', split: (s: string) => [s], notify: async (_id: string, t: string) => { sent.push(t); } };
    const app = Fastify();
    registerWeb(app, { brains: [{ adapter, brain }] as never, password: 'mat-khau-rat-dai', secret: 's',
      privacy: { owner: 'Shop <A>', contact: 'c' }, log: () => {}, appSecret: 'sec' });
    return { app, sent, paused };
  }
  it('chặn API khi chưa đăng nhập, cho phép sau đăng nhập', async () => {
    const { app, sent, paused } = fake();
    expect((await app.inject({ url: '/dashboard/api/conversations', headers: { 'x-bekane': '1' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/dashboard/login', payload: { password: 'sai' } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/dashboard/login', payload: { password: 'mat-khau-rat-dai' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    // Thiếu header x-bekane (chống CSRF) → vẫn bị chặn.
    expect((await app.inject({ url: '/dashboard/api/conversations', headers: { cookie } })).statusCode).toBe(401);
    const h = { cookie, 'x-bekane': '1' };
    const list = (await app.inject({ url: '/dashboard/api/conversations', headers: h })).json();
    expect(list[0]).toMatchObject({ channel: 'telegram', id: '123', preview: 'xin chào' });
    await app.inject({ method: 'POST', url: '/dashboard/api/conversations/telegram/123/reply', headers: h, payload: { text: 'Chào bạn' } });
    expect(sent).toEqual(['Chào bạn']);
    await app.inject({ method: 'POST', url: '/dashboard/api/conversations/telegram/123/pause', headers: h, payload: { paused: true } });
    expect(paused.get('123')).toBe(true);
    expect((await app.inject({ url: '/dashboard/api/stats', headers: h })).json().telegram.messagesIn).toBe(0);
  });
  it('privacy escape HTML; data deletion kiểm chữ ký', async () => {
    const { app } = fake();
    expect((await app.inject({ url: '/privacy' })).body).toContain('Shop &lt;A&gt;');
    const form = { 'content-type': 'application/x-www-form-urlencoded' };
    expect((await app.inject({ method: 'POST', url: '/data-deletion', headers: form, payload: 'signed_request=abc.def' })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/data-deletion', headers: form,
      payload: 'signed_request=' + encodeURIComponent(signed({ algorithm: 'HMAC-SHA256', user_id: '9' }, 'sec')) });
    expect(ok.json().confirmation_code).toMatch(/^[a-f0-9]{16}$/);
  });
});
