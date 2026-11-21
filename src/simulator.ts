import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { toFile } from 'openai';
import { createBrain } from './brain.js';
import type { Choice } from './channel.js';
import { createMessenger, DAY } from './adapters/messenger/adapter.js';
import { messengerConfig, pageBrainConfig } from './adapters/messenger/config.js';
import { Graph } from './adapters/messenger/graph.js';
import { notifications } from './adapters/messenger/notifications.js';
import { redact } from './core/redact.js';
import { Repository } from './repository.js';
import { pageServices } from './services/page.js';

export interface SimOutgoing {
  kind: 'text' | 'action' | 'comment' | 'private_reply' | 'otn_request' | 'template' | 'alert' | 'telegram';
  recipient: string;
  text?: string;
  action?: string;
  quickReplies?: Choice[];
  raw?: Record<string, unknown>;
}

export interface SimulatorOptions {
  pageId?: string;
  psid?: string;
  adminPsids?: string[];
  dbPath?: string;
  dataDir?: string;
  aiApiKey?: string;
  aiBaseUrl?: string;
  aiModel?: string;
  mockAi?: boolean;
  comments?: boolean;
  otn?: boolean;
  telegramFallback?: (psid: string, text: string) => Promise<boolean>;
  alert?: (text: string) => Promise<void>;
}

function startMockAiServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      if (req.url?.includes('/audio/transcriptions')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ text: 'Xin chào Bekane từ tin nhắn thoại giả lập' }));
        return;
      }
      let body: { messages?: Array<{ role: string; content: unknown }> } = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
      } catch {
        // Bỏ qua nếu body không phải JSON.
      }
      const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
      let promptText = '';
      if (typeof lastUser?.content === 'string') {
        try {
          const parsed = JSON.parse(lastUser.content) as { text?: string; question?: string };
          promptText = parsed.text ?? parsed.question ?? lastUser.content;
        } catch {
          promptText = lastUser.content;
        }
      } else if (Array.isArray(lastUser?.content)) {
        const textPart = lastUser.content.find((p): p is { type: string; text?: string } => typeof p === 'object' && p !== null && 'text' in p);
        promptText = textPart?.text ?? '[Hình ảnh]';
      }
      const en = /\b(hello|hi|help|price|summary|summarize|how|what|book|english)\b/i.test(promptText)
        && !/[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/i.test(promptText);
      const reply = en
        ? `[Local Mock AI] Received: "${promptText.slice(0, 120)}". Try /book, /faq, /lang vi, /data, /human or send a file.`
        : `[Mock AI cục bộ] Đã nhận: "${promptText.slice(0, 120)}". Bạn có thể thử /book, /faq, /lang en, /data, /human hoặc gửi tệp.`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'sim-chat',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'mock-ai',
          choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 },
        }),
      );
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('Không mở được mock AI server'));
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

function guessMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.wav') return 'audio/wav';
  return 'text/plain';
}

