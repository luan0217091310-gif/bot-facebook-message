import 'dotenv/config';
import { join } from 'node:path';
import OpenAI from 'openai';
import { loadConfig } from './config.js';
import { createTelegram } from './adapters/telegram/client.js';
import { PendingConfirmations } from './core/confirm.js';
import { createDispatcher } from './core/dispatcher.js';
import { FactStore } from './core/facts.js';
import { createOpenAiLlm } from './core/llm.js';
import { createPersona } from './core/persona.js';
import { redact } from './core/redact.js';
import { ReminderStore } from './core/scheduler.js';
import { GroupSettings, ThreadHistory } from './core/storage.js';
import { WatchStore } from './core/watches.js';
import { createFetchUrlTool } from './tools/fetchUrl.js';
import { createMemoryTools } from './tools/memoryTools.js';
import { createReminderTools } from './tools/reminderTools.js';
import { createTimeTool } from './tools/time.js';
import { createWatchTools } from './tools/watchTools.js';
import { createWebSearchTool } from './tools/web.js';

const secrets = [process.env.TELEGRAM_BOT_TOKEN, process.env.AI_API_KEY, process.env.TAVILY_API_KEY]
  .filter((value): value is string => Boolean(value)).map((value) => value.trim());
const clean = (text: string) => redact(text, secrets);
const log = (text: string) => console.log(clean(`${new Date().toISOString()} ${text}`));

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  const persona = createPersona(cfg.personaPath);
  const history = new ThreadHistory(cfg.dataDir, cfg.historyLimit, cfg.historyMaxChars);
  const settings = new GroupSettings(cfg.dataDir, cfg.groupReplyMode);
  const facts = new FactStore(join(cfg.dataDir, 'facts.json'));
  const pending = new PendingConfirmations();
  const client = new OpenAI({ baseURL: cfg.aiBaseUrl, apiKey: cfg.aiApiKey, maxRetries: 0, timeout: cfg.aiTimeoutMs });
  const telegram = createTelegram(cfg, clean, log);

  const reminders = new ReminderStore(join(cfg.dataDir, 'reminders.json'), async (reminder) => {
    const tag = reminder.senderName ? ` (${reminder.senderName})` : '';
    await telegram.notify(
      reminder.threadId,
      `⏰ Nhắc việc${tag}: ${reminder.note}`,
      reminder.topicId,
    );
  });

  const watches = new WatchStore(join(cfg.dataDir, 'watches.json'), async (site, preview) => {
    await telegram.notify(
      site.threadId,
      `🌐 Trang web theo dõi vừa có cập nhật mới!\n• ${site.label}\n• Link: ${site.url}\n• Tóm tắt nội dung mới:\n${preview}`,
      site.topicId,
    );
  });

  const tools = [
    createTimeTool(),
    createWebSearchTool(cfg.tavilyApiKey),
    createFetchUrlTool(),
    ...createMemoryTools(facts),
    ...createReminderTools(reminders),
    ...createWatchTools(watches),
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
    llm: createOpenAiLlm(client, cfg.aiModel, cfg.maxOutputTokens),
    send: telegram.send,
    typing: telegram.typing,
    downloadImage: telegram.downloadImage,
  });

  reminders.start();
  watches.start();

  let shuttingDown = false;
  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('Đang dừng bot...');
    reminders.stop();
    watches.stop();
    telegram.stop();
    void dispatcher.close();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    if (!cfg.allowedGroups.size) log('Chưa có ALLOWED_GROUPS: bot chỉ phục vụ DM được phép; chủ bot có thể dùng /id trong nhóm.');
    await telegram.start(dispatcher.handle);
  } catch (error) {
    if (!shuttingDown) throw error;
  } finally {
    reminders.stop();
    watches.stop();
    telegram.stop();
    await dispatcher.close();
    await telegram.close();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

main().catch((error: unknown) => {
  log(`Bot dừng vì lỗi: ${String(error)}`);
  process.exitCode = 1;
});
