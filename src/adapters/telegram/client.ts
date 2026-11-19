import { Bot, RateLimiter, TelegramApiError, type Api, type SendMessageParams } from 'node-telegram-bot-api';
import type { Config } from '../../config.js';
import type { IncomingMessage } from '../../types.js';
import { parseTelegramMessage } from './parse.js';
import { splitMessage } from './split.js';

export type TelegramApi = Pick<Api, 'sendMessage' | 'sendChatAction'>;

export function createSender(
  api: TelegramApi,
  acquire: (chatId: string, signal?: AbortSignal) => Promise<void>,
  clean: (text: string) => string,
  limits = { perChat: 10, total: 100 },
) {
  const tails = new Map<string, Promise<void>>();
  const counts = new Map<string, number>();
  let pending = 0;
  async function deliver(msg: IncomingMessage, text: string, signal?: AbortSignal): Promise<void> {
    const replyId = Number(msg.msgId.slice(msg.msgId.lastIndexOf(':') + 1));
    for (const part of splitMessage(clean(text))) {
      const params: SendMessageParams = {
        chat_id: msg.threadId, text: part,
        ...(msg.topicId !== undefined ? { message_thread_id: msg.topicId } : {}),
        reply_parameters: { message_id: replyId, allow_sending_without_reply: true },
        link_preview_options: { is_disabled: true },
      };
      for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted();
        await acquire(msg.threadId, signal);
        signal?.throwIfAborted();
        try { await api.sendMessage(params, signal); break; }
        catch (error) {
          // Only retry explicit flood-wait responses; a network retry could duplicate a delivered message.
          if (!(error instanceof TelegramApiError) || error.errorCode !== 429 || attempt >= 2 || (error.retryAfter ?? 1) > 60) throw error;
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(signal?.reason); };
            const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, (error.retryAfter ?? 1) * 1000);
            signal?.addEventListener('abort', abort, { once: true });
          });
        }
      }
    }
  }
  return (msg: IncomingMessage, text: string, signal?: AbortSignal): Promise<void> => {
    const count = counts.get(msg.threadId) ?? 0;
    if (count >= limits.perChat || pending >= limits.total) return Promise.reject(new Error('Telegram output queue is full'));
    pending++; counts.set(msg.threadId, count + 1);
    const task = (tails.get(msg.threadId) ?? Promise.resolve()).catch(() => {}).then(() => deliver(msg, text, signal));
    const tail = task.catch(() => {}).finally(() => {
      pending--;
      const remaining = (counts.get(msg.threadId) ?? 1) - 1;
      if (remaining) counts.set(msg.threadId, remaining);
      else counts.delete(msg.threadId);
      if (tails.get(msg.threadId) === tail) tails.delete(msg.threadId);
    });
    tails.set(msg.threadId, tail);
    return task;
  };
}

export function createTelegram(
  cfg: Config, clean: (text: string) => string, log: (text: string) => void,
  bot = new Bot(cfg.telegramToken, { timeoutMs: 15000, maxRetries: 0 }),
) {
  const lifecycle = new AbortController();
  // Shared by all topics and all output parts in each chat. Slightly below 20/min.
  const limiter = new RateLimiter({ global: 25, perChat: 1 / 3.1 });
  const sender = createSender(bot.api, (id, signal) => limiter.acquire(id, signal), clean, {
    perChat: cfg.maxQueuePerThread, total: cfg.maxQueueTotal,
  });
  return {
    send(msg: IncomingMessage, text: string, signal?: AbortSignal) {
      return sender(msg, text, signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal);
    },
    async typing(msg: IncomingMessage, signal: AbortSignal) {
      await bot.api.sendChatAction({
        chat_id: msg.threadId, action: 'typing',
        ...(msg.topicId !== undefined ? { message_thread_id: msg.topicId } : {}),
      }, signal);
    },
    async start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
      lifecycle.signal.throwIfAborted();
      await bot.init();
      lifecycle.signal.throwIfAborted();
      if (bot.botInfo?.username?.toLowerCase() !== cfg.botUsername.toLowerCase()) {
        throw new Error('TELEGRAM_BOT_USERNAME không khớp với token bot.');
      }
      const webhook = await bot.api.getWebhookInfo();
      lifecycle.signal.throwIfAborted();
      if (webhook.url) throw new Error('Bot đang có webhook. Gỡ webhook của phiên chạy cũ trước khi dùng long polling.');
      bot.catch((error) => log(clean(`Telegram handler: ${String(error)}`)));
      bot.on('message', (ctx) => {
        if (!ctx.message) return;
        const message = parseTelegramMessage(ctx.message, cfg.botUsername, cfg.botAliases);
        // Dispatch without waiting for AI: /stop and other groups stay responsive.
        if (message) void onMessage(message).catch((error) => log(clean(String(error))));
      });
      await bot.api.setMyCommands({ commands: [
        { command: 'help', description: 'Hướng dẫn sử dụng Bot Hiếu' },
        { command: 'stop', description: 'Dừng câu hỏi của bạn trong cuộc trò chuyện này' },
      ] });
      lifecycle.signal.throwIfAborted();
      log('Bot Hiếu đã kết nối Telegram, bắt đầu nhận tin nhắn.');
      await bot.startPolling(undefined, {
        allowedUpdates: ['message'], maxConflictRetries: 0,
        onError: (error) => log(clean(`Telegram polling: ${String(error)}`)),
      });
    },
    stop() { lifecycle.abort(); bot.stop(); },
    async close() { await bot.close(); },
  };
}