/** Tạo phiên giả lập Messenger đầy đủ luồng webhook -> chữ ký -> inbox -> brain -> Graph mock. */
export async function createSimulatorSession(opts: SimulatorOptions = {}) {
  const pageId = opts.pageId ?? '100000000001';
  let currentPsid = opts.psid ?? '200000000001';
  const adminPsids = opts.adminPsids ?? ['200000000999'];
  const appSecret = 'sim-app-secret';
  const verifyToken = 'sim-verify-token';
  const tempDataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'bekane-sim-'));
  const ownsDataDir = !opts.dataDir;
  const usingMockAi = opts.mockAi ?? !opts.aiApiKey;
  const mockAi = usingMockAi ? await startMockAiServer() : undefined;

  const cfg = messengerConfig({
    FB_PAGE_ID: pageId,
    FB_PAGE_ACCESS_TOKEN: 'sim-page-token',
    FB_APP_SECRET: appSecret,
    FB_VERIFY_TOKEN: verifyToken,
    ADMIN_PSIDS: adminPsids.join(','),
    PUBLIC_BASE_URL: 'https://sim.local',
    PORT: '3000',
  });
  const brainCfg = pageBrainConfig(
    {
      AI_API_KEY: opts.aiApiKey || 'sim-mock-key',
      AI_BASE_URL: mockAi?.url ?? opts.aiBaseUrl ?? 'https://api.openai.com/v1',
      AI_MODEL: opts.aiModel ?? 'gpt-4o-mini',
      DATA_DIR: tempDataDir,
    },
    cfg,
  );

  const db = new Repository(opts.dbPath ?? ':memory:');
  const outgoing: SimOutgoing[] = [];
  let seq = 0;
  const localFiles = new Map<string, { name: string; mime: string; bytes: Buffer<ArrayBuffer> }>();
  const clean = (s: string) => redact(s, [appSecret, verifyToken, brainCfg.aiApiKey]);
  const log = (_s: string) => {};

  const graph = new Graph(cfg, async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url.includes('/comments')) {
      outgoing.push({ kind: 'comment', recipient: url, text: String(body.message ?? ''), raw: body });
      return Response.json({ id: `${++seq}_reply` });
    }
    const rec = (body.recipient ?? {}) as { id?: string; comment_id?: string; one_time_notif_token?: string };
    const recipient = rec.id ?? rec.comment_id ?? rec.one_time_notif_token ?? 'unknown';
    if (typeof body.sender_action === 'string') {
      outgoing.push({ kind: 'action', recipient, action: body.sender_action, raw: body });
      return Response.json({ recipient_id: recipient });
    }
    const message = (body.message ?? {}) as {
      text?: string;
      quick_replies?: Array<{ title: string; payload: string }>;
      attachment?: { type?: string; payload?: { template_type?: string; text?: string; title?: string } };
    };
    const quickReplies = message.quick_replies?.map((q) => ({ title: q.title, payload: q.payload }));
    if (rec.comment_id) {
      outgoing.push({ kind: 'private_reply', recipient: rec.comment_id, text: message.text, quickReplies, raw: body });
    } else if (message.attachment?.payload?.template_type === 'one_time_notif_req') {
      outgoing.push({ kind: 'otn_request', recipient, text: message.attachment.payload.title ?? message.attachment.payload.text, raw: body });
    } else if (message.attachment?.type === 'template') {
      outgoing.push({ kind: 'template', recipient, raw: body });
    } else {
      outgoing.push({ kind: 'text', recipient, text: message.text, quickReplies, raw: body });
    }
    return Response.json({ message_id: 'sim_mid_' + ++seq });
  });

  const messenger = createMessenger(graph, db, log);
  const notices = notifications(messenger, {
    otn: opts.otn ?? true,
    log,
    fallback: async (id, text) => {
      if (opts.telegramFallback) return opts.telegramFallback(id, text);
      const tg = db.get<string>(id, 'telegram');
      if (!tg) return false;
      outgoing.push({ kind: 'telegram', recipient: tg, text: '📩 [Messenger] ' + text });
      return true;
    },
  });
  Object.assign(messenger.adapter, {
    notify: notices.notify,
    plan: notices.plan,
    downloadImage: async (a: { fileId: string }) => {
      const f = localFiles.get(a.fileId);
      if (!f || !/^image\/(png|jpe?g|gif|webp)$/.test(f.mime)) return null;
      return `data:${f.mime};base64,${f.bytes.toString('base64')}`;
    },
  });

  const brain = createBrain(brainCfg, messenger.adapter, clean, log);
  const services = pageServices(messenger, brain, {
    linked: true,
    rate: brainCfg.userMessagesPerMinute,
    handoffMinutes: 60,
    comments: opts.comments ?? true,
    clean,
    log,
    download: async (fileId: string) => {
      const f = localFiles.get(fileId);
      if (!f) throw new Error('Không tìm thấy tệp giả lập: ' + fileId);
      return f;
    },
    alert: async (s) => {
      if (opts.alert) return opts.alert(s);
      outgoing.push({ kind: 'alert', recipient: 'staff', text: s });
    },
    transcribe: async (bytes, mime, name) => {
      const file = await toFile(bytes, name, { type: mime });
      const r = await brain.client.audio.transcriptions.create({ file, model: 'whisper-1' });
      return r.text;
    },
    summarize: async (question, document, en) => {
      const r = await brain.client.chat.completions.create({
        model: brainCfg.aiModel,
        max_completion_tokens: brainCfg.maxOutputTokens,
        messages: [
          { role: 'system', content: 'Answer in ' + (en ? 'English' : 'Vietnamese') + ' using only the document.' },
          { role: 'user', content: JSON.stringify({ question, document: document.slice(0, 65000) }) },
        ],
      });
      return clean(r.choices[0]?.message.content ?? '');
    },
  });

  messenger.suggestions((msg, reply) => {
    if (msg.text.startsWith('/')) return undefined;
    const en = db.get<string>(msg.senderId, 'language') === 'en';
    return services.suggest(en, { text: msg.text, reply, hasDocument: Boolean(db.get(msg.senderId, 'document')) });
  });
  messenger.after(async (msg) => {
    const last = brain.history.recent(msg.threadId).at(-1);
    if (last?.role === 'assistant' && last.replyTo === msg.msgId && /không (đủ thông tin|chắc chắn)|i (don't know|am unsure)/i.test(last.text)) {
      await services.handoff(msg.threadId, db.get(msg.threadId, 'language') === 'en');
    }
  });
  messenger.use(async (e) => {
    if (e.kind === 'optin') {
      notices.accept(e);
      return true;
    }
    if (e.kind === 'chat') await notices.flush(e.user);
    return services.handle(e);
  });
  messenger.bind(async (msg) => {
    await brain.dispatcher.handle(msg);
  });

  async function waitIdle(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      messenger.pump();
      const row = db.sql
        .prepare('SELECT count(*) AS n FROM inbox WHERE body IS NOT NULL AND available<=?')
        .get(Date.now()) as { n: number };
      if (row.n === 0) {
        await new Promise((r) => setTimeout(r, 20));
        const again = db.sql
          .prepare('SELECT count(*) AS n FROM inbox WHERE body IS NOT NULL AND available<=?')
          .get(Date.now()) as { n: number };
        if (again.n === 0) return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('Hết thời gian chờ xử lý trong trình giả lập.');
  }

  async function postWebhook(payload: unknown): Promise<SimOutgoing[]> {
    const start = outgoing.length;
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = createHmac('sha256', appSecret).update(raw).digest('hex');
    const res = await messenger.app.inject({
      method: 'POST',
      url: '/webhooks/messenger',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + sig },
      payload: raw,
    });
    if (res.statusCode !== 200) throw new Error('Webhook giả lập trả lỗi ' + res.statusCode);
    await waitIdle();
    return outgoing.slice(start);
  }

  function nextMsgId() {
    return 'sim_in_' + ++seq + '_' + Date.now();
  }

  return {
    pageId,
    adminPsids,
    usingMockAi,
    db,
    brain,
    services,
    messenger,
    notices,
    outgoing,
    get psid() {
      return currentPsid;
    },
    setUser(psid: string) {
      if (!/^\d+$/.test(psid)) throw new Error('PSID phải là chuỗi số.');
      currentPsid = psid;
    },
    async sendText(text: string, quickReplyPayload?: string) {
      return postWebhook({
        object: 'page',
        entry: [{
          id: pageId,
          messaging: [{
            sender: { id: currentPsid },
            recipient: { id: pageId },
            timestamp: Date.now(),
            message: {
              mid: nextMsgId(),
              text,
              ...(quickReplyPayload ? { quick_reply: { payload: quickReplyPayload } } : {}),
            },
          }],
        }],
      });
    },
    async sendPostback(payload: string) {
      return postWebhook({
        object: 'page',
        entry: [{
          id: pageId,
          messaging: [{
            sender: { id: currentPsid },
            recipient: { id: pageId },
            timestamp: Date.now(),
            postback: { mid: nextMsgId(), payload },
          }],
        }],
      });
    },
    async sendComment(message: string, commentId = `${pageId}_${++seq}`) {
      return postWebhook({
        object: 'page',
        entry: [{
          id: pageId,
          changes: [{
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              comment_id: commentId,
              from: { id: currentPsid },
              created_time: Math.floor(Date.now() / 1000),
              message,
            },
          }],
        }],
      });
    },
    async sendLocalFile(filePath: string, caption = '') {
      const bytes = Buffer.concat([readFileSync(filePath)]);
      const mime = guessMime(filePath);
      const name = basename(filePath);
      const fileId = `https://cdn.fbsbx.com/sim/${++seq}/${encodeURIComponent(name)}`;
      localFiles.set(fileId, { name, mime, bytes });
      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'file';
      return postWebhook({
        object: 'page',
        entry: [{
          id: pageId,
          messaging: [{
            sender: { id: currentPsid },
            recipient: { id: pageId },
            timestamp: Date.now(),
            message: {
              mid: nextMsgId(),
              ...(caption ? { text: caption } : {}),
              attachments: [{ type: kind, payload: { url: fileId } }],
            },
          }],
        }],
      });
    },
    advanceHours(hours: number) {
      const last = db.get<number>(currentPsid, 'last');
      if (last === undefined) return false;
      db.set(currentPsid, 'last', last - hours * 3600000);
      return true;
    },
    addFaq(source: string, body: string) {
      services.kb.put(source, body);
    },
    async triggerNotice(text: string, job = 'sim_notice') {
      const start = outgoing.length;
      await notices.notify(currentPsid, text, undefined, job);
      return outgoing.slice(start);
    },
    isIn24hWindow() {
      return Date.now() - (db.get<number>(currentPsid, 'last') ?? 0) < DAY;
    },
    async close() {
      await messenger.adapter.close();
      await brain.close();
      db.close();
      await mockAi?.close();
      if (ownsDataDir) rmSync(tempDataDir, { recursive: true, force: true });
    },
  };
}

