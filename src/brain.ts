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
import { createFetchUrlTool } from './tools/fetchUrl.js';
import { createMemoryTools } from './tools/memoryTools.js';
import { createReminderTools } from './tools/reminderTools.js';
import { createTimeTool } from './tools/time.js';
import { createWatchTools } from './tools/watchTools.js';
import { createWebSearchTool } from './tools/web.js';


export function createBrain(cfg: Config, adapter: ChannelAdapter, clean: (s: string) => string, log: (s: string) => void) {
  const persona = createPersona(cfg.personaPath);
  const history = new ThreadHistory(cfg.dataDir, cfg.historyLimit, cfg.historyMaxChars);
  const settings = new GroupSettings(cfg.dataDir, cfg.groupReplyMode);
  const facts = new FactStore(join(cfg.dataDir, 'facts.json'));
  const pending = new PendingConfirmations();
  const client = new OpenAI({ baseURL: cfg.aiBaseUrl, apiKey: cfg.aiApiKey, maxRetries: 0, timeout: cfg.aiTimeoutMs });

  const reminders = new ReminderStore(join(cfg.dataDir, 'reminders.json'), async (reminder) => {
    const tag = reminder.senderName ? ` (${reminder.senderName})` : '';
    await adapter.notify(
      reminder.threadId,
      `⏰ Nhắc việc${tag}: ${reminder.note}`,
      reminder.topicId, 'reminder:'+reminder.id,
    );
  });

  const watches = new WatchStore(join(cfg.dataDir, 'watches.json'), async (site, preview) => {
    await adapter.notify(
      site.threadId,
      `🌐 Trang web theo dõi vừa có cập nhật mới!\n• ${site.label}\n• Link: ${site.url}\n• Tóm tắt nội dung mới:\n${preview}`,
      site.topicId, 'watch:'+site.id,
    );
  });

  const tools = [
    createTimeTool(),
    createWebSearchTool(cfg.tavilyApiKey),
    createFetchUrlTool(),
    ...createMemoryTools(facts),
    ...createReminderTools(reminders,Date.now,adapter.plan),
    ...createWatchTools(watches,adapter.plan),
  ];

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
    log,
    channel:adapter.channel,
    confirm:adapter.channel==='messenger' ? (m,q)=>adapter.choices(m,q,[{title:'Đồng ý',payload:'ok'},{title:'Huỷ',payload:'thôi'}]) : undefined,
    llm: createOpenAiLlm(client, cfg.aiModel, cfg.maxOutputTokens),
    send: adapter.send,
    typing: adapter.typing,
    downloadImage: adapter.downloadImage,
  });

  reminders.start();
  watches.start();

  return { dispatcher, history, settings, facts, reminders, watches, client,
    async close() { reminders.stop(); watches.stop(); await dispatcher.close(); },
  };
}
