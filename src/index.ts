import 'dotenv/config';
import OpenAI from 'openai';
import { loadConfig } from './config.js';
import { createTelegram } from './adapters/telegram/client.js';
import { createDispatcher } from './core/dispatcher.js';
import { createOpenAiLlm } from './core/llm.js';
import { createPersona } from './core/persona.js';
import { redact } from './core/redact.js';
import { GroupSettings, ThreadHistory } from './core/storage.js';

const secrets = [process.env.TELEGRAM_BOT_TOKEN, process.env.AI_API_KEY, process.env.TAVILY_API_KEY]
  .filter((value): value is string => Boolean(value)).map((value) => value.trim());
const clean = (text: string) => redact(text, secrets);
const log = (text: string) => console.log(clean(`${new Date().toISOString()} ${text}`));

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  const persona = createPersona(cfg.personaPath);
  const history = new ThreadHistory(cfg.dataDir, cfg.historyLimit, cfg.historyMaxChars);
  const settings = new GroupSettings(cfg.dataDir, cfg.groupReplyMode);
  const client = new OpenAI({ baseURL: cfg.aiBaseUrl, apiKey: cfg.aiApiKey, maxRetries: 0, timeout: cfg.aiTimeoutMs });
  const telegram = createTelegram(cfg, clean, log);
  const dispatcher = createDispatcher({
    cfg, history, settings, persona, clean, log,
    llm: createOpenAiLlm(client, cfg.aiModel, cfg.maxOutputTokens),
    send: telegram.send, typing: telegram.typing,
  });
  let shuttingDown = false;
  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('Đang dừng bot...');
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