function renderEvents(events: SimOutgoing[], lastChoices: { value: Choice[] }) {
  for (const ev of events) {
    if (ev.kind === 'action') continue;
    if (ev.kind === 'text') {
      console.log(`\n🤖 [Bot -> ${ev.recipient}]\n${ev.text ?? ''}`);
      if (ev.quickReplies?.length) {
        lastChoices.value = ev.quickReplies;
        console.log('   Gợi ý nhanh: ' + ev.quickReplies.map((q, i) => `[${i + 1}] ${q.title} (${q.payload})`).join('  '));
      }
    } else if (ev.kind === 'comment') {
      console.log(`\n💬 [Trả lời bình luận công khai]: ${ev.text ?? ''}`);
    } else if (ev.kind === 'private_reply') {
      console.log(`\n📩 [Private Reply -> comment ${ev.recipient}]: ${ev.text ?? ''}`);
      if (ev.quickReplies?.length) {
        lastChoices.value = ev.quickReplies;
        console.log('   Gợi ý nhanh: ' + ev.quickReplies.map((q, i) => `[${i + 1}] ${q.title}`).join('  '));
      }
    } else if (ev.kind === 'otn_request') {
      console.log(`\n🔔 [Yêu cầu OTN -> ${ev.recipient}]: ${ev.text ?? ''}`);
    } else if (ev.kind === 'alert') {
      console.log(`\n🚨 [Cảnh báo nhân viên]: ${ev.text ?? ''}`);
    } else if (ev.kind === 'telegram') {
      console.log(`\n✈️  [Chuyển tiếp Telegram -> ${ev.recipient}]: ${ev.text ?? ''}`);
    }
  }
}

