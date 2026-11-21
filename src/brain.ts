import { join } from 'node:path';
import OpenAI from 'openai';
import type { Config } from './config.js';
import type { ChannelAdapter } from './channel.js';
import { PendingConfirmations } from './core/confirm.js';
import { createDispatcher } from './core/dispatcher.js';
import { FactStore } from './core/facts.js';
import { createOpenAiLlm } from './core/llm.js';
import { createPersona } from './core/persona.js';
import { ReminderStore } from './core/scheduler.js';
import { GroupSettings, ThreadHistory } from './core/storage.js';
import { WatchStore } from './core/watches.js';
import { FileDocStore, SqliteDocStore, type DocStore } from './core/docstore.js';
import { Metrics } from './core/metrics.js';
import type { LlmClient } from './core/llm.js';
import type { Tool } from './tools/types.js';
import { createFetchUrlTool } from './tools/fetchUrl.js';
import { createMemoryTools } from './tools/memoryTools.js';
import { createReminderTools } from './tools/reminderTools.js';
import { createTimeTool } from './tools/time.js';
import { createWatchTools } from './tools/watchTools.js';
import { createWebSearchTool } from './tools/web.js';


export function createBrain(cfg: Config, adapter: ChannelAdapter, clean: (s: string) => string, log: (s: string) => void) {
  const persona = createPersona(cfg.personaPath);
  // STORAGE=sqlite (mặc định): mọi dữ liệu trong data/bot.sqlite; file JSON/JSONL cũ được nhập tự động ở lần đọc đầu.
  // STORAGE=file: giữ cách lưu cũ (dùng khi cần quay lại phiên bản trước).
  const sqlite = cfg.storage === 'sqlite' ? new SqliteDocStore(join(cfg.dataDir, 'bot.sqlite'), cfg.dataDir) : undefined;
  const docs: DocStore = sqlite ?? new FileDocStore(cfg.dataDir);
  const metrics = sqlite ? new Metrics(sqlite.sql, cfg.aiCostPerMToken) : undefined;
  const at = (name: string) => ({ store: docs, name });
  const history = new ThreadHistory(docs, cfg.historyLimit, cfg.historyMaxChars);
  const settings = new GroupSettings(docs, cfg.groupReplyMode);
  const facts = new FactStore(at('facts.json'));
  const pending = new PendingConfirmations();
  const client = new OpenAI({ baseURL: cfg.aiBaseUrl, apiKey: cfg.aiApiKey, maxRetries: 0, timeout: cfg.aiTimeoutMs });

  const reminders = new ReminderStore(at('reminders.json'), async (reminder) => {
    const tag = reminder.senderName ? ` (${reminder.senderName})` : '';
    await adapter.notify(
      reminder.threadId,
      `⏰ Nhắc việc${tag}: ${reminder.note}`,
      reminder.topicId, 'reminder:'+reminder.id,
    );
  });

  const watches = new WatchStore(at('watches.json'), async (site, preview) => {
    await adapter.notify(
      site.threadId,
      `🌐 Trang web theo dõi vừa có cập nhật mới!\n• ${site.label}\n• Link: ${site.url}\n• Tóm tắt nội dung mới:\n${preview}`,
      site.topicId, 'watch:'+site.id,
    );
  });

  const measured = (tool: Tool): Tool => ({ ...tool, run: (args, ctx) => { metrics?.record('tool', tool.name, 1, ctx.senderId); return tool.run(args, ctx); } });
  const baseLlm = createOpenAiLlm(client, cfg.aiModel, cfg.maxOutputTokens);
  const llm: LlmClient = { async complete(m, signal, t) {
    const r = await baseLlm.complete(m, signal, t); metrics?.record('tokens', cfg.aiModel, r.tokens); return r;
  } };
  const started = new Map<string, number>();
  const sendMeasured: ChannelAdapter['send'] = async (msg, text, signal) => {
    await adapter.send(msg, text, signal);
    metrics?.record('out', adapter.channel, 1, msg.senderId);
    const key = msg.threadId + ':' + msg.msgId, t0 = started.get(key);
    if (t0 !== undefined) { metrics?.record('latency', adapter.channel, Date.now() - t0); started.delete(key); }
  };
  const logMeasured = (s: string) => { if (/lỗi|error|thất bại|Xử lý tin nhắn/i.test(s)) metrics?.record('error', adapter.channel); log(s); };

  const tools = [
    createTimeTool(),
    createWebSearchTool(cfg.tavilyApiKey),
    createFetchUrlTool(),
    ...createMemoryTools(facts),
    ...createReminderTools(reminders,Date.now,adapter.plan),
    ...createWatchTools(watches,adapter.plan),
  ].map(measured);

  const dispatcher = createDispatcher({
    cfg,
    history,
    settings,
    persona,
    tools,
    facts,
    pending,
    reminders,
    watches,
    clean,
    log: logMeasured,
    channel:adapter.channel,
    confirm:adapter.channel==='messenger' ? (m,q)=>adapter.choices(m,q,[{title:'Đồng ý',payload:'ok'},{title:'Huỷ',payload:'thôi'}]) : undefined,
    llm,
    send: sendMeasured,
    typing: adapter.typing,
    downloadImage: adapter.downloadImage,
  });

  reminders.start();
  watches.start();

  const handle = dispatcher.handle;
  dispatcher.handle = (msg) => {
    metrics?.record('in', adapter.channel, 1, msg.senderId);
    if (started.size > 5000) started.clear();
    started.set(msg.threadId + ':' + msg.msgId, Date.now());
    return handle(msg);
  };
  if (metrics) { metrics.prune(); }

  return { dispatcher, history, settings, facts, reminders, watches, client, metrics, docs, persona, channel: adapter.channel, cfg,
    async close() { reminders.stop(); watches.stop(); await dispatcher.close(); sqlite?.close(); },
  };
}
