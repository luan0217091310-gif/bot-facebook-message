import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { createBrain } from '../brain.js';
import type { ChannelAdapter } from '../channel.js';
import type { Messenger } from '../adapters/messenger/adapter.js';
import { inWindow } from '../adapters/messenger/adapter.js';
import type { PageServices } from '../services/page.js';
import { attempts, confirmationCode, parseSignedRequest, safeEqual, sessions } from './auth.js';
import { dashboardHtml, privacyHtml } from './pages.js';

type Brain = ReturnType<typeof createBrain>;
export interface WebContext {
  brains: Array<{ adapter: ChannelAdapter; brain: Brain }>;
  page?: { messenger: Messenger; services: PageServices };
  password?: string;
  secret: string;
  publicBaseUrl?: string;
  appSecret?: string;
  /** Cho phép gửi bằng tag HUMAN_AGENT (7 ngày) khi Meta đã cấp quyền cho app. */
  humanAgent?: boolean;
  privacy: { owner: string; contact: string };
  log: (s: string) => void;
}

const COOKIE = 'bk_session';
const cookieOf = (req: FastifyRequest) =>
  (req.headers.cookie ?? '').split(';').map((s) => s.trim().split('=')).find(([k]) => k === COOKIE)?.[1];

/** Đăng ký /privacy, /data-deletion và /dashboard lên một Fastify (dùng chung server webhook Messenger nếu có). */
export function registerWeb(app: FastifyInstance, ctx: WebContext): void {
  const auth = sessions(ctx.secret);
  const tries = attempts();
  const secure = (ctx.publicBaseUrl ?? '').startsWith('https://');
  const brainOf = (channel: string) => ctx.brains.find((b) => b.adapter.channel === channel);

  app.get('/privacy', (_req, res) => res.type('text/html; charset=utf-8').send(privacyHtml(ctx.privacy)));

  // ===== Data Deletion Callback (Meta yêu cầu khi App Review) =====
  // Meta gửi user_id là ID theo app (ASID), KHÁC với PSID. Ta xoá nếu trùng một hội thoại đã biết,
  // và luôn ghi yêu cầu + báo admin để xử lý thủ công nếu không ánh xạ được. Người dùng cũng có thể gõ /delete trong chat.
  app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' },
      (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
    scope.post('/data-deletion', async (req, res) => {
      const signed = (req.body as Record<string, string> | undefined)?.signed_request;
      const data = signed && ctx.appSecret ? parseSignedRequest(signed, ctx.appSecret) : null;
      if (!data) return res.code(400).send({ error: 'invalid signed_request' });
      const code = confirmationCode();
      const page = ctx.page;
      let erased = false;
      if (page && page.messenger.db.get(data.user_id, 'last') !== undefined) { page.services.erase(data.user_id); erased = true; }
      page?.messenger.db.set('deletion', code, { at: Date.now(), erased, user: data.user_id });
      ctx.log(`Yêu cầu xoá dữ liệu từ Meta (mã ${code}), ${erased ? 'đã xoá tự động' : 'cần admin kiểm tra thủ công'}`);
      return { url: `${ctx.publicBaseUrl ?? ''}/data-deletion?code=${code}`, confirmation_code: code };
    });
  });
  app.get<{ Querystring: { code?: string } }>('/data-deletion', (req, res) => {
    const code = String(req.query.code ?? '').replace(/[^a-f0-9]/g, '');
    const rec = code ? ctx.page?.messenger.db.get<{ at: number; erased: boolean }>('deletion', code) : undefined;
    const msg = !rec ? 'Không tìm thấy yêu cầu với mã này.'
      : rec.erased ? 'Dữ liệu của bạn đã được xoá.' : 'Yêu cầu đã được ghi nhận và sẽ được xử lý trong vòng 30 ngày.';
    return res.type('text/html; charset=utf-8').send(`<!doctype html><meta charset="utf-8"><title>Xoá dữ liệu</title><p>Mã: ${code || '—'}</p><p>${msg}</p>`);
  });

  if (!ctx.password) return; // Không có DASHBOARD_PASSWORD → không bật dashboard.
  const password = ctx.password;

  app.get('/dashboard', (_req, res) => res.type('text/html; charset=utf-8')
    .header('content-security-policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'")
    .send(dashboardHtml()));
  app.post<{ Body: { password?: string } }>('/dashboard/login', (req, res) => {
    if (tries.blocked(req.ip)) return res.code(429).send({ error: 'Thử lại sau 1 phút.' });
    if (typeof req.body?.password !== 'string' || !safeEqual(req.body.password, password)) {
      tries.fail(req.ip); return res.code(401).send({ error: 'Sai mật khẩu.' });
    }
    res.header('set-cookie', `${COOKIE}=${auth.issue()}; HttpOnly; SameSite=Strict; Path=/dashboard${secure ? '; Secure' : ''}; Max-Age=43200`);
    return { ok: true };
  });
  app.post('/dashboard/logout', (_req, res) =>
    res.header('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/dashboard; Max-Age=0`).send({ ok: true }));

  app.register(async (api) => {
    // Mọi API cần cookie hợp lệ + header tuỳ chỉnh (chặn CSRF vì trình duyệt không tự gửi header này từ site khác).
    api.addHook('onRequest', async (req: FastifyRequest, res: FastifyReply) => {
      if (!auth.valid(cookieOf(req)) || req.headers['x-bekane'] !== '1') return res.code(401).send({ error: 'Chưa đăng nhập.' });
    });
    const need = (channel: string) => { const b = brainOf(channel); if (!b) throw Object.assign(new Error('Kênh chưa bật.'), { statusCode: 404 }); return b; };
    const idOk = (id: string) => /^-?\d+(?:_\d+)?$/.test(id);

    api.get<{ Querystring: { days?: string } }>('/stats', (req) => {
      const days = Math.min(90, Math.max(1, Number(req.query.days ?? 7) || 7));
      return Object.fromEntries(ctx.brains.map((b) => [b.adapter.channel, b.brain.metrics?.summary(days) ?? null]));
    });
    api.get('/conversations', () => ctx.brains.flatMap(({ adapter, brain }) => brain.history.keys().flatMap((id) => {
      const last = brain.history.recent(id).at(-1);
      if (!last) return [];
      const db = adapter.channel === 'messenger' ? ctx.page?.messenger.db : undefined;
      return [{ channel: adapter.channel, id, lastAt: last.at, preview: last.text.slice(0, 120),
        paused: brain.settings.get(id.split('_')[0]!).paused, handoff: (db?.get<number>(id, 'handoff') ?? 0) > Date.now() }];
    })).sort((a, b) => b.lastAt - a.lastAt).slice(0, 500));

    api.get<{ Params: { channel: string; id: string } }>('/conversations/:channel/:id', (req, res) => {
      const { channel, id } = req.params; if (!idOk(id)) return res.code(400).send({ error: 'ID sai.' });
      const { brain } = need(channel);
      const thread = id.split('_')[0]!;
      const db = channel === 'messenger' ? ctx.page?.messenger.db : undefined;
      return { channel, id, history: brain.history.recent(id), paused: brain.settings.get(thread).paused,
        handoffUntil: db?.get<number>(id, 'handoff') ?? 0, lastUserAt: db?.get<number>(id, 'last') ?? null,
        facts: brain.facts.search({ threadId: thread, senderId: thread, isGroup: thread.startsWith('-') }, 500),
        reminders: brain.reminders.list(thread), watches: brain.watches.list(thread) };
    });

    // Admin trả lời trực tiếp. Messenger: trong 24h gửi RESPONSE; ngoài 24h chỉ gửi bằng tag HUMAN_AGENT
    // khi app đã được Meta cấp quyền (FB_HUMAN_AGENT_ENABLED=true) và còn trong 7 ngày. Không lách chính sách.
    api.post<{ Params: { channel: string; id: string }; Body: { text?: string } }>('/conversations/:channel/:id/reply', async (req, res) => {
      const { channel, id } = req.params; const text = String(req.body?.text ?? '').trim();
      if (!idOk(id) || !text || text.length > 4000) return res.code(400).send({ error: 'Nội dung trống hoặc quá dài.' });
      const { adapter, brain } = need(channel);
      if (channel === 'messenger' && ctx.page) {
        const m = ctx.page.messenger, last = m.db.get<number>(id, 'last');
        if (inWindow(last)) await m.text(id, text);
        else if (ctx.humanAgent && inWindow(last, Date.now(), 7 * 86400000)) {
          for (const part of adapter.split(text)) await m.graph.send({ recipient: { id }, messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT', message: { text: part } });
        } else return res.code(409).send({ error: 'Ngoài cửa sổ 24 giờ (và không có quyền HUMAN_AGENT). Chờ khách nhắn lại.' });
      } else {
        const [thread, topic] = id.split('_');
        await adapter.notify(thread!, text, topic ? Number(topic) : undefined);
      }
      brain.history.append(id, { role: 'assistant', text, at: Date.now(), senderName: 'admin' });
      return { ok: true };
    });
    api.post<{ Params: { channel: string; id: string }; Body: { paused?: boolean } }>('/conversations/:channel/:id/pause', (req, res) => {
      const { channel, id } = req.params; if (!idOk(id)) return res.code(400).send({ error: 'ID sai.' });
      need(channel).brain.settings.set(id.split('_')[0]!, { paused: Boolean(req.body?.paused) });
      return { ok: true };
    });
    api.post<{ Params: { id: string }; Body: { minutes?: number } }>('/conversations/messenger/:id/handoff', (req, res) => {
      const { id } = req.params; if (!idOk(id) || !ctx.page) return res.code(400).send({ error: 'Không áp dụng.' });
      const minutes = Number(req.body?.minutes ?? 0);
      if (minutes > 0) ctx.page.messenger.db.set(id, 'handoff', Date.now() + Math.min(minutes, 10080) * 60000);
      else ctx.page.messenger.db.remove(id, 'handoff');
      return { ok: true };
    });
    api.delete<{ Params: { channel: string; kind: string; item: string } }>('/items/:channel/:kind/:item', (req, res) => {
      const { brain } = need(req.params.channel); const item = req.params.item;
      if (req.params.kind === 'fact') brain.facts.tombstone(item, 'Xoá từ dashboard');
      else if (req.params.kind === 'reminder') { if (!brain.reminders.remove(item)) return res.code(404).send({ error: 'Không thấy.' }); }
      else if (req.params.kind === 'watch') { if (!brain.watches.remove(item)) return res.code(404).send({ error: 'Không thấy.' }); }
      else return res.code(400).send({ error: 'Loại sai.' });
      return { ok: true };
    });

    // ===== Kho kiến thức (chỉ Messenger/Page) =====
    api.get('/kb', () => ctx.page ? ctx.page.messenger.db.sql
      .prepare('SELECT source, count(*) AS passages FROM knowledge GROUP BY source ORDER BY source').all() : []);
    api.post<{ Body: { source?: string; body?: string } }>('/kb', (req, res) => {
      if (!ctx.page) return res.code(404).send({ error: 'Chưa bật Messenger.' });
      try { ctx.page.services.kb.put(String(req.body?.source ?? '').slice(0, 200), String(req.body?.body ?? '')); }
      catch (e) { return res.code(400).send({ error: (e as Error).message }); }
      return { ok: true };
    });
    api.delete<{ Params: { source: string } }>('/kb/:source', (req, res) => {
      if (!ctx.page) return res.code(404).send({ error: 'Chưa bật Messenger.' });
      ctx.page.messenger.db.sql.prepare('DELETE FROM knowledge WHERE source=?').run(req.params.source);
      return { ok: true };
    });
  }, { prefix: '/dashboard/api' });
}

/** Khi chỉ chạy Telegram vẫn cần server cho /health và dashboard. */
export async function startStandaloneWeb(ctx: WebContext, port: number): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 2 * 1024 * 1024, logger: false, trustProxy: true });
  app.get('/health', () => ({ ok: true, channels: ctx.brains.map((b) => b.adapter.channel) }));
  registerWeb(app, ctx);
  await app.listen({ port, host: '0.0.0.0' });
  return app;
}