async function runCli() {
  const args = process.argv.slice(2);
  const mockAi = args.includes('--mock-ai') || !process.env.AI_API_KEY?.trim();
  const session = await createSimulatorSession({
    aiApiKey: process.env.AI_API_KEY,
    aiBaseUrl: process.env.AI_BASE_URL,
    aiModel: process.env.AI_MODEL,
    mockAi,
    adminPsids: (process.env.ADMIN_PSIDS ?? '200000000999').split(',').map((s) => s.trim()).filter(Boolean),
  });

  console.log('=== TRÌNH GIẢ LẬP MESSENGER CỤC BỘ (KHÔNG CẦN FACEBOOK PAGE) ===');
  console.log(`AI: ${session.usingMockAi ? 'Mock AI cục bộ (không cần API key)' : process.env.AI_MODEL ?? 'gpt-4o-mini'}`);
  console.log(`PSID hiện tại: ${session.psid} | Admin PSID: ${session.adminPsids.join(', ')}`);
  console.log('Gõ tin nhắn hoặc lệnh bot (/help, /book, /faq, /lang, /data, /delete, /human, /status).');
  console.log('Lệnh giả lập: :1..:9 chọn quick reply | :postback <p> | :comment <text> | :file <path> | :kb <nguồn>|<nội dung> | :user <psid> | :advance <giờ> | :notify <text> | :help | :quit\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lastChoices = { value: [] as Choice[] };
  try {
    for (;;) {
      const line = await rl.question(`\n[${session.psid}] Bạn > `);
      const input = line.trim();
      if (!input) continue;
      if (input === ':quit' || input === ':exit') break;
      if (input === ':help') {
        console.log([
          ':1..:9            Chọn nhanh nút Quick Reply vừa hiện',
          ':postback <p>     Giả lập bấm nút Postback (vd: :postback /start)',
          ':comment <text>   Giả lập bình luận bài viết Page (vd: :comment giá bao nhiêu?)',
          ':file <path>      Giả lập gửi tệp TXT/PDF/DOCX/ảnh/âm thanh từ máy',
          ':kb <nguồn>|<txt> Thêm mục FAQ vào kho tri thức cục bộ',
          ':user <psid>      Đổi PSID người dùng (dùng admin PSID để thử /status, /pause)',
          ':advance <giờ>    Lùi mốc tương tác để thử hết cửa sổ 24h (vd: :advance 25)',
          ':notify <text>    Thử gửi thông báo chủ động (kiểm tra cửa sổ 24h / missed)',
          ':quit             Thoát trình giả lập',
        ].join('\n'));
        continue;
      }
      if (/^:\d+$/.test(input)) {
        const idx = Number(input.slice(1)) - 1;
        const choice = lastChoices.value[idx];
        if (!choice) {
          console.log('Không có nút gợi ý ở vị trí ' + (idx + 1));
          continue;
        }
        renderEvents(await session.sendText(choice.title, choice.payload), lastChoices);
        continue;
      }
      if (input.startsWith(':postback ')) {
        renderEvents(await session.sendPostback(input.slice(10).trim()), lastChoices);
      } else if (input.startsWith(':comment ')) {
        renderEvents(await session.sendComment(input.slice(9).trim()), lastChoices);
      } else if (input.startsWith(':file ')) {
        renderEvents(await session.sendLocalFile(input.slice(6).trim()), lastChoices);
      } else if (input.startsWith(':kb ')) {
        const [source, ...rest] = input.slice(4).split('|');
        session.addFaq((source ?? '').trim(), rest.join('|').trim());
        console.log('✅ Đã lưu mục FAQ:', source?.trim());
      } else if (input.startsWith(':user ')) {
        session.setUser(input.slice(6).trim());
        console.log('👤 Đã chuyển sang PSID:', session.psid);
      } else if (input.startsWith(':advance ')) {
        const h = Number(input.slice(9).trim());
        if (!Number.isFinite(h)) console.log('Số giờ không hợp lệ.');
        else console.log(session.advanceHours(h) ? `⏱ Đã lùi ${h}h. Trong cửa sổ 24h: ${session.isIn24hWindow()}` : 'Chưa có tương tác trước đó.');
      } else if (input.startsWith(':notify ')) {
        renderEvents(await session.triggerNotice(input.slice(8).trim()), lastChoices);
      } else {
        renderEvents(await session.sendText(input), lastChoices);
      }
    }
  } finally {
    rl.close();
    await session.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
